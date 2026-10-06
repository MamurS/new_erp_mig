import { msg } from '@/i18n/core';
import { delay, http } from 'msw';
import { chatSchema, consentSchema, familyConsentSchema, familyRequestSchema, myAppointmentSchema, myClaimSchema, payoutCardSchema } from '@/shared/schemas/forms';
import type { SessionUser } from '@/shared/types';
import type { AssistanceBrief, CardToken, FamilyProfile, MePolicy, MeProfile, RecognizeResult } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isAdultMember } from '@/shared/domain/family';
import { detectMime, RECEIPT_LIMITS } from '@/shared/lib/image';
import { CARD_TOKEN_TTL_MS, formatShortCode, shortCodeFrom } from '@/shared/domain/clinics';
import { createAppointment, emitWebhook, pushEvent } from '../clinic-core';
import { currentAssistance } from '../assistance-core';
import { db, type ClaimRow, type Db, type FamilyRequestRow, type InsuredRow } from '../db';
import { API, audit, body, conflict, forbidden, HttpError, insuredLabel, notFound, param, requireSession, route, validate } from '../http';
import { accessOf, ageLimits, familyOf, hasConsent, isDependent, payoutCardOf, personFor, personIdParam, todayIso } from '../family-core';
import { toFamilyRequest } from '../family-requests';
import { maskCard, maskPhone, maskPinfl } from '../mask';
import { scheduleSaveDb } from '../persist';
import { randomId, randomToken } from '../rng';
import { DAY, parseIso, tzIso } from '../time';
import { limitsFor, toMyClaim } from '../views';
import { PROGRAMS } from '../programs';
import { nextClaimNumber } from './claims';
import { mockConfig } from '../config';
import { recognizeReceipt } from '../receipts';
import { handlerOf, refreshFlags, sha256Hex } from '../settlement-core';

function requireInsured(request: Request): { user: SessionUser; me: InsuredRow } {
  const { user } = requireSession(request);
  if (user.role !== 'insured' || !user.insuredId) throw forbidden();
  const me = db().insured.find((i) => i.id === user.insuredId);
  if (!me) throw notFound();
  return { user, me };
}

/** An appointment of a person whose medical data the signed-in person may see; anything else is 404. */
function myAppointment(d: Db, me: InsuredRow, id: string) {
  const a = d.appointments.find((x) => x.id === id);
  const who = a ? d.insured.find((x) => x.id === a.insuredId) : undefined;
  if (!a || !who || (who.id !== me.id && accessOf(d, me, who) !== 'full')) throw notFound();
  return a;
}

/** A claim of a person whose medical data the signed-in person may see; anything else is 404. */
export function myClaimOf(d: Db, me: InsuredRow, id: string): { c: ClaimRow; who: InsuredRow } {
  const c = d.claims.find((x) => x.id === id);
  const who = c ? d.insured.find((x) => x.id === c.insuredId) : undefined;
  if (!c || !who || (who.id !== me.id && accessOf(d, me, who) !== 'full')) throw notFound();
  return { c, who };
}

function firstName(fullName: string): string {
  return fullName.split(' ')[1] ?? fullName;
}

function profileOf(d: Db, me: InsuredRow, p: InsuredRow): FamilyProfile | null {
  const access = accessOf(d, me, p);
  if (access === 'none') return null;
  return {
    id: p.id,
    fullName: p.fullName,
    firstName: firstName(p.fullName),
    relation: p.relation,
    access,
    status: p.status,
    ...(p.certificateNumber ? { certificateNumber: p.certificateNumber } : {}),
    dependentChild: isDependent(p),
    ownLogin: !!p.phone && isAdultMember(p, todayIso(), ageLimits()),
  };
}

const REPLIES = [
  'Спасибо! Передали вопрос специалисту, ответим в течение часа.',
  'Проверили: услуга входит в вашу программу. Можно записываться.',
  'Уточните, пожалуйста, дату приёма и название клиники.',
];

async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, 'validation', 'srv.form.invalid');
  }
}

async function readImage(file: File): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' }> {
  if (file.size === 0 || file.size > RECEIPT_LIMITS.maxBytes) throw new HttpError(422, 'validation', 'srv.file.tooLarge10mb', { fields: { files: msg('srv.file.tooLarge10mb') } });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectMime(bytes);
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
    throw new HttpError(422, 'validation', 'srv.receipt.onlyImages', { fields: { files: msg('srv.file.unsupported') } });
  }
  return { bytes, mime };
}

export const meHandlers = [
  http.get(
    `${API}/me`,
    route(({ request }) => {
      const { me } = requireInsured(request);
      const out: MeProfile = {
        fullName: me.fullName,
        firstName: me.fullName.split(' ')[1] ?? me.fullName,
        companyName: me.clientName,
        phoneMasked: maskPhone(me.phone),
        pinflMasked: maskPinfl(me.pinfl),
        payoutCardMasked: maskCard(payoutCardOf(db(), me).card),
        consentGivenAt: me.consentGivenAt,
        relation: me.relation,
        payoutCardOwn: payoutCardOf(db(), me).own,
        ...(me.principalId ? { familyConsentGranted: hasConsent(db(), me.id, me.principalId) } : {}),
      };
      return out;
    }),
  ),
  http.post(
    `${API}/me/consent`,
    route(async ({ request }) => {
      const { me } = requireInsured(request);
      await body(request, consentSchema);
      me.consentGivenAt = tzIso(Date.now());
      return { consentGivenAt: me.consentGivenAt };
    }),
  ),
  http.get(
    `${API}/me/policy`,
    route(({ request, url }) => {
      const { me } = requireInsured(request);
      const d = db();
      const { person } = personFor(d, me, personIdParam(url), 'card');
      const p = d.policies.find((x) => x.id === person.policyId)!;
      const out: MePolicy = {
        number: p.number,
        program: p.program,
        programName: PROGRAMS[p.program].name,
        companyName: person.clientName,
        startDate: p.startDate,
        endDate: p.endDate,
        limits: PROGRAMS[p.program].limits,
        ...(person.certificateNumber ? { certificateNumber: person.certificateNumber } : {}),
      };
      return out;
    }),
  ),
  http.get(
    `${API}/me/limits`,
    route(({ request, url }) => {
      const { me } = requireInsured(request);
      const d = db();
      return limitsFor(d, personFor(d, me, personIdParam(url), 'medical').person);
    }),
  ),
  // ---- family members (FAMILY_SPEC): the profiles of the switcher, consent, payout card, add requests ----
  http.get(
    `${API}/me/family`,
    route(({ request }) => {
      const { me } = requireInsured(request);
      const d = db();
      const people = me.relation === 'employee' ? [me, ...familyOf(d, me.id).filter((x) => x.status === 'active')] : [me];
      return people.map((p) => profileOf(d, me, p)).filter((p): p is FamilyProfile => !!p);
    }),
  ),
  http.post(
    `${API}/me/family/consent`,
    route(async ({ request }) => {
      const { user, me } = requireInsured(request);
      if (!can(user, 'family.self_service', { insuredId: me.id })) throw forbidden();
      // Only an adult family member decides about their own data; the employee and a child have nothing to grant.
      if (!me.principalId || !isAdultMember(me, todayIso(), ageLimits())) throw conflict('srv.family.consentAdultsOnly');
      const { granted } = await body(request, familyConsentSchema);
      const d = db();
      const now = tzIso(Date.now());
      const active = d.familyConsents.find((c) => c.ownerId === me.id && c.viewerId === me.principalId && !c.revokedAt);
      if (granted && !active) d.familyConsents.unshift({ id: randomId(), ownerId: me.id, viewerId: me.principalId, grantedAt: now });
      if (!granted && active) active.revokedAt = now;
      if (granted !== !!active) audit(user, granted ? 'family_consent_granted' : 'family_consent_revoked', { targetType: 'insured', targetId: me.id, targetLabel: insuredLabel(me.id) });
      return { granted };
    }),
  ),
  http.post(
    `${API}/me/payout-card`,
    route(async ({ request }) => {
      const { user, me } = requireInsured(request);
      if (!can(user, 'family.self_service', { insuredId: me.id })) throw forbidden();
      const { card } = await body(request, payoutCardSchema);
      // The employee's card is the default of the family: only a family member may go back to it.
      if (card === null && me.relation === 'employee') throw new HttpError(422, 'validation', 'errors.validation', { fields: { card: msg('v.cardFormat') } });
      me.payoutCard = card ?? '';
      audit(user, 'payout_card_changed', { targetType: 'insured', targetId: me.id, targetLabel: insuredLabel(me.id) });
      const { card: current, own } = payoutCardOf(db(), me);
      return { payoutCardMasked: maskCard(current), payoutCardOwn: own };
    }),
  ),
  http.get(
    `${API}/me/family/requests`,
    route(({ request }) => {
      const { me } = requireInsured(request);
      const d = db();
      return d.familyRequests.filter((r) => r.employeeId === me.id).map((r) => toFamilyRequest(d, r));
    }),
  ),
  http.post(
    `${API}/me/family/requests`,
    route(async ({ request }) => {
      const { user, me } = requireInsured(request);
      if (!can(user, 'family.self_service', { insuredId: me.id })) throw forbidden();
      if (me.relation !== 'employee') throw conflict('srv.family.employeeOnly');
      const input = await body(request, familyRequestSchema);
      const d = db();
      if (d.insured.some((i) => i.pinfl === input.pinfl && i.clientId === me.clientId && i.status === 'active')) {
        throw new HttpError(409, 'conflict', 'srv.hr.pinflInsured', { fields: { pinfl: msg('srv.hr.alreadyListed') } });
      }
      if (d.familyRequests.some((r) => r.pinfl === input.pinfl && r.status === 'pending') || d.policyChanges.some((c) => c.status === 'pending' && c.newPerson?.pinfl === input.pinfl)) {
        throw new HttpError(409, 'conflict', 'srv.policyChanges.alreadySent', { fields: { pinfl: msg('srv.policyChanges.sentShort') } });
      }
      const now = tzIso(Date.now());
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
      d.familyRequests.unshift(row);
      audit(user, 'family_request_created', { targetType: 'insured', targetId: me.id, targetLabel: insuredLabel(me.id) });
      return toFamilyRequest(d, row);
    }),
  ),
  http.get(
    `${API}/me/card-token`,
    route(({ request, url }) => {
      const { me: viewer } = requireInsured(request);
      const d = db();
      const me = personFor(d, viewer, personIdParam(url), 'card').person;
      const now = Date.now();
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      const row = { token: randomToken(18), shortCode: shortCodeFrom(bytes), insuredId: me.id, expiresAt: now + CARD_TOKEN_TTL_MS };
      // One-time tokens: the previous ones of this person stop working as soon as a new one is issued.
      d.cardTokens = d.cardTokens.filter((t) => t.expiresAt > now && t.insuredId !== me.id);
      d.cardTokens.push(row);
      // A GET that writes: persist it like a mutation, or a reload would lose the code on screen.
      scheduleSaveDb(db);
      const out: CardToken = { token: row.token, shortCode: formatShortCode(row.shortCode), expiresAt: tzIso(row.expiresAt) };
      return out;
    }),
  ),
  http.get(
    `${API}/me/claims`,
    route(({ request, url }) => {
      const { me: viewer } = requireInsured(request);
      const d = db();
      const me = personFor(d, viewer, personIdParam(url), 'medical').person;
      return d.claims
        .filter((c) => c.insuredId === me.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((c) => toMyClaim(d, c, me));
    }),
  ),
  http.get(
    `${API}/me/claims/:id`,
    route((ctx) => {
      const { me } = requireInsured(ctx.request);
      const d = db();
      const { c, who } = myClaimOf(d, me, param(ctx, 'id'));
      return toMyClaim(d, c, who);
    }),
  ),
  http.post(
    `${API}/me/claims/recognize`,
    route(async ({ request }) => {
      requireInsured(request);
      const form = await readForm(request);
      const file = form.get('file');
      if (!(file instanceof File)) throw new HttpError(422, 'validation', 'srv.receipt.addPhoto', { fields: { file: msg('srv.receipt.addPhoto') } });
      const { bytes } = await readImage(file);
      if (mockConfig.latency[1] > 0) await delay(1000);
      // Fake OCR from the image itself: the server repeats it on submission and never takes fiscal data from the client.
      const out: RecognizeResult = recognizeReceipt(await sha256Hex(bytes));
      return out;
    }),
  ),
  http.post(
    `${API}/me/claims`,
    route(async ({ request, url }) => {
      const { me: viewer } = requireInsured(request);
      // A receipt for a family member is filed by the employee (a child, or an adult who allowed it).
      const me = personFor(db(), viewer, personIdParam(url), 'medical').person;
      const form = await readForm(request);
      const files = form.getAll('files').filter((f): f is File => f instanceof File);
      if (files.length === 0) throw new HttpError(422, 'validation', 'srv.receipt.addPhoto', { fields: { files: msg('srv.receipt.addPhoto') } });
      if (files.length > RECEIPT_LIMITS.maxFiles) throw new HttpError(422, 'validation', 'srv.receipt.max5', { fields: { files: msg('srv.receipt.max5') } });
      const input = validate(myClaimSchema, {
        category: form.get('category'),
        amount: Number(form.get('amount')),
        serviceDate: form.get('serviceDate'),
        providerName: form.get('providerName'),
      });
      const d = db();
      const claimId = randomId();
      const attachments: ClaimRow['attachments'] = [];
      let receiptHash: string | undefined;
      for (const [idx, f] of files.entries()) {
        const { bytes, mime } = await readImage(f);
        if (idx === 0) receiptHash = await sha256Hex(bytes);
        const fileId = randomId();
        d.files.push({ id: fileId, mime, bytes, claimId, insuredId: me.id });
        const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
        attachments.push({ id: fileId, kind: 'receipt', fileName: `receipt-${idx + 1}.${ext}`, mime, sizeBytes: bytes.length, url: `/api/files/${fileId}` });
      }
      const now = Date.now();
      const claim: ClaimRow = {
        id: claimId,
        number: nextClaimNumber(),
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
        receiptFiscal: receiptHash ? recognizeReceipt(receiptHash).fiscal : undefined,
        // Reimbursements go to MIG's claims officer or to the assistance (handlesReimbursements, LIFECYCLE_SPEC §13).
        handledBy: handlerOf(d, me.policyId),
      };
      d.claims.unshift(claim);
      refreshFlags(d, claim);
      return toMyClaim(d, claim, me);
    }),
  ),
  http.get(
    `${API}/me/appointments`,
    route(({ request, url }) => {
      const { me: viewer } = requireInsured(request);
      const d = db();
      const me = personFor(d, viewer, personIdParam(url), 'medical').person;
      return d.appointments.filter((a) => a.insuredId === me.id).sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1));
    }),
  ),
  http.post(
    `${API}/me/appointments`,
    route(async ({ request, url }) => {
      const { me: viewer } = requireInsured(request);
      const d = db();
      const me = personFor(d, viewer, personIdParam(url), 'medical').person;
      const input = await body(request, myAppointmentSchema);
      const a = await createAppointment(d, me, input);
      return a;
    }),
  ),
  http.post(
    `${API}/me/appointments/:id/cancel`,
    route(async (ctx) => {
      const { me } = requireInsured(ctx.request);
      const d = db();
      const a = myAppointment(d, me, param(ctx, 'id'));
      if (a.status !== 'requested' && a.status !== 'confirmed') throw conflict('srv.appointment.cannotCancel');
      a.status = 'cancelled';
      a.proposedStartsAt = undefined;
      await emitWebhook(d, a.clinicId, 'appointment.cancelled', a.id);
      pushEvent(d, a.clinicId, 'Пациент отменил запись');
      return a;
    }),
  ),
  http.post(
    `${API}/me/appointments/:id/accept-proposal`,
    route((ctx) => {
      const { me } = requireInsured(ctx.request);
      const d = db();
      const a = myAppointment(d, me, param(ctx, 'id'));
      if (a.status !== 'requested' || !a.proposedStartsAt) throw conflict('srv.appointment.noProposal');
      a.startsAt = a.proposedStartsAt;
      a.proposedStartsAt = undefined;
      a.status = 'confirmed';
      pushEvent(d, a.clinicId, 'Пациент принял предложенное время');
      return a;
    }),
  ),
  // «Ваш ассистанс 24/7» on the home screen (ASSISTANCE_SPEC §5.1); null — MIG serves the client.
  http.get(
    `${API}/me/assistance`,
    route(({ request }) => {
      const { me } = requireInsured(request);
      const d = db();
      const id = currentAssistance(d, me.policyId);
      const a = id ? d.assistances.find((x) => x.id === id) : undefined;
      const out: { assistance: AssistanceBrief | null } = { assistance: a ? { id: a.id, name: a.name, legalForm: a.legalForm, phone24x7: a.phone24x7, integrationMode: a.integrationMode } : null };
      return out;
    }),
  ),
  http.get(
    `${API}/me/chat`,
    route(({ request }) => {
      const { me } = requireInsured(request);
      const now = Date.now();
      return db()
        .chat.filter((m) => m.insuredId === me.id && parseIso(m.visibleAt) <= now)
        .map(({ insuredId: _i, visibleAt: _v, ...m }) => m);
    }),
  ),
  http.post(
    `${API}/me/chat`,
    route(async ({ request }) => {
      const { me } = requireInsured(request);
      const { text } = await body(request, chatSchema);
      const d = db();
      const now = Date.now();
      const msg = { id: randomId(), insuredId: me.id, from: 'insured' as const, text, at: tzIso(now), visibleAt: tzIso(now) };
      d.chat.push(msg);
      const n = d.chat.filter((m) => m.insuredId === me.id).length;
      d.chat.push({ id: randomId(), insuredId: me.id, from: 'operator', text: REPLIES[n % REPLIES.length]!, at: tzIso(now + 2000), visibleAt: tzIso(now + 2000) });
      const { insuredId: _i, visibleAt: _v, ...out } = msg;
      return out;
    }),
  ),
];
