import { delay, http } from 'msw';
import { chatSchema, consentSchema, myAppointmentSchema, myClaimSchema } from '@/shared/schemas/forms';
import type { SessionUser } from '@/shared/types';
import type { AssistanceBrief, CardToken, MePolicy, MeProfile, RecognizeResult } from '@/shared/types/dto';
import { detectMime, RECEIPT_LIMITS } from '@/shared/lib/image';
import { CARD_TOKEN_TTL_MS, formatShortCode, shortCodeFrom } from '@/shared/domain/clinics';
import { createAppointment, emitWebhook, pushEvent } from '../clinic-core';
import { currentAssistance } from '../assistance-core';
import { db, type ClaimRow, type InsuredRow } from '../db';
import { API, body, conflict, forbidden, HttpError, notFound, param, requireSession, route, validate } from '../http';
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

const REPLIES = [
  'Спасибо! Передали вопрос специалисту, ответим в течение часа.',
  'Проверили: услуга входит в вашу программу. Можно записываться.',
  'Уточните, пожалуйста, дату приёма и название клиники.',
];

async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, 'validation', 'Некорректные данные формы');
  }
}

async function readImage(file: File): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' }> {
  if (file.size === 0 || file.size > RECEIPT_LIMITS.maxBytes) throw new HttpError(422, 'validation', 'Файл больше 10 МБ', { files: 'Файл больше 10 МБ' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectMime(bytes);
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
    throw new HttpError(422, 'validation', 'Можно загрузить только фото JPEG, PNG или WEBP', { files: 'Неподдерживаемый формат' });
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
        payoutCardMasked: maskCard(me.payoutCard),
        consentGivenAt: me.consentGivenAt,
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
    route(({ request }) => {
      const { me } = requireInsured(request);
      const p = db().policies.find((x) => x.id === me.policyId)!;
      const out: MePolicy = {
        number: p.number,
        program: p.program,
        programName: PROGRAMS[p.program].name,
        companyName: me.clientName,
        startDate: p.startDate,
        endDate: p.endDate,
        limits: PROGRAMS[p.program].limits,
        ...(me.certificateNumber ? { certificateNumber: me.certificateNumber } : {}),
      };
      return out;
    }),
  ),
  http.get(
    `${API}/me/limits`,
    route(({ request }) => limitsFor(db(), requireInsured(request).me)),
  ),
  http.get(
    `${API}/me/card-token`,
    route(({ request }) => {
      const { me } = requireInsured(request);
      const d = db();
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
    route(({ request }) => {
      const { me } = requireInsured(request);
      return db()
        .claims.filter((c) => c.insuredId === me.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((c) => toMyClaim(c, me));
    }),
  ),
  http.get(
    `${API}/me/claims/:id`,
    route((ctx) => {
      const { me } = requireInsured(ctx.request);
      const c = db().claims.find((x) => x.id === param(ctx, 'id'));
      if (!c || c.insuredId !== me.id) throw notFound();
      return toMyClaim(c, me);
    }),
  ),
  http.post(
    `${API}/me/claims/recognize`,
    route(async ({ request }) => {
      requireInsured(request);
      const form = await readForm(request);
      const file = form.get('file');
      if (!(file instanceof File)) throw new HttpError(422, 'validation', 'Добавьте фото чека', { file: 'Добавьте фото чека' });
      const { bytes } = await readImage(file);
      if (mockConfig.latency[1] > 0) await delay(1000);
      // Fake OCR from the image itself: the server repeats it on submission and never takes fiscal data from the client.
      const out: RecognizeResult = recognizeReceipt(await sha256Hex(bytes));
      return out;
    }),
  ),
  http.post(
    `${API}/me/claims`,
    route(async ({ request }) => {
      const { me } = requireInsured(request);
      const form = await readForm(request);
      const files = form.getAll('files').filter((f): f is File => f instanceof File);
      if (files.length === 0) throw new HttpError(422, 'validation', 'Добавьте фото чека', { files: 'Добавьте фото чека' });
      if (files.length > RECEIPT_LIMITS.maxFiles) throw new HttpError(422, 'validation', 'Не больше 5 фото', { files: 'Не больше 5 фото' });
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
      return toMyClaim(claim, me);
    }),
  ),
  http.get(
    `${API}/me/appointments`,
    route(({ request }) => {
      const { me } = requireInsured(request);
      return db()
        .appointments.filter((a) => a.insuredId === me.id)
        .sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1));
    }),
  ),
  http.post(
    `${API}/me/appointments`,
    route(async ({ request }) => {
      const { me } = requireInsured(request);
      const input = await body(request, myAppointmentSchema);
      const a = await createAppointment(db(), me, input);
      return a;
    }),
  ),
  http.post(
    `${API}/me/appointments/:id/cancel`,
    route(async (ctx) => {
      const { me } = requireInsured(ctx.request);
      const d = db();
      const a = d.appointments.find((x) => x.id === param(ctx, 'id'));
      if (!a || a.insuredId !== me.id) throw notFound();
      if (a.status !== 'requested' && a.status !== 'confirmed') throw conflict('Эту запись уже нельзя отменить');
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
      const a = d.appointments.find((x) => x.id === param(ctx, 'id'));
      if (!a || a.insuredId !== me.id) throw notFound();
      if (a.status !== 'requested' || !a.proposedStartsAt) throw conflict('Клиника не предлагала другое время');
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
      const out: { assistance: AssistanceBrief | null } = { assistance: a ? { id: a.id, name: a.name, phone24x7: a.phone24x7, integrationMode: a.integrationMode } : null };
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
