/*
 * Family members of the seed (FAMILY_SPEC «Сид»). The demo insured person gets a spouse with an own login and
 * two children under the age limit; one child has an appointment and a reimbursement, the spouse has an own
 * claim the employee does not see until she allows it. Another employee of the demo company has a child that
 * has just reached the age limit: a task in the underwriter's queue. A separate RNG stream keeps the rest of
 * the seed unchanged; names are Latin, everything is fictional and deterministic.
 */
import type { Appointment, Clinic, ClaimCategory, ClaimStatus, Policy } from '@mig/contracts';
import { docNumber } from '@mig/domain/numbering';
import { DEMO_SPOUSE_PHONE } from './credentials';
import type { ClaimRow, Db, InsuredRow } from '@mig/domain/store/db';
import { fakeFiscal } from './receipts';
import { hashString, mulberry32, SEED, uuidFrom } from './rng';
import { at, DAY, isoDay, startOfDay, tzIso } from './time';

/** ISO date `years` years before `ms` (same day and month), minus `daysBack` days. */
function yearsAgo(ms: number, years: number, daysBack = 0): string {
  // The day in Tashkent, not by the machine's time zone.
  const [y, rest] = [Number(isoDay(ms - daysBack * DAY).slice(0, 4)), isoDay(ms - daysBack * DAY).slice(4)];
  return `${y - years}${rest}`;
}

/** PINFL with the birth date in digits 2–7 (DDMMYY), like a real one. */
function pinflOf(first: '3' | '4', birthDate: string, tail: string): string {
  const [y, m, d] = birthDate.split('-');
  return `${first}${d}${m}${y!.slice(2)}${tail}`;
}

export interface SeedFamily {
  rows: InsuredRow[];
  spouseId: string;
  childIds: [string, string];
}

/** Insured rows of the family members; they join the demo policy like any other person. */
export function seedFamilyMembers(base: { demo: InsuredRow; other: InsuredRow | undefined; policy: Policy; clinics: Clinic[] }, opts: { now: number }): SeedFamily {
  const rng = mulberry32(SEED ^ 0xfa3117);
  const id = () => uuidFrom(rng);
  const { demo, policy } = base;
  const clinic = base.clinics[0]!.id;
  const member = (fields: Pick<InsuredRow, 'fullName' | 'birthDate' | 'pinfl' | 'relation'> & Partial<InsuredRow>, principal: InsuredRow): InsuredRow => ({
    id: id(),
    userId: id(),
    clientId: principal.clientId,
    clientName: principal.clientName,
    policyId: policy.id,
    position: '',
    phone: '',
    email: '',
    // Reimbursements of a family member go to the employee's card by default.
    payoutCard: '',
    principalId: principal.id,
    appStatus: 'not_invited',
    myIdVerified: false,
    attachedClinicId: principal.attachedClinicId ?? clinic,
    insuredFrom: principal.insuredFrom,
    status: 'active',
    addedAt: principal.addedAt,
    ...fields,
  });
  const spouseBirth = '1989-08-21';
  const spouse = member(
    {
      fullName: 'Karimova Dilnoza Rustamovna',
      relation: 'spouse',
      birthDate: spouseBirth,
      pinfl: pinflOf('4', spouseBirth, '0234567'),
      // An adult family member signs in with her own phone; the first login asks for the consent like the employee's.
      phone: DEMO_SPOUSE_PHONE,
      email: 'dilnoza.k@family.example.uz',
      appStatus: 'active',
      myIdVerified: true,
    },
    demo,
  );
  const son = member({ fullName: 'Karimov Temur Azizovich', relation: 'child', birthDate: yearsAgo(opts.now, 10, 40), pinfl: '' }, demo);
  son.pinfl = pinflOf('3', son.birthDate, '0345678');
  const daughter = member({ fullName: 'Karimova Madina Azizovna', relation: 'child', birthDate: yearsAgo(opts.now, 6, 150), pinfl: '' }, demo);
  daughter.pinfl = pinflOf('4', daughter.birthDate, '0456789');
  const rows = [spouse, son, daughter];
  if (base.other) {
    // Turned 18 ten days ago: the age-limit task (no automatic exclusion).
    const [surname = 'Karimov', given = 'Aziz'] = base.other.fullName.split(' ');
    const grown = member({ fullName: `${surname} Sardor ${given}ovich`, relation: 'child', birthDate: yearsAgo(opts.now, 18, 10), pinfl: '' }, base.other);
    grown.pinfl = pinflOf('3', grown.birthDate, '0567890');
    rows.push(grown);
  }
  return { rows, spouseId: spouse.id, childIds: [son.id, daughter.id] };
}

/** Claims and an appointment of the family members (after the main seed: numbers follow the seeded ones). */
export function seedFamilyActivity(d: Db, family: SeedFamily, opts: { now: number }): void {
  const rng = mulberry32(SEED ^ 0xfa3118);
  const id = () => uuidFrom(rng);
  const spouse = d.insured.find((i) => i.id === family.spouseId);
  const son = d.insured.find((i) => i.id === family.childIds[0]);
  if (!spouse || !son) return;
  const pediatric = d.clinics.find((c) => c.specialties.includes('pediatrician')) ?? d.clinics[0]!;
  const claimNo = () => {
    const year = new Date(opts.now).getFullYear();
    const max = d.claims.reduce((m, c) => Math.max(m, Number(/(\d+)$/.exec(c.number)?.[1] ?? 0)), 0);
    return docNumber('claim', { year, n: max + 1 });
  };
  const claim = (who: InsuredRow, category: ClaimCategory, status: ClaimStatus, amount: number, provider: string, daysAgo: number): ClaimRow => {
    const createdMs = opts.now - daysAgo * DAY;
    const claimId = id();
    const fileId = id();
    const serviceDate = isoDay(createdMs - DAY);
    d.files.push({ id: fileId, mime: 'image/png', claimId, insuredId: who.id, seedText: [provider, serviceDate, `Chek №${1000 + (hashString(claimId) % 9000)}`, `Itogo: ${amount}`] });
    const history: ClaimRow['history'] = [{ at: tzIso(createdMs), actorName: 'Застрахованный (приложение)', to: 'new' }];
    const operator = d.staff.find((s) => s.role === 'operator')!;
    if (status !== 'new') history.push({ at: tzIso(createdMs + 3 * 3600_000), actorName: operator.fullName, from: 'new', to: 'review' });
    if (status === 'approved') history.push({ at: tzIso(createdMs + 20 * 3600_000), actorName: operator.fullName, from: 'review', to: 'approved' });
    const c: ClaimRow = {
      id: claimId,
      number: claimNo(),
      insuredId: who.id,
      insuredName: who.fullName,
      clientId: who.clientId,
      clientName: who.clientName,
      category,
      source: 'app',
      amountClaimed: amount,
      ...(status === 'approved' ? { amountApproved: amount, approvedById: operator.id } : {}),
      providerName: provider,
      serviceDate,
      status,
      slaDueAt: tzIso(createdMs + 5 * DAY),
      createdAt: tzIso(createdMs),
      updatedAt: history[history.length - 1]!.at,
      attachments: [{ id: fileId, kind: 'receipt', fileName: 'receipt-1.png', mime: 'image/png', sizeBytes: 182 * 1024, url: `/api/files/${fileId}` }],
      history,
      receiptFiscal: fakeFiscal(hashString(claimId), provider, serviceDate, amount),
    };
    d.claims.unshift(c);
    return c;
  };
  // The son's reimbursement (in the parent's app) and the spouse's own claim (hidden from the employee until she allows it).
  claim(son, 'medicines', 'review', 186_000, 'Nur Dori Dorixonasi', 2);
  claim(spouse, 'doctor_visit', 'approved', 420_000, pediatric.name, 6);
  const appointment: Appointment = {
    id: id(),
    insuredId: son.id,
    insuredName: son.fullName,
    clientName: son.clientName,
    clinicId: pediatric.id,
    clinicName: pediatric.name,
    specialty: pediatric.specialties.includes('pediatrician') ? 'pediatrician' : pediatric.specialties[0]!,
    startsAt: tzIso(at(startOfDay(opts.now) + 3 * DAY, 11, 0)),
    status: 'confirmed',
    createdAt: tzIso(opts.now - DAY),
  };
  d.appointments.push(appointment);
}
