/* Server-side rules of policy issuance and insured-list changes (POLICY_SPEC). */
import { msg } from '@mig/i18n';
import Papa from 'papaparse';
import type { ClientDocument, InsuredRelation, Policy, PolicyChange, PolicyChangeKind, UUID } from '@mig/contracts';
import type { HrImportError } from '@mig/contracts/dto';
import { policyListRowSchema } from '@mig/contracts/forms';
import { changeDateProblem, POLICY_CSV_MAX_BYTES, POLICY_CSV_MAX_ROWS, proRataAmount } from '../policies';
import { formatMoney } from '../lib/format';
import { randomId } from '../lib/random';
import { tzIso } from '../lib/time';
import type { ClientRow, InsuredRow, PolicyChangeRow } from '../store/db';
import { DomainError, errorOf, systemRepos, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { annualPremiumOf } from './family';

export type PolicyListRow = ReturnType<typeof policyListRowSchema.parse>;

/** Parses and validates the initial list of insured persons (same rules as the preview). */
export function parsePolicyList(text: string): { total: number; rows: PolicyListRow[]; errors: HrImportError[] } {
  if (text.length > POLICY_CSV_MAX_BYTES) throw new DomainError(413, 'validation', 'srv.file.tooLarge5mb');
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  if (parsed.data.length > POLICY_CSV_MAX_ROWS) throw new DomainError(422, 'validation', 'srv.policy.overMaxRows', { params: { max: POLICY_CSV_MAX_ROWS } });
  const header = parsed.meta.fields ?? [];
  const missing = ['fullName', 'birthDate', 'pinfl', 'phone', 'position'].filter((h) => !header.includes(h));
  if (missing.length) throw new DomainError(422, 'validation', 'srv.hr.missingColumns', { params: { columns: missing.join(', ') } });
  const rows: { row: number; data: PolicyListRow }[] = [];
  const errors: HrImportError[] = [];
  const seen = new Set<string>();
  parsed.data.forEach((raw, idx) => {
    const r = policyListRowSchema.safeParse(raw);
    if (!r.success) {
      for (const issue of r.error.issues) errors.push({ row: idx + 2, field: String(issue.path[0] ?? ''), message: issue.message });
      return;
    }
    if (seen.has(r.data.pinfl)) {
      errors.push({ row: idx + 2, field: 'pinfl', message: msg('srv.census.pinflRepeated') });
      return;
    }
    seen.add(r.data.pinfl);
    rows.push({ row: idx + 2, data: r.data });
  });
  // A family member refers to an employee of the same list (a row per person, FAMILY_SPEC).
  const employees = new Set(rows.filter((x) => x.data.relation === 'employee').map((x) => x.data.pinfl));
  const ok = rows.filter((x) => {
    if (x.data.relation === 'employee' || employees.has(x.data.principal_pinfl ?? '')) return true;
    errors.push({ row: x.row, field: 'principal_pinfl', message: msg('srv.policy.principalNotInList') });
    return false;
  });
  errors.sort((a, b) => a.row - b.row);
  return { total: parsed.data.length, rows: ok.map((x) => x.data), errors };
}

/** Creates the persons of a list: employees first, then their family members under them. */
export async function createListedInsured(
  ctx: BaseCtx,
  client: ClientRow,
  policy: Policy,
  rows: readonly ContractListRow[],
  insuredFrom: string,
  appStatus: InsuredRow['appStatus'],
): Promise<InsuredRow[]> {
  const out: InsuredRow[] = [];
  const byPinfl = new Map<string, InsuredRow>();
  for (const r of [...rows].sort((a, b) => (a.relation === 'employee' ? 0 : 1) - (b.relation === 'employee' ? 0 : 1))) {
    const principal = r.relation === 'employee' ? undefined : byPinfl.get(r.principalPinfl ?? '');
    if (r.relation !== 'employee' && !principal) continue;
    const person = await createInsured(ctx, client, policy, { ...r, ...(principal ? { principalId: principal.id } : {}) }, insuredFrom, appStatus);
    byPinfl.set(person.pinfl, person);
    out.push(person);
  }
  return out;
}

/** A person of an initial list or appendix 2 (a row per person). */
export interface ContractListRow {
  fullName: string;
  position: string;
  birthDate: string;
  pinfl: string;
  phone: string;
  relation: InsuredRelation;
  principalPinfl?: string;
  isStudent?: boolean;
}

/** Parsed CSV row → a person of the list. */
export function toListRow(r: PolicyListRow): ContractListRow {
  return {
    fullName: r.fullName,
    position: r.position,
    birthDate: r.birthDate,
    pinfl: r.pinfl,
    phone: r.phone,
    relation: r.relation,
    ...(r.principal_pinfl ? { principalPinfl: r.principal_pinfl } : {}),
    ...(r.student ? { isStudent: true } : {}),
  };
}

/** A new insured person: an employee or a family member under `principalId` (FAMILY_SPEC). */
export interface NewPerson {
  fullName: string;
  position: string;
  birthDate: string;
  pinfl: string;
  /** Empty for a child without an own phone. */
  phone: string;
  relation?: InsuredRelation;
  principalId?: UUID;
  isStudent?: boolean;
}

export async function createInsured(ctx: BaseCtx, client: ClientRow, policy: Policy, person: NewPerson, insuredFrom: string, appStatus: InsuredRow['appStatus']): Promise<InsuredRow> {
  const relation = person.relation ?? 'employee';
  const firstClinic = (await ctx.repos.clinics.first())!;
  const row: InsuredRow = {
    id: randomId(),
    userId: randomId(),
    clientId: client.id,
    clientName: client.name,
    policyId: policy.id,
    fullName: person.fullName.replace(/\s+/g, ' '),
    position: person.position,
    birthDate: person.birthDate,
    pinfl: person.pinfl,
    phone: person.phone,
    email: `new${ctx.now() % 100000}@client.example.uz`,
    // A family member is paid to the employee's card until they set an own one.
    payoutCard: relation === 'employee' ? '8600000000000000' : '',
    relation,
    ...(relation !== 'employee' && person.principalId ? { principalId: person.principalId } : {}),
    ...(person.isStudent ? { isStudent: true } : {}),
    // Nobody to invite without a phone (a child lives in the parent's app).
    appStatus: person.phone ? appStatus : 'not_invited',
    myIdVerified: false,
    attachedClinicId: firstClinic.id,
    insuredFrom,
    status: 'active',
    addedAt: tzIso(ctx.now()),
  };
  await ctx.repos.insured.insert(row);
  return row;
}

export async function activePolicyOf(ctx: BaseCtx, client: ClientRow): Promise<Policy | undefined> {
  const p = client.activePolicyId ? await ctx.repos.policies.get(client.activePolicyId) : null;
  return p && (p.status === 'active' || p.status === 'draft') ? p : undefined;
}

export async function nextPolicyNumber(ctx: BaseCtx, year: number, P?: ParamsView): Promise<string> {
  const params = P ?? (await loadParams(ctx));
  const max = params.maxDocSeq('policy', (await ctx.repos.policies.list()).map((p) => p.number), { year, floor: 100 });
  return params.nextDocNumber('policy', { year, n: max + 1 });
}

export function toPolicyChange(row: PolicyChangeRow): PolicyChange {
  const { requestedById: _r, newPerson: _n, familyRequestId: _f, ...view } = row;
  return view;
}

/**
 * Recomputes the insured (every person) and family-member counters of a policy and the client's figures.
 * Saves the counters (and sets them on `policy`); other changes of `policy` are the caller's to save.
 */
export async function refreshPolicyTotals(ctx: BaseCtx, policy: Policy): Promise<void> {
  // Derived counters of the policy and the client: kept by the system after any change of the insured list.
  const r = systemRepos(ctx, 'derived counters of a policy and its client after a change of the insured list');
  const members = await r.insured.list({ where: { policyId: policy.id, status: 'active' } });
  policy.insuredCount = members.length;
  policy.familyCount = members.filter((i) => i.relation !== 'employee').length;
  await r.policies.update(policy.id, { insuredCount: policy.insuredCount, familyCount: policy.familyCount });
  const client = await r.clients.get(policy.clientId);
  if (client && client.activePolicyId === policy.id) await r.clients.update(client.id, { premium: policy.premium });
}

export async function requestChange(
  ctx: BaseCtx,
  actor: { id: UUID; displayName: string },
  client: ClientRow,
  kind: PolicyChangeKind,
  input: {
    effectiveDate: string;
    fullName: string;
    position: string;
    /** Who the person is; a family member goes under `principal` (an active employee of the client). */
    relation?: InsuredRelation;
    principal?: InsuredRow;
    insured?: InsuredRow;
    newPerson?: PolicyChangeRow['newPerson'];
    familyRequestId?: UUID;
  },
): Promise<PolicyChangeRow> {
  const policy = await activePolicyOf(ctx, client);
  if (!policy) throw new DomainError(409, 'conflict', 'srv.policyChanges.noPolicy');
  const dateProblem = changeDateProblem(policy, kind, input.effectiveDate, input.insured?.insuredFrom);
  if (dateProblem) throw errorOf(422, 'validation', dateProblem, { [kind === 'add' ? 'startDate' : 'excludeFrom']: dateProblem });
  const pending = await ctx.repos.policyChanges.list({ where: { clientId: client.id, status: 'pending' } });
  if (kind === 'exclude' && pending.some((c) => c.insuredId === input.insured?.id)) throw new DomainError(409, 'conflict', 'srv.policyChanges.alreadyRequested');
  if (kind === 'add' && pending.some((c) => c.newPerson?.pinfl === input.newPerson?.pinfl)) {
    throw new DomainError(409, 'conflict', 'srv.policyChanges.alreadySent', { fields: { pinfl: msg('srv.policyChanges.sentShort') } });
  }
  const relation = input.insured?.relation ?? input.relation ?? 'employee';
  const principal = input.insured ? (input.insured.principalId ? ((await ctx.repos.insured.get(input.insured.principalId)) ?? undefined) : undefined) : input.principal;
  if (relation !== 'employee' && (!principal || principal.clientId !== client.id || principal.relation !== 'employee')) throw new DomainError(422, 'validation', 'srv.family.noEmployee', { fields: { employeeId: msg('srv.family.noEmployee') } });
  const birthDate = input.insured?.birthDate ?? input.newPerson?.birthDate ?? '';
  // Each person has an own premium by the contract terms (by type or by the age band); a transferred
  // person carries the annual premium of the previous system (refunded on exclusion).
  const annual = input.insured?.migratedPremium ? input.insured.migratedPremium.amount : await annualPremiumOf(ctx, policy, { relation, birthDate }, input.effectiveDate);
  const row: PolicyChangeRow = {
    id: randomId(),
    clientId: client.id,
    clientName: client.name,
    policyId: policy.id,
    policyNumber: policy.number,
    kind,
    insuredId: input.insured?.id,
    fullName: input.fullName.replace(/\s+/g, ' '),
    position: input.position,
    relation,
    ...(relation !== 'employee' && principal ? { principalId: principal.id, principalName: principal.fullName } : {}),
    effectiveDate: input.effectiveDate,
    premiumDelta: proRataAmount(policy, annual, kind, input.effectiveDate),
    status: 'pending',
    requestedAt: tzIso(ctx.now()),
    requestedByName: actor.displayName,
    requestedById: actor.id,
    newPerson: input.newPerson,
    ...(input.familyRequestId ? { familyRequestId: input.familyRequestId } : {}),
  };
  await ctx.repos.policyChanges.insert(row, { at: 'start' });
  return row;
}

/** Endorsement number k for a policy: one more than the endorsements it already has. */
export async function endorsementDoc(ctx: BaseCtx, policy: Policy, added: number, excluded: number, delta: number, date: string): Promise<ClientDocument> {
  const k = (await ctx.repos.documents.list({ where: { kind: 'endorsement' } })).filter((x) => x.title.includes(policy.number)).length + 1;
  const parts = [added ? `прикреплено ${added}` : '', excluded ? `исключено ${excluded}` : '', delta ? `${delta > 0 ? 'доплата' : 'возврат'} ${formatMoney(Math.abs(delta))}` : ''].filter(Boolean).join(', ');
  return {
    id: randomId(),
    clientId: policy.clientId,
    title: `Дополнительное соглашение № ${k} к полису ${policy.number} от ${date.split('-').reverse().join('.')}${parts ? ` (${parts})` : ''}`,
    kind: 'endorsement',
    createdAt: date,
  };
}
