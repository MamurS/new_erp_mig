/*
 * Insured people in the staff portal (/api/insured/...): the list, the card, limits, claims, documents, the
 * log of access to personal data, «Показать» (reveal with a reason, audited), and the medical record behind
 * a time-limited grant (SPEC §9).
 */
import { z } from 'zod';
import type { AuditEntry, Clinic, LimitUsage, MedicalRecordEntry, Page, Specialty } from '@mig/contracts';
import type { InsuredClaimSummary, InsuredDetail, InsuredDocument, InsuredListItem, MedicalGrant, RevealResponse } from '@mig/contracts/dto';
import { medicalAccessSchema, piiField, revealSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { formatPhoneFull } from '../lib/mask';
import { randomId, randomToken } from '../lib/random';
import { hashString, int, mulberry32, pick, uuidFrom } from '../lib/rng';
import { DAY, isoDay, tzIso } from '../lib/time';
import type { InsuredRow } from '../store/db';
import { audit, DomainError, forbidden, insuredLabel, notFound, requirePermission, validate, type AuthCtx, type BaseCtx } from './kernel';
import { allOf, pageOf, q, sortParam, sp, type Qs } from './list';
import { limitsFor, toInsuredDetail, toInsuredListItems } from './views';

/** How long a grant to read the medical history lasts. */
export const MEDICAL_TTL = 15 * 60_000;

export async function findInsured(ctx: BaseCtx, id: string): Promise<InsuredRow> {
  const i = await ctx.repos.insured.get(id);
  if (!i) throw notFound();
  return i;
}

export function fieldLabel(f: string): string {
  return f === 'pinfl' ? 'ПИНФЛ' : f === 'phone' ? 'Телефон' : f === 'birthDate' ? 'Дата рождения' : 'Email';
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
export function medicalRecordsOf(i: Pick<InsuredRow, 'id'>, clinics: readonly Pick<Clinic, 'name'>[], now: number): MedicalRecordEntry[] {
  const rng = mulberry32(hashString(i.id));
  const n = int(rng, 2, 6);
  const out: MedicalRecordEntry[] = [];
  for (let k = 0; k < n; k++) {
    out.push({
      id: uuidFrom(rng),
      insuredId: i.id,
      date: isoDay(now - int(rng, 5, 700) * DAY),
      clinicName: pick(rng, clinics).name,
      specialty: pick(rng, SPECS),
      diagnosisCode: pick(rng, ICD),
      summary: pick(rng, SUMMARIES),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function medicalRecords(ctx: BaseCtx, i: Pick<InsuredRow, 'id'>): Promise<MedicalRecordEntry[]> {
  return medicalRecordsOf(i, await ctx.repos.clinics.list(), ctx.now());
}

/** The staff card of a person: HR, the insured and (for the card) the accountant do not see it at all. */
function requireCardReader(ctx: AuthCtx, opts: { accountant: boolean }): void {
  const { user } = ctx;
  requirePermission(user, 'insured.read');
  if (user.role === 'hr' || user.role === 'insured' || (opts.accountant && user.role === 'accountant')) throw notFound();
}

// ---------------------------------------------------------------- endpoints

/** GET /insured: search, client filter, sort and page (in SQL: the page, the order and the total). */
export async function list(ctx: AuthCtx, qs: Qs): Promise<Page<InsuredListItem>> {
  requireCardReader(ctx, { accountant: false });
  const clientId = sp(qs).get('clientId');
  const term = q(qs);
  const p = await pageOf(ctx.repos.insured, qs, {
    where: allOf<InsuredRow>(clientId && { clientId }, term && { fullName: { search: term } }),
    orderBy: sortParam<InsuredRow>(qs, { fullName: { field: 'fullName', collate: 'ru' }, clientName: { field: 'clientName', collate: 'ru' } }, 'fullName:asc'),
  });
  return { ...p, items: await toInsuredListItems(ctx, p.items, ctx.user) };
}

/** GET /insured/:id. */
export async function detail(ctx: AuthCtx, id: string): Promise<InsuredDetail> {
  requireCardReader(ctx, { accountant: true });
  return toInsuredDetail(ctx, await findInsured(ctx, id));
}

/** GET /insured/:id/limits. */
export async function limits(ctx: AuthCtx, id: string): Promise<LimitUsage[]> {
  requireCardReader(ctx, { accountant: true });
  return limitsFor(ctx, await findInsured(ctx, id));
}

/** GET /insured/:id/claims: the newest first; empty for roles without access to claims. */
export async function claims(ctx: AuthCtx, id: string): Promise<InsuredClaimSummary[]> {
  requireCardReader(ctx, { accountant: true });
  const i = await findInsured(ctx, id);
  if (!can(ctx.user, 'claims.read')) return [];
  return (await ctx.repos.claims.list({ where: { insuredId: i.id }, orderBy: [['createdAt', 'desc']] })).map((c) => ({
    id: c.id,
    number: c.number,
    category: c.category,
    amountClaimed: c.amountClaimed,
    status: c.status,
    createdAt: c.createdAt,
  }));
}

/** GET /insured/:id/documents: guarantee letters and the policy extract. */
export async function documents(ctx: AuthCtx, id: string): Promise<InsuredDocument[]> {
  requireCardReader(ctx, { accountant: true });
  const i = await findInsured(ctx, id);
  const policy = (await ctx.repos.policies.get(i.policyId))!;
  return [
    ...(await ctx.repos.insuredDocuments.list({ where: { insuredId: i.id } })).map(({ insuredId: _i, ...x }) => x),
    { id: policy.id, title: `Полис ${policy.number} (выписка на застрахованного)`, createdAt: policy.startDate },
  ];
}

/** GET /insured/:id/access-log: who revealed personal data or opened the medical record. */
export async function accessLog(ctx: AuthCtx, id: string): Promise<AuditEntry[]> {
  requireCardReader(ctx, { accountant: true });
  const i = await findInsured(ctx, id);
  // The reader may not read the audit log: the openings of this person come from app.fact_person_access_log.
  return ctx.repos.facts.personAccessLog(i.id);
}

/** POST /insured/:id/reveal: the full value for 30 seconds, with a reason, audited. */
export async function reveal(ctx: AuthCtx, id: string, body: unknown): Promise<RevealResponse> {
  const { user } = ctx;
  requirePermission(user, 'insured.reveal_pii');
  const i = await findInsured(ctx, id);
  const { field, reason } = validate(revealSchema, body);
  const value =
    field === 'pinfl' ? i.pinfl : field === 'phone' ? formatPhoneFull(i.phone) : field === 'birthDate' ? i.birthDate.split('-').reverse().join('.') : i.email;
  await audit(ctx, user, 'reveal_pii', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason: `${fieldLabel(field)}: ${reason}` });
  return { value, expiresInSec: 30 };
}

/** POST /insured/:id/reveal-copied: a revealed value was copied. */
export async function revealCopied(ctx: AuthCtx, id: string, body: unknown): Promise<{ ok: true }> {
  const { user } = ctx;
  requirePermission(user, 'insured.reveal_pii');
  const i = await findInsured(ctx, id);
  const { field } = validate(z.object({ field: piiField }), body);
  await audit(ctx, user, 'reveal_pii', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason: `Копирование: ${fieldLabel(field)}` });
  return { ok: true as const };
}

/** POST /insured/:id/medical-access: a 15-minute grant to the medical record, with a reason. */
export async function medicalAccess(ctx: AuthCtx, id: string, body: unknown): Promise<MedicalGrant> {
  const { user } = ctx;
  requirePermission(user, 'medical.read');
  const i = await findInsured(ctx, id);
  const { reason } = validate(medicalAccessSchema, body);
  const grant = { id: randomToken(24), userId: user.id, insuredId: i.id, expiresAt: ctx.now() + MEDICAL_TTL };
  await ctx.repos.grants.removeWhere({ expiresAt: { lte: ctx.now() } });
  await ctx.repos.grants.insert(grant);
  await audit(ctx, user, 'open_medical', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason });
  return { grantId: grant.id, expiresAt: tzIso(grant.expiresAt) };
}

/** GET /insured/:id/medical with the grant of the X-Medical-Grant header. */
export async function medical(ctx: AuthCtx, id: string, grantId: string): Promise<MedicalRecordEntry[]> {
  const { user } = ctx;
  requirePermission(user, 'medical.read');
  const i = await findInsured(ctx, id);
  const g = await ctx.repos.grants.get(grantId);
  if (!g || g.userId !== user.id || g.insuredId !== i.id || g.expiresAt < ctx.now()) {
    throw new DomainError(403, 'forbidden', 'srv.medcard.accessExpired');
  }
  return medicalRecords(ctx, i);
}

/** POST /insured/:id/guarantee-letters: the operator issues a letter to a clinic (a document of the person). */
export async function issueGuaranteeLetter(ctx: AuthCtx, id: string, body: unknown): Promise<{ id: string }> {
  if (ctx.user.role !== 'operator') throw forbidden();
  const i = await findInsured(ctx, id);
  const input = validate(z.object({ clinicId: z.string().uuid(), service: z.string().trim().min(3).max(200) }), body);
  const clinic = await ctx.repos.clinics.get(input.clinicId);
  if (!clinic) throw notFound();
  const doc = { id: randomId(), insuredId: i.id, title: `Гарантийное письмо в ${clinic.name}: ${input.service}`, createdAt: isoDay(ctx.now()) };
  await ctx.repos.insuredDocuments.insert(doc, { at: 'start' });
  return { id: doc.id };
}
