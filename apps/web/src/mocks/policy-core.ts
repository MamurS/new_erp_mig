/* Server-side rules of policy issuance and insured-list changes (POLICY_SPEC). */
import { msg } from '@mig/i18n';
import Papa from 'papaparse';
import type { ClientDocument, InsuredRelation, Policy, PolicyChange, PolicyChangeKind, UUID } from '@mig/contracts';
import type { HrImportError } from '@mig/contracts/dto';
import { changeDateProblem, POLICY_CSV_MAX_BYTES, POLICY_CSV_MAX_ROWS, proRataAmount } from '@mig/domain/policies';
import { annualPremiumOf } from './family-core';
import { policyListRowSchema } from '@mig/contracts/forms';
import { formatMoney } from '@mig/domain/lib/format';
import type { ClientRow, Db, InsuredRow, PolicyChangeRow } from './db';
import { HttpError, httpErrorOf } from './http';
import { randomId } from '@mig/seed/rng';
import { tzIso } from '@mig/seed/time';
import { maxDocSeq, nextDocNumber } from './params';

export type PolicyListRow = ReturnType<typeof policyListRowSchema.parse>;

/** Parses and validates the initial list of insured persons (same rules as the preview). */
export function parsePolicyList(text: string): { total: number; rows: PolicyListRow[]; errors: HrImportError[] } {
  if (text.length > POLICY_CSV_MAX_BYTES) throw new HttpError(413, 'validation', 'srv.file.tooLarge5mb');
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  if (parsed.data.length > POLICY_CSV_MAX_ROWS) throw new HttpError(422, 'validation', 'srv.policy.overMaxRows', { params: { max: POLICY_CSV_MAX_ROWS } });
  const header = parsed.meta.fields ?? [];
  const missing = ['fullName', 'birthDate', 'pinfl', 'phone', 'position'].filter((h) => !header.includes(h));
  if (missing.length) throw new HttpError(422, 'validation', 'srv.hr.missingColumns', { params: { columns: missing.join(', ') } });
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
export function createListedInsured(d: Db, client: ClientRow, policy: Policy, rows: readonly ContractListRow[], insuredFrom: string, appStatus: InsuredRow['appStatus']): InsuredRow[] {
  const out: InsuredRow[] = [];
  const byPinfl = new Map<string, InsuredRow>();
  for (const r of [...rows].sort((a, b) => (a.relation === 'employee' ? 0 : 1) - (b.relation === 'employee' ? 0 : 1))) {
    const principal = r.relation === 'employee' ? undefined : byPinfl.get(r.principalPinfl ?? '');
    if (r.relation !== 'employee' && !principal) continue;
    const person = createInsured(d, client, policy, { ...r, ...(principal ? { principalId: principal.id } : {}) }, insuredFrom, appStatus);
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

export function createInsured(d: Db, client: ClientRow, policy: Policy, person: NewPerson, insuredFrom: string, appStatus: InsuredRow['appStatus']): InsuredRow {
  const relation = person.relation ?? 'employee';
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
    email: `new${Date.now() % 100000}@client.example.uz`,
    // A family member is paid to the employee's card until they set an own one.
    payoutCard: relation === 'employee' ? '8600000000000000' : '',
    relation,
    ...(relation !== 'employee' && person.principalId ? { principalId: person.principalId } : {}),
    ...(person.isStudent ? { isStudent: true } : {}),
    // Nobody to invite without a phone (a child lives in the parent's app).
    appStatus: person.phone ? appStatus : 'not_invited',
    myIdVerified: false,
    attachedClinicId: d.clinics[0]!.id,
    insuredFrom,
    status: 'active',
    addedAt: tzIso(Date.now()),
  };
  d.insured.push(row);
  return row;
}

export function activePolicyOf(d: Db, client: ClientRow): Policy | undefined {
  const p = d.policies.find((x) => x.id === client.activePolicyId);
  return p && (p.status === 'active' || p.status === 'draft') ? p : undefined;
}

export function nextPolicyNumber(d: Db, year: number): string {
  const max = maxDocSeq('policy', d.policies.map((p) => p.number), { year, floor: 100 });
  return nextDocNumber('policy', { year, n: max + 1 });
}

export function toPolicyChange(row: PolicyChangeRow): PolicyChange {
  const { requestedById: _r, newPerson: _n, familyRequestId: _f, ...view } = row;
  return view;
}

/** Recomputes the insured (every person) and family-member counters of a policy and the client's figures. */
export function refreshPolicyTotals(d: Db, policy: Policy): void {
  const members = d.insured.filter((i) => i.policyId === policy.id && i.status === 'active');
  policy.insuredCount = members.length;
  policy.familyCount = members.filter((i) => i.relation !== 'employee').length;
  const client = d.clients.find((c) => c.id === policy.clientId);
  if (client && client.activePolicyId === policy.id) client.premium = policy.premium;
}

export function requestChange(
  d: Db,
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
): PolicyChangeRow {
  const policy = activePolicyOf(d, client);
  if (!policy) throw new HttpError(409, 'conflict', 'srv.policyChanges.noPolicy');
  const dateProblem = changeDateProblem(policy, kind, input.effectiveDate, input.insured?.insuredFrom);
  if (dateProblem) throw httpErrorOf(422, 'validation', dateProblem, { [kind === 'add' ? 'startDate' : 'excludeFrom']: dateProblem });
  const pending = d.policyChanges.filter((c) => c.clientId === client.id && c.status === 'pending');
  if (kind === 'exclude' && pending.some((c) => c.insuredId === input.insured?.id)) throw new HttpError(409, 'conflict', 'srv.policyChanges.alreadyRequested');
  if (kind === 'add' && pending.some((c) => c.newPerson?.pinfl === input.newPerson?.pinfl)) {
    throw new HttpError(409, 'conflict', 'srv.policyChanges.alreadySent', { fields: { pinfl: msg('srv.policyChanges.sentShort') } });
  }
  const relation = input.insured?.relation ?? input.relation ?? 'employee';
  const principal = input.insured ? d.insured.find((i) => i.id === input.insured!.principalId) : input.principal;
  if (relation !== 'employee' && (!principal || principal.clientId !== client.id || principal.relation !== 'employee')) throw new HttpError(422, 'validation', 'srv.family.noEmployee', { fields: { employeeId: msg('srv.family.noEmployee') } });
  const birthDate = input.insured?.birthDate ?? input.newPerson?.birthDate ?? '';
  // Each person has an own premium by the contract terms (by type or by the age band); a transferred
  // person carries the annual premium of the previous system (refunded on exclusion).
  const annual = input.insured?.migratedPremium ? input.insured.migratedPremium.amount : annualPremiumOf(d, policy, { relation, birthDate }, input.effectiveDate);
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
    requestedAt: tzIso(Date.now()),
    requestedByName: actor.displayName,
    requestedById: actor.id,
    newPerson: input.newPerson,
    ...(input.familyRequestId ? { familyRequestId: input.familyRequestId } : {}),
  };
  d.policyChanges.unshift(row);
  return row;
}

/** Endorsement number k for a policy: one more than the endorsements it already has. */
export function endorsementDoc(d: Db, policy: Policy, added: number, excluded: number, delta: number, date: string): ClientDocument {
  const k = d.documents.filter((x) => x.kind === 'endorsement' && x.title.includes(policy.number)).length + 1;
  const parts = [added ? `прикреплено ${added}` : '', excluded ? `исключено ${excluded}` : '', delta ? `${delta > 0 ? 'доплата' : 'возврат'} ${formatMoney(Math.abs(delta))}` : ''].filter(Boolean).join(', ');
  return {
    id: randomId(),
    clientId: policy.clientId,
    title: `Дополнительное соглашение № ${k} к полису ${policy.number} от ${date.split('-').reverse().join('.')}${parts ? ` (${parts})` : ''}`,
    kind: 'endorsement',
    createdAt: date,
  };
}
