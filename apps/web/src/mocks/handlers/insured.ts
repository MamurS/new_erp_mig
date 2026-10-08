import { matchesSearch } from '@/shared/lib/searchNormalize';
import { http } from 'msw';
import { z } from 'zod';
import { medicalAccessSchema, piiField, revealSchema } from '@mig/contracts/forms';
import type { MedicalRecordEntry, Specialty } from '@mig/contracts';
import type { InsuredClaimSummary, InsuredDocument, MedicalGrant, RevealResponse } from '@mig/contracts/dto';
import { can } from '@mig/domain/auth/permissions';
import { db, type InsuredRow } from '../db';
import {
  API,
  audit,
  body,
  forbidden,
  HttpError,
  insuredLabel,
  notFound,
  paginate,
  param,
  q,
  requirePermission,
  requireSession,
  route,
  sortBy,
} from '../http';
import { hashString, int, mulberry32, pick, randomId, randomToken, uuidFrom } from '@mig/seed/rng';
import { DAY, isoDay, tzIso } from '@mig/seed/time';
import { limitsFor, toInsuredDetail, toInsuredListItem } from '../views';
import { formatPhoneFull } from '@mig/domain/lib/mask';

const MEDICAL_TTL = 15 * 60_000;

export function findInsured(id: string): InsuredRow {
  const i = db().insured.find((x) => x.id === id);
  if (!i) throw notFound();
  return i;
}

const SPECS: Specialty[] = ['therapist', 'dentist', 'cardiologist', 'ent', 'neurologist', 'ophthalmologist'];
const SUMMARIES = [
  'Жалобы на недомогание, назначено амбулаторное лечение.',
  'Плановый осмотр, отклонений не выявлено.',
  'Контрольный приём, рекомендовано наблюдение.',
  'Назначены анализы и повторный приём через 2 недели.',
];
const ICD = ['J06.9', 'K29.7', 'M54.5', 'I10', 'H52.1', 'K02.1', 'J20.9', 'R51', 'L30.9', 'Z00.0'];

/** Fictional medical history, derived deterministically from the insured id (not stored). */
export function medicalRecords(i: InsuredRow): MedicalRecordEntry[] {
  const rng = mulberry32(hashString(i.id));
  const d = db();
  const n = int(rng, 2, 6);
  const out: MedicalRecordEntry[] = [];
  for (let k = 0; k < n; k++) {
    out.push({
      id: uuidFrom(rng),
      insuredId: i.id,
      date: isoDay(Date.now() - int(rng, 5, 700) * DAY),
      clinicName: pick(rng, d.clinics).name,
      specialty: pick(rng, SPECS),
      diagnosisCode: pick(rng, ICD),
      summary: pick(rng, SUMMARIES),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export const insuredHandlers = [
  http.get(
    `${API}/insured`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'insured.read');
      if (user.role === 'hr' || user.role === 'insured') throw notFound();
      let list = db().insured;
      const term = q(url);
      if (term) list = list.filter((i) => matchesSearch(term, i.fullName));
      const clientId = url.searchParams.get('clientId');
      if (clientId) list = list.filter((i) => i.clientId === clientId);
      const p = paginate(sortBy(list, url, { fullName: (i) => i.fullName, clientName: (i) => i.clientName }, 'fullName:asc'), url);
      return { ...p, items: p.items.map((i) => toInsuredListItem(db(), i, user)) };
    }),
  ),
  http.get(
    `${API}/insured/:id`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'insured.read');
      if (user.role === 'hr' || user.role === 'insured' || user.role === 'accountant') throw notFound();
      return toInsuredDetail(db(), findInsured(param(ctx, 'id')));
    }),
  ),
  http.get(
    `${API}/insured/:id/limits`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'insured.read');
      if (user.role === 'hr' || user.role === 'insured' || user.role === 'accountant') throw notFound();
      return limitsFor(db(), findInsured(param(ctx, 'id')));
    }),
  ),
  http.get(
    `${API}/insured/:id/claims`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'insured.read');
      if (user.role === 'hr' || user.role === 'insured' || user.role === 'accountant') throw notFound();
      const i = findInsured(param(ctx, 'id'));
      if (!can(user, 'claims.read')) return [];
      const list: InsuredClaimSummary[] = db()
        .claims.filter((c) => c.insuredId === i.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((c) => ({ id: c.id, number: c.number, category: c.category, amountClaimed: c.amountClaimed, status: c.status, createdAt: c.createdAt }));
      return list;
    }),
  ),
  http.get(
    `${API}/insured/:id/documents`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'insured.read');
      if (user.role === 'hr' || user.role === 'insured' || user.role === 'accountant') throw notFound();
      const i = findInsured(param(ctx, 'id'));
      const d = db();
      const policy = d.policies.find((p) => p.id === i.policyId)!;
      const docs: InsuredDocument[] = [
        ...d.insuredDocuments.filter((x) => x.insuredId === i.id).map(({ insuredId: _i, ...x }) => x),
        { id: policy.id, title: `Полис ${policy.number} (выписка на застрахованного)`, createdAt: policy.startDate },
      ];
      return docs;
    }),
  ),
  http.get(
    `${API}/insured/:id/access-log`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'insured.read');
      if (user.role === 'hr' || user.role === 'insured' || user.role === 'accountant') throw notFound();
      const i = findInsured(param(ctx, 'id'));
      return db().audit.filter((e) => e.targetId === i.id && (e.action === 'reveal_pii' || e.action === 'open_medical'));
    }),
  ),
  http.post(
    `${API}/insured/:id/reveal`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'insured.reveal_pii');
      const i = findInsured(param(ctx, 'id'));
      const { field, reason } = await body(ctx.request, revealSchema);
      const value =
        field === 'pinfl'
          ? i.pinfl
          : field === 'phone'
            ? formatPhoneFull(i.phone)
            : field === 'birthDate'
              ? i.birthDate.split('-').reverse().join('.')
              : i.email;
      audit(user, 'reveal_pii', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason: `${fieldLabel(field)}: ${reason}` });
      const out: RevealResponse = { value, expiresInSec: 30 };
      return out;
    }),
  ),
  http.post(
    `${API}/insured/:id/reveal-copied`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'insured.reveal_pii');
      const i = findInsured(param(ctx, 'id'));
      const { field } = await body(ctx.request, z.object({ field: piiField }));
      audit(user, 'reveal_pii', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason: `Копирование: ${fieldLabel(field)}` });
      return { ok: true as const };
    }),
  ),
  http.post(
    `${API}/insured/:id/medical-access`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'medical.read');
      const i = findInsured(param(ctx, 'id'));
      const { reason } = await body(ctx.request, medicalAccessSchema);
      const d = db();
      const grant = { id: randomToken(24), userId: user.id, insuredId: i.id, expiresAt: Date.now() + MEDICAL_TTL };
      d.grants = d.grants.filter((g) => g.expiresAt > Date.now());
      d.grants.push(grant);
      audit(user, 'open_medical', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason });
      const out: MedicalGrant = { grantId: grant.id, expiresAt: tzIso(grant.expiresAt) };
      return out;
    }),
  ),
  http.get(
    `${API}/insured/:id/medical`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'medical.read');
      const i = findInsured(param(ctx, 'id'));
      const grantId = ctx.request.headers.get('x-medical-grant') ?? '';
      const g = db().grants.find((x) => x.id === grantId);
      if (!g || g.userId !== user.id || g.insuredId !== i.id || g.expiresAt < Date.now()) {
        throw new HttpError(403, 'forbidden', 'srv.medcard.accessExpired');
      }
      return medicalRecords(i);
    }),
  ),
  http.post(
    `${API}/insured/:id/guarantee-letters`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      if (user.role !== 'operator') throw forbidden();
      const i = findInsured(param(ctx, 'id'));
      const input = await body(ctx.request, z.object({ clinicId: z.string().uuid(), service: z.string().trim().min(3).max(200) }));
      const clinic = db().clinics.find((c) => c.id === input.clinicId);
      if (!clinic) throw notFound();
      const doc = { id: randomId(), insuredId: i.id, title: `Гарантийное письмо в ${clinic.name}: ${input.service}`, createdAt: isoDay(Date.now()) };
      db().insuredDocuments.unshift(doc);
      return { id: doc.id };
    }),
  ),
];

export function fieldLabel(f: string): string {
  return f === 'pinfl' ? 'ПИНФЛ' : f === 'phone' ? 'Телефон' : f === 'birthDate' ? 'Дата рождения' : 'Email';
}
