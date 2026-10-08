/*
 * The insured person's app (/api/me/...): the profile, the policy and limits, family members (FAMILY_SPEC),
 * the card code for the clinic, receipts for reimbursement, appointments, the assistance and the chat.
 * The person is always the signed-in one (or a family member the access allows), never an id from the URL.
 */
import { msg } from '@mig/i18n';
import type { Appointment, ChatMessage, LimitUsage, MyClaim } from '@mig/contracts';
import type { AssistanceBrief, CardToken, FamilyProfile, FamilyRequest, MePolicy, MeProfile, RecognizeResult } from '@mig/contracts/dto';
import { chatSchema, consentSchema, familyConsentSchema, familyRequestSchema, myAppointmentSchema, myClaimSchema, payoutCardSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { CARD_TOKEN_TTL_MS, formatShortCode, shortCodeFrom } from '../clinics';
import { isAdultMember } from '../family';
import { maskCard, maskPhone, maskPinfl } from '../lib/mask';
import { detectMime, RECEIPT_LIMITS } from '../lib/mime';
import { randomId, randomToken } from '../lib/random';
import { recognizeReceipt } from '../lib/receipts';
import { DAY, parseIso, tzIso } from '../lib/time';
import { PROGRAMS } from '../programs';
import type { ClaimRow, FamilyRequestRow, InsuredRow } from '../store/db';
import { audit, conflict, DomainError, forbidden, insuredLabel, notFound, systemRepos, todayIso, validate, type AuthCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { accessOf, ageLimits, familyOf, hasConsent, isDependent, myAppointment, myClaimOf, payoutCardOf, personFor, principalOf } from './family';
import { toFamilyRequest } from './familyRequests';
import { limitsFor, toMyClaim } from './views';
import { createAppointment, emitWebhook, FILED_CLAIM_SEQ_FLOOR, nextClaimNumber, pushEvent } from './clinic';
import { currentAssistance } from './assistance';
import { handlerOf, refreshFlags, sha256Hex } from './settlement';
import { stripImageMetadata } from '../lib/imageMeta';

/** An uploaded file as the adapter read it from the form. */
export interface Upload {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** A multipart form read by the adapter: text fields and files by name. */
export interface FormInput {
  fields: Record<string, string | null | undefined>;
  files: Record<string, Upload[] | undefined>;
}

/** The form is read only when the service gets to it (after the session and the person are checked). */
export type ReadForm = () => Promise<FormInput>;

async function requireInsured(ctx: AuthCtx): Promise<InsuredRow> {
  const { user } = ctx;
  if (user.role !== 'insured' || !user.insuredId) throw forbidden();
  const me = await ctx.repos.insured.get(user.insuredId);
  if (!me) throw notFound();
  return me;
}

function firstName(fullName: string): string {
  return fullName.split(' ')[1] ?? fullName;
}

async function profileOf(ctx: AuthCtx, me: InsuredRow, p: InsuredRow, P: ParamsView): Promise<FamilyProfile | null> {
  const access = await accessOf(ctx, me, p, P);
  if (access === 'none') return null;
  const today = todayIso(ctx);
  return {
    id: p.id,
    fullName: p.fullName,
    firstName: firstName(p.fullName),
    relation: p.relation,
    access,
    status: p.status,
    ...(p.certificateNumber ? { certificateNumber: p.certificateNumber } : {}),
    dependentChild: isDependent(p, today, P),
    ownLogin: !!p.phone && isAdultMember(p, today, ageLimits(P)),
    ...(p.id !== me.id ? { payoutCardOwn: (await payoutCardOf(ctx, p)).own } : {}),
  };
}

/** The employee (policyholder) of a family member's own app: names only. */
function principalNames(p: InsuredRow | undefined): Pick<MeProfile, 'principalName' | 'principalFirstName'> {
  return p ? { principalName: p.fullName, principalFirstName: firstName(p.fullName) } : {};
}

const REPLIES = [
  'Спасибо! Передали вопрос специалисту, ответим в течение часа.',
  'Посмотрим условия вашей программы и ответим здесь же.',
  'Уточните, пожалуйста, дату приёма и название клиники.',
];

type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** A receipt photo: an image up to 10 MB, checked by its magic bytes. */
function receiptImage(file: Upload): { bytes: Uint8Array; mime: ImageMime } {
  const { bytes } = file;
  if (bytes.length === 0 || bytes.length > RECEIPT_LIMITS.maxBytes) throw new DomainError(422, 'validation', 'srv.file.tooLarge10mb', { fields: { files: msg('srv.file.tooLarge10mb') } });
  const mime = detectMime(bytes);
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
    throw new DomainError(422, 'validation', 'srv.receipt.onlyImages', { fields: { files: msg('srv.file.unsupported') } });
  }
  // Metadata (Exif with GPS, XMP) is removed on the server too: the stored bytes and the receipt hash are of the clean image.
  return { bytes: stripImageMetadata(bytes), mime };
}

const chatView = ({ insuredId: _i, visibleAt: _v, ...m }: { insuredId: string; visibleAt: string } & ChatMessage): ChatMessage => m;

// ---------------------------------------------------------------- endpoints

/** GET /me. */
export async function profile(ctx: AuthCtx): Promise<MeProfile> {
  const me = await requireInsured(ctx);
  const card = await payoutCardOf(ctx, me);
  return {
    fullName: me.fullName,
    firstName: me.fullName.split(' ')[1] ?? me.fullName,
    companyName: me.clientName,
    phoneMasked: maskPhone(me.phone),
    pinflMasked: maskPinfl(me.pinfl),
    payoutCardMasked: maskCard(card.card),
    consentGivenAt: me.consentGivenAt,
    relation: me.relation,
    payoutCardOwn: card.own,
    ...(me.principalId ? { familyConsentGranted: await hasConsent(ctx, me.id, me.principalId) } : {}),
    ...principalNames(await principalOf(ctx, me)),
  };
}

/** POST /me/consent: consent to the processing of personal data. */
export async function giveConsent(ctx: AuthCtx, body: unknown): Promise<{ consentGivenAt: string | undefined }> {
  const me = await requireInsured(ctx);
  validate(consentSchema, body);
  const consentGivenAt = tzIso(ctx.now());
  await ctx.repos.insured.update(me.id, { consentGivenAt });
  return { consentGivenAt };
}

/** GET /me/policy[?personId=]. */
export async function policy(ctx: AuthCtx, personId: string | null): Promise<MePolicy> {
  const me = await requireInsured(ctx);
  const { person } = await personFor(ctx, me, personId, 'card');
  const p = (await ctx.repos.policies.get(person.policyId))!;
  return {
    number: p.number,
    program: p.program,
    programName: PROGRAMS[p.program].name,
    companyName: person.clientName,
    startDate: p.startDate,
    endDate: p.endDate,
    limits: PROGRAMS[p.program].limits,
    ...(person.certificateNumber ? { certificateNumber: person.certificateNumber } : {}),
  };
}

/** GET /me/limits[?personId=]. */
export async function limits(ctx: AuthCtx, personId: string | null): Promise<LimitUsage[]> {
  const me = await requireInsured(ctx);
  return limitsFor(ctx, (await personFor(ctx, me, personId, 'medical')).person);
}

/** GET /me/family: the profiles of the switcher. */
export async function family(ctx: AuthCtx): Promise<FamilyProfile[]> {
  const me = await requireInsured(ctx);
  const P = await loadParams(ctx);
  const people = me.relation === 'employee' ? [me, ...(await familyOf(ctx, me.id)).filter((x) => x.status === 'active')] : [me];
  const out: FamilyProfile[] = [];
  for (const p of people) {
    const profile = await profileOf(ctx, me, p, P);
    if (profile) out.push(profile);
  }
  return out;
}

/** POST /me/family/consent: an adult family member lets the employee see their claims and appointments. */
export async function setFamilyConsent(ctx: AuthCtx, body: unknown): Promise<{ granted: boolean }> {
  const { user } = ctx;
  const me = await requireInsured(ctx);
  if (!can(user, 'family.self_service', { insuredId: me.id })) throw forbidden();
  // Only an adult family member decides about their own data; the employee and a child have nothing to grant.
  if (!me.principalId || !isAdultMember(me, todayIso(ctx), ageLimits(await loadParams(ctx)))) throw conflict('srv.family.consentAdultsOnly');
  const { granted } = validate(familyConsentSchema, body);
  const now = tzIso(ctx.now());
  const active = await ctx.repos.familyConsents.first({ where: { ownerId: me.id, viewerId: me.principalId, revokedAt: { isNull: true } } });
  if (granted && !active) await ctx.repos.familyConsents.insert({ id: randomId(), ownerId: me.id, viewerId: me.principalId, grantedAt: now }, { at: 'start' });
  if (!granted && active) await ctx.repos.familyConsents.update(active.id, { revokedAt: now });
  if (granted !== !!active) await audit(ctx, user, granted ? 'family_consent_granted' : 'family_consent_revoked', { targetType: 'insured', targetId: me.id, targetLabel: insuredLabel(me.id) });
  return { granted };
}

/** POST /me/payout-card: an own card, or (a family member) back to the employee's. */
export async function setPayoutCard(ctx: AuthCtx, body: unknown): Promise<{ payoutCardMasked: string; payoutCardOwn: boolean }> {
  const { user } = ctx;
  const me = await requireInsured(ctx);
  if (!can(user, 'family.self_service', { insuredId: me.id })) throw forbidden();
  const { card } = validate(payoutCardSchema, body);
  // The employee's card is the default of the family: only a family member may go back to it.
  if (card === null && me.relation === 'employee') throw new DomainError(422, 'validation', 'errors.validation', { fields: { card: msg('v.cardFormat') } });
  me.payoutCard = card ?? '';
  await ctx.repos.insured.update(me.id, { payoutCard: me.payoutCard });
  await audit(ctx, user, 'payout_card_changed', { targetType: 'insured', targetId: me.id, targetLabel: insuredLabel(me.id) });
  const { card: current, own } = await payoutCardOf(ctx, me);
  return { payoutCardMasked: maskCard(current), payoutCardOwn: own };
}

/** GET /me/family/requests: the employee's requests to add a family member. */
export async function familyRequests(ctx: AuthCtx): Promise<FamilyRequest[]> {
  const me = await requireInsured(ctx);
  const out: FamilyRequest[] = [];
  for (const r of await ctx.repos.familyRequests.list({ where: { employeeId: me.id } })) out.push(await toFamilyRequest(ctx, r));
  return out;
}

/** POST /me/family/requests: HR approves it into a change request for MIG. */
export async function createFamilyRequest(ctx: AuthCtx, body: unknown): Promise<FamilyRequest> {
  const { user } = ctx;
  const r = ctx.repos;
  const me = await requireInsured(ctx);
  if (!can(user, 'family.self_service', { insuredId: me.id })) throw forbidden();
  if (me.relation !== 'employee') throw conflict('srv.family.employeeOnly');
  const input = validate(familyRequestSchema, body);
  if (await r.insured.exists({ pinfl: input.pinfl, clientId: me.clientId, status: 'active' })) {
    throw new DomainError(409, 'conflict', 'srv.hr.pinflInsured', { fields: { pinfl: msg('srv.hr.alreadyListed') } });
  }
  const pendingChange = (await r.policyChanges.list({ where: { status: 'pending' } })).some((c) => c.newPerson?.pinfl === input.pinfl);
  if ((await r.familyRequests.exists({ pinfl: input.pinfl, status: 'pending' })) || pendingChange) {
    throw new DomainError(409, 'conflict', 'srv.policyChanges.alreadySent', { fields: { pinfl: msg('srv.policyChanges.sentShort') } });
  }
  const now = tzIso(ctx.now());
  const row: FamilyRequestRow = {
    id: randomId(),
    employeeId: me.id,
    clientId: me.clientId,
    fullName: input.fullName,
    birthDate: input.birthDate,
    pinfl: input.pinfl,
    relation: input.relation,
    ...(input.isStudent ? { isStudent: true } : {}),
    consentAt: now,
    status: 'pending',
    createdAt: now,
  };
  await r.familyRequests.insert(row, { at: 'start' });
  await audit(ctx, user, 'family_request_created', { targetType: 'insured', targetId: me.id, targetLabel: insuredLabel(me.id) });
  return toFamilyRequest(ctx, row);
}

/** GET /me/card-token[?personId=]: a one-time QR / short code for the clinic desk (a GET that writes). */
export async function cardToken(ctx: AuthCtx, personId: string | null): Promise<CardToken> {
  const viewer = await requireInsured(ctx);
  const me = (await personFor(ctx, viewer, personId, 'card')).person;
  const now = ctx.now();
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const row = { token: randomToken(18), shortCode: shortCodeFrom(bytes), insuredId: me.id, expiresAt: now + CARD_TOKEN_TTL_MS };
  // One-time tokens: the previous ones of this person stop working as soon as a new one is issued.
  // The token may be of a family member (a child): `personFor(…, 'card')` allowed it; the row is written by the system.
  const tokens = systemRepos(ctx, 'card token of a family member the person may show at the desk').cardTokens;
  await tokens.removeWhere({ expiresAt: { lte: now } });
  await tokens.removeWhere({ insuredId: me.id });
  await tokens.insert(row);
  return { token: row.token, shortCode: formatShortCode(row.shortCode), expiresAt: tzIso(row.expiresAt) };
}

/** GET /me/claims[?personId=]: the newest first. */
export async function claims(ctx: AuthCtx, personId: string | null): Promise<MyClaim[]> {
  const viewer = await requireInsured(ctx);
  const me = (await personFor(ctx, viewer, personId, 'medical')).person;
  const out: MyClaim[] = [];
  for (const c of await ctx.repos.claims.list({ where: { insuredId: me.id }, orderBy: [['createdAt', 'desc']] })) out.push(await toMyClaim(ctx, c, me));
  return out;
}

/** GET /me/claims/:id. */
export async function claim(ctx: AuthCtx, id: string): Promise<MyClaim & { personId?: string }> {
  const me = await requireInsured(ctx);
  const { c, who } = await myClaimOf(ctx, me, id);
  // A family member's claim: the screen shows that person's limits, not the signed-in one's.
  return { ...(await toMyClaim(ctx, c, who)), ...(who.id !== me.id ? { personId: who.id } : {}) };
}

/**
 * POST /me/claims/recognize: fake OCR from the image itself. The server repeats it on submission and never
 * takes fiscal data from the client.
 */
export async function recognize(ctx: AuthCtx, readForm: ReadForm): Promise<RecognizeResult> {
  await requireInsured(ctx);
  const form = await readForm();
  const file = form.files.file?.[0];
  if (!file) throw new DomainError(422, 'validation', 'srv.receipt.addPhoto', { fields: { file: msg('srv.receipt.addPhoto') } });
  const { bytes } = receiptImage(file);
  return recognizeReceipt(await sha256Hex(bytes), ctx.now());
}

/** POST /me/claims[?personId=]: a receipt for reimbursement (for a family member — by the employee). */
export async function submitClaim(ctx: AuthCtx, personId: string | null, readForm: ReadForm): Promise<MyClaim> {
  const r = ctx.repos;
  const viewer = await requireInsured(ctx);
  // A receipt for a family member is filed by the employee (a child, or an adult who allowed it).
  const me = (await personFor(ctx, viewer, personId, 'medical')).person;
  const form = await readForm();
  const files = form.files.files ?? [];
  if (files.length === 0) throw new DomainError(422, 'validation', 'srv.receipt.addPhoto', { fields: { files: msg('srv.receipt.addPhoto') } });
  if (files.length > RECEIPT_LIMITS.maxFiles) throw new DomainError(422, 'validation', 'srv.receipt.max5', { fields: { files: msg('srv.receipt.max5') } });
  const input = validate(myClaimSchema, {
    category: form.fields.category ?? null,
    amount: Number(form.fields.amount ?? null),
    serviceDate: form.fields.serviceDate ?? null,
    providerName: form.fields.providerName ?? null,
  });
  const claimId = randomId();
  const attachments: ClaimRow['attachments'] = [];
  let receiptHash: string | undefined;
  for (const [idx, f] of files.entries()) {
    const { bytes, mime } = receiptImage(f);
    if (idx === 0) receiptHash = await sha256Hex(bytes);
    const fileId = randomId();
    await r.files.insert({ id: fileId, mime, bytes, claimId, insuredId: me.id });
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
    attachments.push({ id: fileId, kind: 'receipt', fileName: `receipt-${idx + 1}.${ext}`, mime, sizeBytes: bytes.length, url: `/api/files/${fileId}` });
  }
  const P = await loadParams(ctx);
  const now = ctx.now();
  const claim: ClaimRow = {
    id: claimId,
    number: await nextClaimNumber(ctx, P, { floor: FILED_CLAIM_SEQ_FLOOR }),
    insuredId: me.id,
    insuredName: me.fullName,
    clientId: me.clientId,
    clientName: me.clientName,
    category: input.category,
    source: 'app',
    amountClaimed: input.amount,
    providerName: input.providerName,
    serviceDate: input.serviceDate,
    status: 'new',
    slaDueAt: tzIso(now + 5 * DAY),
    createdAt: tzIso(now),
    updatedAt: tzIso(now),
    attachments,
    history: [{ at: tzIso(now), actorName: 'Застрахованный (приложение)', to: 'new' }],
    receiptHash,
    receiptFiscal: receiptHash ? recognizeReceipt(receiptHash, now).fiscal : undefined,
    // Reimbursements go to MIG's claims officer or to the assistance (handlesReimbursements, LIFECYCLE_SPEC §13).
    handledBy: await handlerOf(ctx, me.policyId),
  };
  await r.claims.insert(claim, { at: 'start' });
  await refreshFlags(ctx, claim, P);
  return toMyClaim(ctx, claim, me);
}

/** GET /me/appointments[?personId=]: the latest first. */
export async function appointments(ctx: AuthCtx, personId: string | null): Promise<Appointment[]> {
  const viewer = await requireInsured(ctx);
  const me = (await personFor(ctx, viewer, personId, 'medical')).person;
  return ctx.repos.appointments.list({ where: { insuredId: me.id }, orderBy: [['startsAt', 'desc']] });
}

/** POST /me/appointments[?personId=]: a request to a clinic. */
export async function requestAppointment(ctx: AuthCtx, personId: string | null, body: unknown): Promise<Appointment> {
  const viewer = await requireInsured(ctx);
  const me = (await personFor(ctx, viewer, personId, 'medical')).person;
  const input = validate(myAppointmentSchema, body);
  return createAppointment(ctx, me, input);
}

/** POST /me/appointments/:id/cancel. */
export async function cancelAppointment(ctx: AuthCtx, id: string): Promise<Appointment> {
  const me = await requireInsured(ctx);
  const a = await myAppointment(ctx, me, id);
  if (a.status !== 'requested' && a.status !== 'confirmed') throw conflict('srv.appointment.cannotCancel');
  a.status = 'cancelled';
  delete a.proposedStartsAt;
  await ctx.repos.appointments.put(a);
  await emitWebhook(ctx, a.clinicId, 'appointment.cancelled', a.id);
  await pushEvent(ctx, a.clinicId, 'Пациент отменил запись');
  return a;
}

/** POST /me/appointments/:id/accept-proposal: the time the clinic proposed. */
export async function acceptProposal(ctx: AuthCtx, id: string): Promise<Appointment> {
  const me = await requireInsured(ctx);
  const a = await myAppointment(ctx, me, id);
  if (a.status !== 'requested' || !a.proposedStartsAt) throw conflict('srv.appointment.noProposal');
  a.startsAt = a.proposedStartsAt;
  delete a.proposedStartsAt;
  a.status = 'confirmed';
  await ctx.repos.appointments.put(a);
  await pushEvent(ctx, a.clinicId, 'Пациент принял предложенное время');
  return a;
}

/** GET /me/assistance: «Ваш ассистанс 24/7» on the home screen (ASSISTANCE_SPEC §5.1); null — MIG serves the client. */
export async function assistance(ctx: AuthCtx): Promise<{ assistance: AssistanceBrief | null }> {
  const me = await requireInsured(ctx);
  const id = await currentAssistance(ctx, me.policyId);
  const a = id ? await ctx.repos.assistances.get(id) : null;
  return { assistance: a ? { id: a.id, name: a.name, legalForm: a.legalForm, phone24x7: a.phone24x7, integrationMode: a.integrationMode } : null };
}

/** GET /me/chat: messages already visible (the operator's reply appears a moment later). */
export async function chat(ctx: AuthCtx): Promise<ChatMessage[]> {
  const me = await requireInsured(ctx);
  const now = ctx.now();
  return (await ctx.repos.chat.list({ where: { insuredId: me.id } })).filter((m) => parseIso(m.visibleAt) <= now).map(chatView);
}

/** POST /me/chat. */
export async function sendChat(ctx: AuthCtx, body: unknown): Promise<ChatMessage> {
  const me = await requireInsured(ctx);
  const { text } = validate(chatSchema, body);
  const now = ctx.now();
  const message = { id: randomId(), insuredId: me.id, from: 'insured' as const, text, at: tzIso(now), visibleAt: tzIso(now) };
  await ctx.repos.chat.insert(message);
  const n = await ctx.repos.chat.count({ insuredId: me.id });
  await ctx.repos.chat.insert({ id: randomId(), insuredId: me.id, from: 'operator', text: REPLIES[n % REPLIES.length]!, at: tzIso(now + 2000), visibleAt: tzIso(now + 2000) });
  return chatView(message);
}
