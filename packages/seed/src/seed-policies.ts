/*
 * Seed of the insured-list change requests (POLICY_SPEC §9). A separate RNG stream keeps the rest
 * of the seed unchanged.
 */
import type { ClientDocument, Policy } from '@mig/contracts';
import { proRataDelta, tariffOf } from '@mig/domain/policies';
import type { ClientRow, HrUserRow, InsuredRow, PolicyChangeRow, StaffRow } from '@mig/domain/store/db';
import { digits, int, mulberry32, pick, SEED, uuidFrom } from './rng';
import { DAY, isoDay, tzIso } from './time';

const NEW_PEOPLE = [
  ['Tursunov Bobur Alisherovich', 'Логист'],
  ['Yoʻldosheva Malika Rustamovna', 'Бухгалтер'],
  ['Karimov Sherzod Bahodirovich', 'Водитель-экспедитор'],
  ['Nazarova Dilnoza Ikromovna', 'Менеджер по закупкам'],
  ['Hamidov Akmal Temurovich', 'Кладовщик'],
] as const;

export function seedPolicyChanges(
  base: { clients: ClientRow[]; policies: Policy[]; insured: InsuredRow[]; staff: StaffRow[]; hrUsers: HrUserRow[] },
  opts: { now: number },
): { policyChanges: PolicyChangeRow[]; documents: ClientDocument[] } {
  const rng = mulberry32(SEED ^ 0x9011c7);
  const id = () => uuidFrom(rng);
  const hr = base.hrUsers[0];
  const client = hr && base.clients.find((c) => c.id === hr.companyId);
  const policy = client && base.policies.find((p) => p.id === client.activePolicyId);
  if (!hr || !client || !policy) return { policyChanges: [], documents: [] };
  const underwriter = base.staff.find((s) => s.role === 'underwriter')!;
  const tariff = tariffOf(policy);
  const clamp = (d: string) => (d < policy.startDate ? policy.startDate : d > policy.endDate ? policy.endDate : d);
  const out: PolicyChangeRow[] = [];
  const baseRow = (kind: 'add' | 'exclude', effectiveDate: string, requestedMs: number) => ({
    id: id(),
    clientId: client.id,
    clientName: client.name,
    policyId: policy.id,
    policyNumber: policy.number,
    kind,
    effectiveDate,
    premiumDelta: proRataDelta(policy, tariff, kind, effectiveDate),
    requestedAt: tzIso(requestedMs),
    requestedByName: hr.fullName,
    requestedById: hr.id,
  });
  const newPerson = () => ({
    birthDate: `19${int(rng, 70, 99)}-${String(int(rng, 1, 12)).padStart(2, '0')}-${String(int(rng, 1, 28)).padStart(2, '0')}`,
    pinfl: `3${digits(rng, 13)}`,
    phone: `+99890${digits(rng, 7)}`,
  });

  // 3 pending additions, 1 pending exclusion, 1 rejected addition.
  for (let k = 0; k < 4; k++) {
    const [fullName, position] = NEW_PEOPLE[k]!;
    const eff = clamp(isoDay(opts.now + int(rng, 1, 10) * DAY));
    out.push({
      ...baseRow('add', eff, opts.now - int(rng, 2, 40) * 3600_000),
      fullName,
      position,
      relation: 'employee' as const,
      status: k < 3 ? 'pending' : 'rejected',
      newPerson: newPerson(),
      ...(k === 3
        ? { decidedAt: tzIso(opts.now - 2 * DAY), decidedByName: underwriter.fullName, rejectionReason: 'Сотрудник на испытательном сроке: прикрепим после его окончания' }
        : {}),
    });
  }
  const active = base.insured.filter((i) => i.clientId === client.id && i.status === 'active' && i.relation === 'employee' && i.pinfl !== '31205870123456');
  const leaving = pick(rng, active);
  out.push({
    ...baseRow('exclude', clamp(isoDay(opts.now + 14 * DAY)), opts.now - 5 * 3600_000),
    insuredId: leaving.id,
    fullName: leaving.fullName,
    position: leaving.position,
    relation: 'employee',
    premiumDelta: proRataDelta(policy, tariff, 'exclude', clamp(isoDay(opts.now + 14 * DAY))),
    status: 'pending',
  });

  // 2 approved additions with an endorsement; the people are already in the insured list.
  const endorsementId = id();
  const approvedAt = opts.now - 20 * DAY;
  const recent = base.insured.filter((i) => i.clientId === client.id && i.status === 'active' && i.relation === 'employee' && i.pinfl !== '31205870123456').slice(-2);
  for (const person of recent) {
    const eff = clamp(isoDay(approvedAt));
    out.push({
      ...baseRow('add', eff, approvedAt - 2 * DAY),
      insuredId: person.id,
      fullName: person.fullName,
      position: person.position,
      relation: 'employee',
      premiumDelta: proRataDelta(policy, tariff, 'add', eff),
      status: 'approved',
      decidedAt: tzIso(approvedAt),
      decidedByName: underwriter.fullName,
      endorsementId,
    });
  }
  const documents: ClientDocument[] = [
    { id: endorsementId, clientId: client.id, title: `Дополнительное соглашение № 1 к полису ${policy.number} от ${isoDay(approvedAt).split('-').reverse().join('.')}`, kind: 'endorsement', createdAt: isoDay(approvedAt) },
  ];
  return { policyChanges: out, documents };
}

