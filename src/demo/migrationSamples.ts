/*
 * Demo files of the portfolio transfer: 5 clients, 5 contracts, 200 insured persons, used limits,
 * 10 open claims and a few unpaid invoices, plus rows with errors that show the validation report
 * (they are excluded explicitly, so the whole flow completes).
 * Premiums: most contracts give premiums per employee and per family member; MIG-2026/0503 has none and
 * every insured person carries an individual premium; MIG-2026/0505 mixes both (two individual premiums
 * win over the type) and its total is 1 сум off (within the tolerance); MIG-2026/0504's total premium
 * deliberately differs from the sum of its insured persons' premiums (a highlighted mismatch). Deterministic: the same files every time;
 * the e2e fixtures (e2e/fixtures/migration) are these files, checked by migrationSamples.test.ts.
 * Names are Latin, PINFLs have the 14-digit format with the birth date inside, numbers are ASCII.
 */
import type { MigrationStep } from '@/shared/types/migration';
import { MIGRATION_COLUMNS } from '@/shared/domain/migration';
import { toCsv } from '@/shared/lib/csv';

/** The date the figures of the files are valid on. */
export const MIGRATION_DEMO_DATE = '2026-10-01';
/** The first insured person of the first contract: signs in to the app with this phone. */
export const MIGRATION_DEMO_PHONE = '+998770000001';

const MALE = ['Jasur', 'Aziz', 'Otabek', 'Sherzod', 'Farrux', 'Sanjar', 'Dilshod', 'Rustam', 'Temur', 'Bobur', 'Anvar', 'Javohir'];
const FEMALE = ['Dilnoza', 'Nigora', 'Malika', 'Shahnoza', 'Gulnoza', 'Madina', 'Sevara', 'Kamola', 'Zarina', 'Feruza'];
const SURNAME = ['Abdullayev', 'Karimov', 'Yusupov', 'Rahimov', 'Aliyev', 'Tursunov', 'Hasanov', 'Nazarov', 'Ismoilov', 'Mirzayev', 'Sultonov', 'Ergashev', 'Xolmatov', 'Saidov', 'Qodirov', 'Umarov'];
const FATHER = ['Karim', 'Alisher', 'Bahrom', 'Farhod', 'Ravshan', 'Shuhrat', 'Ilhom', 'Nodir', 'Akmal', 'Zafar'];
const POSITION = ['Engineer', 'Manager', 'Accountant', 'Driver', 'Operator', 'Analyst', 'Technician', 'Economist'];

/** Small deterministic generator (LCG). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const CLIENTS = [
  { name: 'Navoiy Textile Group', legalForm: 'llc', stir: '409100001', director: 'Qodirov Bahodir Ilhomovich', hr: 'Saidova Malika Bahodirovna' },
  { name: 'Samarqand Agro Invest', legalForm: 'jsc', stir: '409100002', director: 'Umarov Sanjar Akmalovich', hr: 'Karimova Dilnoza Farhodovna' },
  { name: 'Fargona Logistics', legalForm: 'jv_llc', stir: '409100003', director: 'Aliyev Otabek Nodirovich', hr: 'Hasanova Nigora Ravshanovna' },
  { name: 'Buxoro Med Supply', legalForm: 'private_enterprise', stir: '409100004', director: 'Yusupov Farrux Zafarovich', hr: 'Rahimova Kamola Alisherovna' },
  { name: 'Toshkent Digital Systems', legalForm: 'llc', stir: '409100005', director: 'Nazarov Temur Shuhratovich', hr: 'Ismoilova Sevara Bahromovna' },
];

interface DemoContract {
  oldNumber: string;
  client: number;
  startDate: string;
  endDate: string;
  program: string;
  byType: { employee: number; family: number } | null;
  individual: number[];
  offset: number;
  paymentFrequency: string;
  assistance: string;
  people: number;
}

/**
 * `byType`: premiums per employee and per family member (null — individual premiums only);
 * `individual`: positions (1-based) of persons with an individual premium; `offset`: added to the total
 * premium on purpose (a deliberate mismatch, or a difference within the ±1 сум tolerance).
 */
const CONTRACTS: DemoContract[] = [
  { oldNumber: 'MIG-2026/0501', client: 0, startDate: '2026-07-01', endDate: '2027-06-30', program: 'standard', byType: { employee: 3_600_000, family: 2_880_000 }, individual: [], offset: 0, paymentFrequency: 'quarterly', assistance: '', people: 60 },
  { oldNumber: 'MIG-2026/0502', client: 1, startDate: '2026-04-01', endDate: '2027-03-31', program: 'premium', byType: { employee: 6_000_000, family: 4_800_000 }, individual: [], offset: 0, paymentFrequency: 'single', assistance: '', people: 50 },
  { oldNumber: 'MIG-2026/0503', client: 2, startDate: '2026-06-01', endDate: '2027-05-31', program: 'basic', byType: null, individual: [], offset: 0, paymentFrequency: 'monthly', assistance: '', people: 40 },
  { oldNumber: 'MIG-2026/0504', client: 3, startDate: '2026-09-01', endDate: '2027-08-31', program: 'standard_plus', byType: { employee: 4_500_000, family: 3_600_000 }, individual: [], offset: 2_500_000, paymentFrequency: 'quarterly', assistance: '', people: 30 },
  { oldNumber: 'MIG-2026/0505', client: 4, startDate: '2026-05-01', endDate: '2027-04-30', program: 'standard', byType: { employee: 3_800_000, family: 3_040_000 }, individual: [1, 2], offset: -1, paymentFrequency: 'single', assistance: 'Shifo Assistans Group', people: 20 },
];

/** Individual premium of a person (deterministic): by age, plus the family members. */
function individualPremium(birthDate: string, family: number): number {
  const age = 2026 - Number(birthDate.slice(0, 4));
  return 1_800_000 + Math.floor(age / 10) * 150_000 + family * 1_450_000;
}

/** Premium of a person by the rules of the files: individual, else by type. */
function premiumOf(p: Person): number {
  const c = CONTRACTS.find((x) => x.oldNumber === p.contractOldNumber)!;
  if (p.premium) return Number(p.premium);
  return c.byType!.employee + c.byType!.family * Number(p.familyMembers);
}

interface Person {
  fullName: string;
  birthDate: string;
  pinfl: string;
  phone: string;
  oldCertificate: string;
  inclusionDate: string;
  contractOldNumber: string;
  position: string;
  familyMembers: string;
  premium: string;
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** 14 digits: century and sex, the birth date DDMMYY, then 7 digits. */
function pinflOf(female: boolean, birthDate: string, seq: number): string {
  const [y = '', m = '', d = ''] = birthDate.split('-');
  return `${female ? 4 : 3}${d}${m}${y.slice(2)}${pad(1_000_000 + seq, 7)}`;
}

function people(): Person[] {
  const r = rng(20261001);
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
  const out: Person[] = [];
  let seq = 0;
  CONTRACTS.forEach((c) => {
    for (let k = 1; k <= c.people; k++) {
      seq += 1;
      // The first person is fixed: the e2e signs in to the app as him.
      const female = seq === 1 ? false : r() < 0.45;
      const surname = seq === 1 ? 'Abdullayev' : pick(SURNAME);
      const first = seq === 1 ? 'Jasur' : pick(female ? FEMALE : MALE);
      const father = seq === 1 ? 'Karim' : pick(FATHER);
      const birthDate = seq === 1 ? '1988-05-14' : `${1965 + Math.floor(r() * 38)}-${pad(1 + Math.floor(r() * 12), 2)}-${pad(1 + Math.floor(r() * 28), 2)}`;
      const late = k > c.people - 3;
      const familyMembers = String(Math.floor(r() * 3));
      const individual = !c.byType || c.individual.includes(k);
      out.push({
        fullName: `${surname}${female ? 'a' : ''} ${first} ${father}${female ? 'ovna' : 'ovich'}`,
        birthDate,
        pinfl: pinflOf(female, birthDate, seq),
        // Five people have no phone (a warning: they cannot sign in to the app).
        phone: seq % 40 === 7 ? '' : `+99877${pad(seq, 7)}`,
        oldCertificate: `C-${c.oldNumber.slice(-4)}-${pad(k, 4)}`,
        inclusionDate: late ? '2026-09-15' : c.startDate,
        contractOldNumber: c.oldNumber,
        position: pick(POSITION),
        familyMembers,
        premium: individual ? String(individualPremium(birthDate, Number(familyMembers))) : '',
      });
    }
  });
  // Two PINFLs that do not match the birth date (a warning).
  for (const idx of [24, 131]) {
    const p = out[idx]!;
    p.pinfl = `${p.pinfl.slice(0, 1)}010170${p.pinfl.slice(7)}`;
  }
  return out;
}

function rows(step: MigrationStep, list: Record<string, string>[]): string {
  const cols = MIGRATION_COLUMNS[step];
  return toCsv(cols, list.map((x) => cols.map((c) => x[c] ?? '')));
}

export function migrationDemoFiles(): Record<MigrationStep, string> {
  const persons = people();
  const clients = CLIENTS.map((c, k) => ({
    name: c.name,
    legalForm: c.legalForm,
    stir: c.stir,
    bank: 'Demo Bank ATB',
    account: `2020800090010020${pad(k + 1, 4)}`,
    mfo: '00014',
    director: c.director,
    directorBasis: 'Ustav',
    address: `Tashkent, Yunusobod, ${k + 10}`,
    hrName: c.hr,
    hrPhone: `+99871200${pad(k + 1, 4)}`,
    hrEmail: `hr@client${k + 1}.example.uz`,
  }));
  // An error row: the STIR has 8 digits.
  clients.splice(3, 0, { ...clients[0]!, name: 'Andijon Mebel Savdo', stir: '40910006', account: '20208000900100209999', hrEmail: 'hr@client6.example.uz', hrPhone: '+998712009999' });

  // The total premium of a contract is the sum of its persons' premiums (plus the deliberate offset).
  const contracts = CONTRACTS.map((c) => ({
    oldNumber: c.oldNumber,
    clientStir: CLIENTS[c.client]!.stir,
    startDate: c.startDate,
    endDate: c.endDate,
    program: c.program,
    premium: String(persons.filter((p) => p.contractOldNumber === c.oldNumber).reduce((s, p) => s + premiumOf(p), 0) + c.offset),
    premiumEmployee: c.byType ? String(c.byType.employee) : '',
    premiumFamily: c.byType ? String(c.byType.family) : '',
    paymentFrequency: c.paymentFrequency,
    assistance: c.assistance,
  }));

  const insured: Record<string, string>[] = persons.map((p) => ({ ...p }));
  // Error rows: a 13-digit PINFL, an unknown contract, an inclusion date before the contract.
  insured.splice(10, 0, { ...persons[10]!, fullName: 'Ergashev Bobur Nodirovich', pinfl: '3120588100090', phone: '+998779000001', oldCertificate: 'C-0501-0901' });
  insured.splice(70, 0, { ...persons[70]!, fullName: 'Saidova Lola Farhodovna', pinfl: '41503901009002', phone: '+998779000002', oldCertificate: 'C-0999-0001', contractOldNumber: 'MIG-2026/0999' });
  insured.splice(150, 0, { ...persons[150]!, fullName: 'Umarov Aziz Akmalovich', pinfl: '30704851009003', phone: '+998779000003', oldCertificate: 'C-0503-0901', inclusionDate: '2026-01-10' });
  // An error row: a person of the contract without premiums by type and without an individual premium.
  insured.splice(140, 0, { ...persons[130]!, fullName: 'Xolmatova Zarina Akmalovna', birthDate: '1990-02-11', pinfl: '41102901009004', phone: '+998779000004', oldCertificate: 'C-0503-0902', premium: '' });

  // Used limits of every fifth person; the first person has 2 500 000 of outpatient care used.
  const cats = ['outpatient', 'dental', 'medicines'] as const;
  const limits: Record<string, string>[] = [{ pinfl: persons[0]!.pinfl, oldCertificate: persons[0]!.oldCertificate, category: 'outpatient', usedAmount: '2500000' }];
  persons.forEach((p, idx) => {
    if (idx === 0 || idx % 5 !== 0) return;
    const cat = cats[idx % 3]!;
    limits.push({ pinfl: idx % 2 ? p.pinfl : '', oldCertificate: idx % 2 ? '' : p.oldCertificate, category: cat, usedAmount: String((((idx * 37) % 7) + 1) * 150_000) });
  });

  const claimCats = ['doctor_visit', 'diagnostics', 'medicines', 'dental', 'inpatient'] as const;
  const statuses = ['new', 'review', 'medical_review'] as const;
  const claims: Record<string, string>[] = [];
  for (let k = 0; k < 10; k++) {
    const p = persons[3 + k * 19]!;
    const amount = (k + 2) * 425_000;
    claims.push({
      oldNumber: `CL-2026-${pad(7701 + k, 4)}`,
      pinfl: p.pinfl,
      oldCertificate: p.oldCertificate,
      category: claimCats[k % 5]!,
      serviceDate: `2026-09-${pad(5 + k * 2, 2)}`,
      provider: ['Shifo Med Center', 'Akfa Medline', 'Dentaprime Clinic', 'Medion Family Clinic'][k % 4]!,
      amountClaimed: String(amount),
      reserve: String(k % 3 === 0 ? Math.round(amount * 0.8) : amount),
      status: statuses[k % 3]!,
    });
  }
  // An error row: a paid claim is not an open one.
  claims.splice(5, 0, { ...claims[0]!, oldNumber: 'CL-2026-7799', status: 'paid', reserve: '600000' });

  const invoices = [
    { oldNumber: 'INV-2026-0091', contractOldNumber: 'MIG-2026/0501', amount: '57000000', paid: '0', issuedAt: '2026-09-25', dueDate: '2026-10-10' },
    { oldNumber: 'INV-2026-0092', contractOldNumber: 'MIG-2026/0503', amount: '8000000', paid: '3000000', issuedAt: '2026-09-01', dueDate: '2026-09-15' },
    { oldNumber: 'INV-2026-0093', contractOldNumber: 'MIG-2026/0504', amount: '39375000', paid: '0', issuedAt: '2026-09-01', dueDate: '2026-10-15' },
  ];

  return {
    clients: rows('clients', clients),
    contracts: rows('contracts', contracts),
    insured: rows('insured', insured),
    limits: rows('limits', limits),
    claims: rows('claims', claims),
    invoices: rows('invoices', invoices),
  };
}
