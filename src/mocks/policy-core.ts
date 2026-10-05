/* Server-side rules of policy issuance and insured-list changes (POLICY_SPEC). */
import Papa from 'papaparse';
import type { ClientDocument, Policy, PolicyChange, PolicyChangeKind, UUID } from '@/shared/types';
import type { HrImportError } from '@/shared/types/dto';
import { changeDateProblem, POLICY_CSV_MAX_BYTES, POLICY_CSV_MAX_ROWS, proRataDelta, tariffOf } from '@/shared/domain/policies';
import { policyListRowSchema } from '@/shared/schemas/forms';
import { formatMoney } from '@/shared/lib/format';
import type { ClientRow, Db, InsuredRow, PolicyChangeRow } from './db';
import { HttpError } from './http';
import { randomId } from './rng';
import { tzIso } from './time';
import { msg } from '@/i18n/core';

export type PolicyListRow = ReturnType<typeof policyListRowSchema.parse>;

/** Parses and validates the initial list of insured persons (same rules as the preview). */
export function parsePolicyList(text: string): { total: number; rows: PolicyListRow[]; errors: HrImportError[] } {
  if (text.length > POLICY_CSV_MAX_BYTES) throw new HttpError(413, 'validation', 'srv.file.tooLarge5mb');
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  if (parsed.data.length > POLICY_CSV_MAX_ROWS) throw new HttpError(422, 'validation', `В файле больше ${POLICY_CSV_MAX_ROWS} строк`);
  const header = parsed.meta.fields ?? [];
  const missing = ['fullName', 'birthDate', 'pinfl', 'phone', 'position'].filter((h) => !header.includes(h));
  if (missing.length) throw new HttpError(422, 'validation', `В файле нет колонок: ${missing.join(', ')}. Скачайте шаблон`);
  const rows: PolicyListRow[] = [];
  const errors: HrImportError[] = [];
  const seen = new Set<string>();
  parsed.data.forEach((raw, idx) => {
    const r = policyListRowSchema.safeParse(raw);
    if (!r.success) {
      for (const issue of r.error.issues) errors.push({ row: idx + 2, field: String(issue.path[0] ?? ''), message: issue.message });
      return;
    }
    if (seen.has(r.data.pinfl)) {
      errors.push({ row: idx + 2, field: 'pinfl', message: 'ПИНФЛ повторяется в файле' });
      return;
    }
    seen.add(r.data.pinfl);
    rows.push(r.data);
  });
  return { total: parsed.data.length, rows, errors };
}

export function createInsured(
  d: Db,
  client: ClientRow,
  policy: Policy,
  person: { fullName: string; position: string; birthDate: string; pinfl: string; phone: string; familyMembers: number },
  insuredFrom: string,
  appStatus: InsuredRow['appStatus'],
): InsuredRow {
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
    payoutCard: '8600000000000000',
    familyMembersCount: person.familyMembers,
    appStatus,
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
  const prefix = `ДМС-${year}-`;
  const max = d.policies.filter((p) => p.number.startsWith(prefix)).reduce((m, p) => Math.max(m, Number(p.number.slice(prefix.length)) || 0), 100);
  return `${prefix}${String(max + 1).padStart(6, '0')}`;
}

export function toPolicyChange(row: PolicyChangeRow): PolicyChange {
  const { requestedById: _r, newPerson: _n, ...view } = row;
  return view;
}

/** Recomputes the insured and family counters of a policy and the client's figures. */
export function refreshPolicyTotals(d: Db, policy: Policy): void {
  const members = d.insured.filter((i) => i.policyId === policy.id && i.status === 'active');
  policy.insuredCount = members.length;
  policy.familyCount = members.reduce((s, i) => s + i.familyMembersCount, 0);
  const client = d.clients.find((c) => c.id === policy.clientId);
  if (client && client.activePolicyId === policy.id) client.premium = policy.premium;
}

export function requestChange(
  d: Db,
  actor: { id: UUID; displayName: string },
  client: ClientRow,
  kind: PolicyChangeKind,
  input: { effectiveDate: string; fullName: string; position: string; familyMembers: number; insured?: InsuredRow; newPerson?: PolicyChangeRow['newPerson'] },
): PolicyChangeRow {
  const policy = activePolicyOf(d, client);
  if (!policy) throw new HttpError(409, 'conflict', 'srv.policyChanges.noPolicy');
  const dateProblem = changeDateProblem(policy, kind, input.effectiveDate, input.insured?.insuredFrom);
  if (dateProblem) throw new HttpError(422, 'validation', dateProblem, { [kind === 'add' ? 'startDate' : 'excludeFrom']: dateProblem });
  const pending = d.policyChanges.filter((c) => c.clientId === client.id && c.status === 'pending');
  if (kind === 'exclude' && pending.some((c) => c.insuredId === input.insured?.id)) throw new HttpError(409, 'conflict', 'srv.policyChanges.alreadyRequested');
  if (kind === 'add' && pending.some((c) => c.newPerson?.pinfl === input.newPerson?.pinfl)) {
    throw new HttpError(409, 'conflict', 'srv.policyChanges.alreadySent', { fields: { pinfl: msg('srv.policyChanges.sentShort') } });
  }
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
    familyMembers: input.familyMembers,
    effectiveDate: input.effectiveDate,
    premiumDelta: proRataDelta(policy, tariffOf(policy), kind, input.effectiveDate, input.familyMembers),
    status: 'pending',
    requestedAt: tzIso(Date.now()),
    requestedByName: actor.displayName,
    requestedById: actor.id,
    newPerson: input.newPerson,
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
