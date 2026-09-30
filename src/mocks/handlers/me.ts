import { delay, http } from 'msw';
import { chatSchema, consentSchema, myAppointmentSchema, myClaimSchema } from '@/shared/schemas/forms';
import type { Appointment, SessionUser } from '@/shared/types';
import type { CardToken, MePolicy, MeProfile, RecognizeResult } from '@/shared/types/dto';
import { detectMime, RECEIPT_LIMITS } from '@/shared/lib/image';
import { CARD_TOKEN_TTL_MS, formatShortCode, shortCodeFrom } from '@/shared/domain/clinics';
import { emitWebhook, pushEvent } from '../clinic-core';
import { db, type ClaimRow, type InsuredRow } from '../db';
import { API, body, conflict, forbidden, HttpError, notFound, param, requireSession, route, validate } from '../http';
import { maskCard, maskPhone, maskPinfl } from '../mask';
import { hashString, int, mulberry32, pick, randomId, randomToken } from '../rng';
import { DAY, isoDay, parseIso, tzIso } from '../time';
import { limitsFor, toMyClaim } from '../views';
import { PROGRAMS } from '../programs';
import { nextClaimNumber } from './claims';
import { mockConfig } from '../config';

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
      const { me } = requireInsured(request);
      const form = await readForm(request);
      const file = form.get('file');
      if (!(file instanceof File)) throw new HttpError(422, 'validation', 'Добавьте фото чека', { file: 'Добавьте фото чека' });
      const { bytes } = await readImage(file);
      if (mockConfig.latency[1] > 0) await delay(1000);
      const rng = mulberry32(hashString(`${me.id}:${bytes.length}`));
      const out: RecognizeResult = {
        providerName: pick(rng, ['Аптека «Шифо Фарм»', 'Аптека «Нур Дори»', 'Медцентр «Саломат Плюс»', 'Клиника «Мадад Мед»']),
        amount: int(rng, 85, 450) * 1000,
        serviceDate: isoDay(Date.now() - int(rng, 0, 3) * DAY),
      };
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
      for (const [idx, f] of files.entries()) {
        const { bytes, mime } = await readImage(f);
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
      };
      d.claims.unshift(claim);
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
      const d = db();
      const clinic = d.clinics.find((c) => c.id === input.clinicId);
      if (!clinic || !clinic.specialties.includes(input.specialty)) throw notFound();
      const starts = parseIso(input.startsAt);
      if (Number.isNaN(starts) || starts < Date.now()) throw conflict('Это время уже прошло. Выберите другое');
      const iso = tzIso(starts);
      if (d.appointments.some((a) => a.clinicId === clinic.id && a.startsAt === iso && a.status !== 'cancelled' && a.status !== 'declined')) {
        throw conflict('Это время уже заняли. Выберите другое');
      }
      const a: Appointment = {
        id: randomId(),
        insuredId: me.id,
        insuredName: me.fullName,
        clientName: me.clientName,
        clinicId: clinic.id,
        clinicName: clinic.name,
        specialty: input.specialty,
        startsAt: iso,
        status: 'requested',
        createdAt: tzIso(Date.now()),
        ...(clinic.integrationMode === 'api' ? { fromClinicSystem: true } : {}),
      };
      d.appointments.push(a);
      await emitWebhook(d, clinic.id, 'appointment.requested', a.id);
      pushEvent(d, clinic.id, 'Новая заявка на запись');
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
