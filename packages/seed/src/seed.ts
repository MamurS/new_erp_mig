/*
 * Deterministic seed (mulberry32, seed 20260929). Dates are relative to "now" so the prototype
 * always looks fresh. All companies, people and medical data are fictional.
 */
import { fakeFiscal } from './receipts';
import type {
  Appointment,
  AppointmentStatus,
  AuditAction,
  AuditEntry,
  ClaimCategory,
  ClaimEvent,
  ClaimSource,
  ClaimStatus,
  ClientDocument,
  ClientStatus,
  Clinic,
  Invoice,
  LimitCategory,
  LimitChangeRequest,
  Policy,
  ProgramCode,
  Role,
  Specialty,
} from '@mig/contracts';
import { chance, digits, hashString, int, mulberry32, pick, SEED, uuidFrom, type Rng } from './rng';
import type { ChatRow, ClaimRow, ClientRow, Db, FileRow, HrUserRow, InsuredDocRow, InsuredRow, StaffRow } from '@mig/domain/store/db';
import { DEMO_HR, DEMO_INSURED_PHONE, DEMO_PASSWORD, DEMO_STAFF } from './credentials';
import { at, DAY, isoDay, parseIso, startOfDay, tzIso } from './time';
import { PROGRAMS, perPersonPremium } from './programs';
import { seedClinics } from './seed-clinics';
import { seedPolicyChanges } from './seed-policies';
import { seedAssistance } from './seed-assistance';
import { seedLifecycle } from './seed-lifecycle';
import { seedFamilyActivity, seedFamilyMembers } from './seed-family';
import { defaultAiSettings } from '@mig/domain/ai/settings';
import type { LegalFormCode } from '@mig/domain/config/legalForms';
import { docNumber } from '@mig/domain/numbering';

// ---------- dictionaries ----------
// People are named as in the ID card / MyID: «Surname Given Patronymic» in Latin script.
const UZ_MALE = ['Aziz', 'Baxtiyor', 'Jasur', 'Otabek', 'Sherzod', 'Farrux', 'Ulugʻbek', 'Sanjar', 'Dilshod', 'Rustam', 'Temur', 'Mansur', 'Bobur', 'Anvar'];
const UZ_FEMALE = ['Dilnoza', 'Nigora', 'Malika', 'Shahnoza', 'Gulnoza', 'Madina', 'Sevara', 'Kamola', 'Zarina', 'Feruza', 'Lola', 'Nodira'];
const UZ_SURNAME = ['Karimov', 'Yusupov', 'Rahimov', 'Aliyev', 'Tursunov', 'Hasanov', 'Nazarov', 'Ismoilov', 'Abdullayev', 'Mirzayev', 'Sultonov', 'Ergashev', 'Xolmatov', 'Saidov'];
const UZ_FATHER = ['Alisher', 'Bahrom', 'Farhod', 'Ravshan', 'Shuhrat', 'Ilhom', 'Nodir', 'Akmal', 'Xurshid', 'Zafar'];
const RU_MALE = ['Aleksey', 'Dmitriy', 'Sergey', 'Andrey', 'Igor', 'Pavel', 'Maksim', 'Roman'];
const RU_FEMALE = ['Elena', 'Olga', 'Natalya', 'Irina', 'Anna', 'Mariya', 'Tatyana', 'Yuliya'];
const RU_SURNAME = ['Ivanov', 'Petrov', 'Smirnov', 'Kuznetsov', 'Sokolov', 'Morozov', 'Volkov', 'Lebedev', 'Kozlov', 'Novikov'];
const RU_FATHER: [string, string][] = [
  ['Aleksandrovich', 'Aleksandrovna'],
  ['Vladimirovich', 'Vladimirovna'],
  ['Sergeyevich', 'Sergeyevna'],
  ['Nikolayevich', 'Nikolayevna'],
  ['Mikhaylovich', 'Mikhaylovna'],
  ['Andreyevich', 'Andreyevna'],
  ['Viktorovich', 'Viktorovna'],
];

// Official Latin names of fictional companies, without the legal form (it is a separate code).
const CITIES = ['Toshkent', 'Samarqand', 'Buxoro', 'Fargʻona', 'Namangan', 'Andijon', 'Navoiy', 'Xorazm', 'Qarshi', 'Termiz'];
const INDUSTRIES = [
  'Agrologistika',
  'Tekstil Group',
  'Qurilish Invest',
  'Farm Savdo',
  'Energo Servis',
  'Avto Komplekt',
  'Oziq-Ovqat Sanoat',
  'Raqamli Tizimlar',
  'Media Holding',
  'Trans Logistik',
  'Metall Profil',
  'Paxta Eksport',
];
/** Legal forms of clients by weight: mostly LLCs, a few JSCs, joint ventures and private enterprises, single others. */
const CLIENT_FORMS: LegalFormCode[] = [
  ...Array<LegalFormCode>(14).fill('llc'),
  'jsc', 'jsc', 'jsc',
  'jv_llc', 'jv_llc',
  'private_enterprise', 'private_enterprise',
  // No sole proprietors: DMS is for companies (allowedLegalForms); the ban is shown by one seeded lead.
  'llc', 'state_unitary', 'branch',
];
const POSITIONS = [
  'Бухгалтер',
  'Менеджер по продажам',
  'Инженер',
  'Водитель',
  'Кладовщик',
  'Юрист',
  'Специалист по кадрам',
  'Программист',
  'Экономист',
  'Оператор склада',
  'Технолог',
  'Маркетолог',
  'Руководитель отдела',
  'Механик',
  'Аналитик',
];
const DISTRICTS = [
  'Юнусабадский',
  'Мирзо-Улугбекский',
  'Чиланзарский',
  'Яккасарайский',
  'Шайхантахурский',
  'Алмазарский',
  'Мирабадский',
  'Сергелийский',
  'Учтепинский',
  'Яшнабадский',
  'Бектемирский',
  'Янгихаётский',
];
const STREETS = ['ул. Навбахор', 'ул. Лолазор', 'ул. Богишамол', 'пр. Мустакиллик', 'ул. Кичик Халка', 'ул. Нурафшон', 'ул. Гулбахор', 'ул. Олмазор'];
/** Kind of a clinic as the last word(s) of its Latin name; the last one is a dental clinic. */
const CLINIC_KIND = ['Tibbiyot Markazi', 'Klinikasi', 'Oilaviy Klinikasi', 'Diagnostika Markazi', 'Stomatologiyasi'];
const DENTAL_KIND = 'Stomatologiyasi';
const CLINIC_NAME = ['Shifo-Nur', 'Salomat Plus', 'Madad Med', 'Baraka Hayot', 'Ziyo Medical', 'Mehr Klinik', 'Sogʻlom Avlod', 'Nur Sihat', 'Oila Med', 'Tabib Pro'];
/** Legal forms of clinics by weight. */
const CLINIC_FORMS: LegalFormCode[] = ['llc', 'llc', 'llc', 'llc', 'private_enterprise', 'jv_llc', 'jsc', 'state_unitary'];
const PHARMACIES = ['Shifo Farm Dorixonasi', 'Nur Dori Dorixonasi', 'Salomat 24 Dorixonasi', 'Darmon Plus Dorixonasi', 'Madad Dorixonasi'];
const SPECIALTIES: Specialty[] = ['therapist', 'pediatrician', 'dentist', 'cardiologist', 'gynecologist', 'ent', 'neurologist', 'ophthalmologist'];
const REJECT_REASONS = [
  'Услуга не входит в вашу программу страхования',
  'На чеке не видна дата или сумма. Загрузите более чёткое фото',
  'Лекарство не было назначено врачом',
];

// ---------- helpers ----------
function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function person(rng: Rng): { fullName: string; female: boolean } {
  const female = chance(rng, 0.5);
  if (chance(rng, 0.7)) {
    const surname = pick(rng, UZ_SURNAME) + (female ? 'a' : '');
    const first = pick(rng, female ? UZ_FEMALE : UZ_MALE);
    const father = pick(rng, UZ_FATHER);
    const patronymic = father + (female ? 'ovna' : 'ovich');
    return { fullName: `${surname} ${first} ${patronymic}`, female };
  }
  const surname = pick(rng, RU_SURNAME) + (female ? 'a' : '');
  const first = pick(rng, female ? RU_FEMALE : RU_MALE);
  const pat = pick(rng, RU_FATHER)[female ? 1 : 0];
  return { fullName: `${surname} ${first} ${pat}`, female };
}

function phone(rng: Rng): string {
  return `+998${pick(rng, ['90', '91', '93', '94', '97', '98', '99', '33', '88'])}${digits(rng, 7).replace(/^./, String(int(rng, 1, 9)))}`;
}

/** Latin name → part of an e-mail address. */
function emailPart(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function claimAmount(rng: Rng, cat: ClaimCategory): number {
  const ranges: Record<ClaimCategory, [number, number]> = {
    medicines: [50, 900],
    doctor_visit: [150, 600],
    diagnostics: [100, 1500],
    dental: [300, 3000],
    inpatient: [3000, 25000],
  };
  const [a, b] = ranges[cat];
  return int(rng, a, b) * 1000;
}

function pickCategory(rng: Rng): ClaimCategory {
  const r = rng();
  if (r < 0.35) return 'medicines';
  if (r < 0.6) return 'doctor_visit';
  if (r < 0.8) return 'diagnostics';
  if (r < 0.92) return 'dental';
  return 'inpatient';
}

const NIL = '00000000-0000-4000-8000-000000000000';

/**
 * The family size of an employee was drawn at this point of the seed before family members became insured
 * persons of their own: the draw stays, so everything seeded after it is unchanged.
 */
const asEmployee = (_formerFamilySize: number): 'employee' => 'employee';

export interface SeedOptions {
  xss?: boolean;
  now?: number;
}

export function createSeed(opts: SeedOptions = {}): Db {
  const rng = mulberry32(SEED);
  const now = opts.now ?? Date.now();
  const today = startOfDay(now);
  const id = () => uuidFrom(rng);

  // ---------- staff ----------
  const staff: StaffRow[] = DEMO_STAFF.map((s) => ({
    id: id(),
    fullName: s.fullName,
    email: s.email,
    role: s.role,
    authority: s.authority ?? {},
    ...(s.signatory ? { signatory: s.signatory } : {}),
    active: true,
    password: DEMO_PASSWORD,
    lastLoginAt: tzIso(now - int(rng, 1, 48) * 3600_000),
  }));
  const extraRoles: StaffRow['role'][] = ['operator', 'operator', 'underwriter', 'underwriter', 'doctor_expert', 'accountant', 'admin'];
  extraRoles.forEach((role, i) => {
    const p = person(rng);
    const [surname = '', first = ''] = p.fullName.split(' ');
    staff.push({
      id: id(),
      fullName: p.fullName,
      email: `${emailPart(first)}.${emailPart(surname)}${i}@mig.example`,
      role,
      authority: {},
      active: i !== 6,
      password: DEMO_PASSWORD,
      lastLoginAt: tzIso(now - int(rng, 1, 400) * 3600_000),
    });
  });
  const byRole = (r: Role) => staff.filter((s) => s.role === r);
  const underwriters = byRole('underwriter');
  const operators = byRole('operator');
  const doctors = byRole('doctor_expert');
  const accountants = byRole('accountant');

  // ---------- clinics ----------
  const clinics: Clinic[] = [];
  const clinicNames = new Set<string>();
  for (let i = 0; i < 30; i++) {
    let name = '';
    do {
      const kind = pick(rng, CLINIC_KIND);
      name = `${pick(rng, CLINIC_NAME)} ${kind}`;
      if (clinicNames.has(name)) name = `${name} ${int(rng, 2, 9)}`;
    } while (clinicNames.has(name));
    clinicNames.add(name);
    const district = DISTRICTS[i % DISTRICTS.length]!;
    const isDental = name.includes(DENTAL_KIND);
    const specs = isDental
      ? (['dentist'] as Specialty[])
      : shuffle(rng, SPECIALTIES.filter((s) => s !== 'dentist' || chance(rng, 0.4))).slice(0, int(rng, 3, 7));
    if (!isDental && !specs.includes('therapist')) specs.unshift('therapist');
    clinics.push({
      id: id(),
      name,
      // Derived from the index, not the RNG: the rest of the seed keeps its sequence.
      legalForm: CLINIC_FORMS[(i * 5 + 3) % CLINIC_FORMS.length]!,
      address: `${district} р-н, ${pick(rng, STREETS)}, ${int(rng, 1, 120)}`,
      district,
      specialties: specs,
      onlineBooking: chance(rng, 0.7),
      apiStatus: pick(rng, ['online', 'online', 'online', 'offline', 'manual'] as const),
      contractUntil: isoDay(today + int(rng, 60, 700) * DAY),
      integrationMode: 'portal',
    });
  }

  // ---------- clients & policies ----------
  const statuses: ClientStatus[] = shuffle(rng, [
    ...Array<ClientStatus>(3).fill('draft'),
    ...Array<ClientStatus>(3).fill('negotiation'),
    ...Array<ClientStatus>(26).fill('active'),
    ...Array<ClientStatus>(5).fill('renewal'),
    ...Array<ClientStatus>(3).fill('expired'),
  ]);
  // Demo HR company is the first active client.
  const demoIdx = statuses.indexOf('active');
  const companyNames = shuffle(
    rng,
    CITIES.flatMap((c) => INDUSTRIES.map((ind) => `${c} ${ind}`)),
  );
  const demoCompanyName = 'Toshkent Agrologistika';
  const clients: ClientRow[] = [];
  const policies: Policy[] = [];
  const documents: ClientDocument[] = [];
  const invoices: Invoice[] = [];
  let policySeq = 101;
  let namesUsed = 0;

  statuses.forEach((status, i) => {
    let name = i === demoIdx ? demoCompanyName : companyNames[namesUsed++]!;
    if (name === demoCompanyName && i !== demoIdx) name = companyNames[namesUsed++]!;
    if (opts.xss && i === (demoIdx + 1) % statuses.length) name = '<img src=x onerror=alert(1)>';
    const hasPolicy = status === 'active' || status === 'renewal' || status === 'expired';
    const program: ProgramCode =
      i === demoIdx ? 'standard_plus' : pick(rng, ['basic', 'standard', 'standard', 'standard_plus', 'standard_plus', 'premium'] as const);
    const manager = pick(rng, underwriters);
    const hr = person(rng);
    const clientId = id();
    let start = 0;
    let end = 0;
    if (status === 'active') {
      const endInDays = i === demoIdx ? 190 : int(rng, 20, 330);
      end = today + endInDays * DAY;
      start = end - 364 * DAY;
    } else if (status === 'renewal') {
      end = today + int(rng, 6, 40) * DAY;
      start = end - 364 * DAY;
    } else if (status === 'expired') {
      end = today - int(rng, 10, 90) * DAY;
      start = end - 364 * DAY;
    }
    const policyId = hasPolicy ? id() : undefined;
    const client: ClientRow = {
      id: clientId,
      legalForm: i === demoIdx ? 'llc' : pick(rng, CLIENT_FORMS),
      name,
      inn: `${int(rng, 2, 3)}${digits(rng, 8)}`,
      status,
      managerId: manager.id,
      managerName: manager.fullName,
      hrContact: {
        name: hr.fullName.split(' ').slice(0, 2).join(' '),
        phone: phone(rng),
        email: `hr@client${i + 1}.example.uz`,
      },
      activePolicyId: status === 'expired' ? undefined : policyId,
      program: hasPolicy || status === 'negotiation' ? program : undefined,
      premium: 0,
      lossRatio: hasPolicy ? Math.round((0.25 + rng() * (chance(rng, 0.22) ? 0.9 : 0.5)) * 100) / 100 : null,
      renewalDate: hasPolicy && status !== 'expired' ? isoDay(end) : undefined,
      createdAt: tzIso(now - int(rng, 400, 1400) * DAY),
    };
    if (i === demoIdx) {
      client.lossRatio = 0.62;
      client.log = clientLog(now);
    }
    clients.push(client);
    if (hasPolicy && policyId) {
      const number = docNumber('policy', { year: new Date(start).getFullYear(), n: policySeq++ });
      policies.push({
        id: policyId,
        number,
        clientId,
        clientName: name,
        program,
        startDate: isoDay(start),
        endDate: isoDay(end),
        status: status === 'expired' ? 'expired' : 'active',
        premium: 0,
        insuredCount: 0,
      });
      documents.push(
        { id: id(), clientId, title: `Полис ${number}`, kind: 'policy', createdAt: isoDay(start) },
        { id: id(), clientId, title: `Договор страхования к полису ${number}`, kind: 'contract', createdAt: isoDay(start - 5 * DAY) },
        { id: id(), clientId, title: `Программа «${PROGRAMS[program].name}»`, kind: 'program', createdAt: isoDay(start) },
        { id: id(), clientId, title: `Акт сверки за квартал`, kind: 'act', createdAt: isoDay(today - int(rng, 5, 60) * DAY) },
      );
    } else if (status === 'negotiation') {
      // Offers are real KP documents now (d.kp); the draw is kept so the rest of the seed stays stable.
      int(rng, 3, 30);
    }
  });

  // ---------- HR users ----------
  const demoClient = clients[demoIdx]!;
  const hrUsers: HrUserRow[] = [
    { id: id(), email: DEMO_HR.email, password: DEMO_PASSWORD, fullName: DEMO_HR.fullName, companyId: demoClient.id },
  ];
  // one more HR in another company (used for isolation checks)
  const otherHrClient = clients.find((c, i) => i !== demoIdx && c.status === 'active')!;
  hrUsers.push({ id: id(), email: 'hr@client-b.example.uz', password: DEMO_PASSWORD, fullName: 'Lebedeva Olga Mikhaylovna', companyId: otherHrClient.id });
  // HR of the earliest renewal that waits for an offer (the first «Подготовить КП» in the queue).
  // A fixed id keeps the RNG sequence, and with it the rest of the seed, unchanged.
  const renewalHrClient = clients
    .filter((c) => c.id !== demoClient.id && c.activePolicyId && c.renewalDate && parseIso(c.renewalDate) >= today && parseIso(c.renewalDate) - today <= 30 * DAY)
    .sort((x, y) => (x.renewalDate! < y.renewalDate! ? -1 : 1))[0];
  if (renewalHrClient) {
    hrUsers.push({ id: 'b1e2c3d4-5f60-4a71-8b92-a3b4c5d6e7f8', email: 'hr@renewal.example.uz', password: DEMO_PASSWORD, fullName: 'Karimova Dilnoza Bahromovna', companyId: renewalHrClient.id });
  }

  // ---------- insured ----------
  const insured: InsuredRow[] = [];
  let demoInsuredId = '';
  for (const [ci, client] of clients.entries()) {
    const policy = policies.find((p) => p.clientId === client.id);
    if (!policy) continue;
    const isDemo = ci === demoIdx;
    const size = isDemo ? 45 : int(rng, 12, 76);
    const notInAppIdx = isDemo ? new Set([3, 7, 12, 18, 25, 31, 38, 42]) : null;
    for (let k = 0; k < size; k++) {
      const p = person(rng);
      const startMs = Date.parse(`${policy.startDate}T00:00:00+05:00`);
      const recent = chance(rng, 0.06) || (isDemo && (k === 40 || k === 41 || k === 43));
      const fromMs = recent ? today - int(rng, 1, 20) * DAY : startMs + (chance(rng, 0.8) ? 0 : int(rng, 1, 120) * DAY);
      let appStatus: InsuredRow['appStatus'] = chance(rng, 0.72) ? 'active' : chance(rng, 0.5) ? 'invited' : 'not_invited';
      if (notInAppIdx) appStatus = notInAppIdx.has(k) ? (k % 2 ? 'invited' : 'not_invited') : 'active';
      const birthYear = int(rng, 1965, 2003);
      const row: InsuredRow = {
        id: id(),
        userId: id(),
        clientId: client.id,
        clientName: client.name,
        policyId: policy.id,
        fullName: p.fullName,
        position: pick(rng, POSITIONS),
        birthDate: `${birthYear}-${String(int(rng, 1, 12)).padStart(2, '0')}-${String(int(rng, 1, 28)).padStart(2, '0')}`,
        pinfl: `${p.female ? 4 : 3}${digits(rng, 13)}`,
        phone: phone(rng),
        email: `emp${insured.length + 1}@client${ci + 1}.example.uz`,
        payoutCard: `8600${digits(rng, 12)}`,
        relation: asEmployee(pick(rng, [0, 0, 1, 1, 2, 3])),
        appStatus,
        myIdVerified: appStatus === 'active' ? chance(rng, 0.9) : false,
        attachedClinicId: pick(rng, clinics).id,
        insuredFrom: isoDay(Math.min(fromMs, today)),
        status: !isDemo && chance(rng, 0.02) ? 'excluded' : 'active',
        addedAt: tzIso(Math.min(fromMs, today) - DAY),
        consentGivenAt: appStatus === 'active' ? tzIso(fromMs + int(rng, 1, 30) * DAY) : undefined,
      };
      if (row.status === 'excluded') {
        row.excludedFrom = isoDay(today - int(rng, 5, 60) * DAY);
        row.updatedAt = tzIso(parseIso(row.excludedFrom));
      }
      if (isDemo && k === 0) {
        row.fullName = 'Karimov Aziz Bahromovich';
        row.position = 'Руководитель отдела логистики';
        row.phone = DEMO_INSURED_PHONE;
        row.payoutCard = '8600123412344417';
        row.appStatus = 'active';
        row.myIdVerified = true;
        row.consentGivenAt = undefined;
        row.birthDate = '1987-05-12';
        row.pinfl = '31205870123456';
        row.insuredFrom = policy.startDate;
        demoInsuredId = row.id;
      }
      if (opts.xss && isDemo && k === 1) row.position = '"><script>alert(1)</script>';
      insured.push(row);
    }
  }

  // ---------- family members (FAMILY_SPEC): a row per person, under the employee ----------
  const demoPerson = insured.find((x) => x.id === demoInsuredId)!;
  const family = seedFamilyMembers(
    {
      demo: demoPerson,
      // A man of the demo company (not the demo person) whose child has just reached the age limit.
      other: insured.find((x) => x.clientId === demoPerson.clientId && x.id !== demoInsuredId && x.status === 'active' && !/a$/.test(x.fullName.split(' ')[0] ?? '')),
      policy: policies.find((p) => p.id === demoPerson.policyId)!,
      clinics,
    },
    { now },
  );
  insured.push(...family.rows);

  // premiums
  for (const policy of policies) {
    const members = insured.filter((x) => x.policyId === policy.id);
    const perPerson = perPersonPremium(policy.program, rng);
    policy.insuredCount = members.filter((m) => m.status === 'active').length;
    policy.premium = Math.round((perPerson * members.length) / 1000) * 1000;
    const client = clients.find((c) => c.id === policy.clientId)!;
    client.premium = policy.premium;
    // invoices: quarterly
    const startMs = Date.parse(`${policy.startDate}T00:00:00+05:00`);
    for (let q = 0; q < 4; q++) {
      const issued = startMs + q * 91 * DAY;
      const due = issued + 15 * DAY;
      if (issued > today + 40 * DAY) break;
      let status: Invoice['status'] = due < today ? (chance(rng, 0.85) ? 'paid' : 'overdue') : 'unpaid';
      if (client.id === demoClient.id && due < today) status = 'paid';
      invoices.push({
        id: id(),
        clientId: client.id,
        number: docNumber('invoice', { year: new Date(issued).getFullYear(), n: invoices.length + 2001 }),
        amount: Math.round(policy.premium / 4 / 1000) * 1000,
        issuedAt: isoDay(issued),
        dueDate: isoDay(due),
        status,
      });
    }
  }
  // make sure the demo company has an upcoming invoice
  const demoPolicy = policies.find((p) => p.clientId === demoClient.id)!;
  if (!invoices.some((inv) => inv.clientId === demoClient.id && inv.status === 'unpaid')) {
    invoices.push({
      id: id(),
      clientId: demoClient.id,
      number: docNumber('invoice', { year: new Date(today).getFullYear(), n: 9001 }),
      amount: Math.round(demoPolicy.premium / 4 / 1000) * 1000,
      issuedAt: isoDay(today - 2 * DAY),
      dueDate: isoDay(today + 16 * DAY),
      status: 'unpaid',
    });
  }

  // ---------- claims ----------
  const claims: ClaimRow[] = [];
  const files: FileRow[] = [];
  // Random claims and appointments go to employees: the family members' own activity is seeded in seed-family.ts.
  const insuredWithPolicy = insured.filter((x) => x.status === 'active' && x.relation === 'employee');
  const actorFor = (to: ClaimStatus, cat: ClaimCategory, amount: number) => {
    if (to === 'to_pay' || to === 'paid') return pick(rng, accountants);
    if (to === 'medical_review') return pick(rng, operators);
    if ((to === 'approved' || to === 'rejected') && (cat === 'dental' || cat === 'inpatient' || amount > 5_000_000))
      return pick(rng, doctors);
    return pick(rng, operators);
  };
  const plan: { status: ClaimStatus; recent: boolean; overdue?: boolean }[] = [];
  const push = (n: number, status: ClaimStatus, recent: boolean, overdue = false) => {
    for (let i = 0; i < n; i++) plan.push({ status, recent, overdue });
  };
  push(29, 'new', true);
  push(6, 'new', true, true);
  push(34, 'review', true);
  push(6, 'review', true, true);
  push(22, 'medical_review', true);
  push(3, 'medical_review', true, true);
  push(20, 'approved', true);
  push(25, 'to_pay', true);
  push(400, 'paid', false);
  push(57, 'rejected', false);
  let claimSeq = 4001;

  const makeClaim = (
    who: InsuredRow,
    status: ClaimStatus,
    createdMs: number,
    category: ClaimCategory,
    amount: number,
    overdue: boolean,
    source: ClaimSource = pick(rng, ['app', 'app', 'clinic_invoice', 'clinic_invoice', 'operator'] as const),
  ): ClaimRow => {
    const claimId = id();
    const serviceMs = createdMs - int(rng, 0, 4) * DAY;
    const provider =
      category === 'medicines' ? pick(rng, PHARMACIES) : category === 'inpatient' ? pick(rng, clinics).name : pick(rng, clinics).name;
    const needsMed = category === 'dental' || category === 'inpatient' || amount > 5_000_000;
    const chain: ClaimStatus[] = ['new'];
    const finalPath: Record<ClaimStatus, ClaimStatus[]> = {
      new: [],
      review: ['review'],
      medical_review: ['review', 'medical_review'],
      approved: needsMed ? ['review', 'medical_review', 'approved'] : ['review', 'approved'],
      rejected: needsMed ? ['review', 'medical_review', 'rejected'] : ['review', 'rejected'],
      to_pay: needsMed ? ['review', 'medical_review', 'approved', 'to_pay'] : ['review', 'approved', 'to_pay'],
      paid: needsMed ? ['review', 'medical_review', 'approved', 'to_pay', 'paid'] : ['review', 'approved', 'to_pay', 'paid'],
    };
    chain.push(...finalPath[status]);
    const history: ClaimEvent[] = [];
    let t = createdMs;
    let approvedById: string | undefined;
    let amountApproved: number | undefined;
    let publicRejectionReason: string | undefined;
    chain.forEach((to, idx) => {
      if (idx === 0) {
        history.push({ at: tzIso(t), actorName: source === 'app' ? 'Застрахованный (приложение)' : source === 'clinic_invoice' ? 'Клиника (счёт)' : 'Оператор', to: 'new' });
        return;
      }
      // Keep events chronological and in the past: spread the remaining steps over the time left.
      const room = Math.max(60_000, (now - 60_000 - t) / (chain.length - idx + 1));
      t += Math.min(int(rng, 2, 30) * 3600_000, room);
      const actor = actorFor(to, category, amount);
      const ev: ClaimEvent = { at: tzIso(t), actorName: actor.fullName, from: chain[idx - 1], to };
      if (to === 'approved') {
        approvedById = actor.id;
        amountApproved = chance(rng, 0.15) ? Math.round((amount * 0.7) / 1000) * 1000 : amount;
        if (amountApproved !== amount) ev.comment = 'Одобрено частично: часть услуг вне программы';
      }
      if (to === 'rejected') {
        publicRejectionReason = pick(rng, REJECT_REASONS);
        ev.comment = `Отказ: ${publicRejectionReason.toLowerCase()}`;
      }
      if (to === 'medical_review') ev.comment = 'Требуется медэкспертиза по правилам программы';
      history.push(ev);
    });
    const attachments: ClaimRow['attachments'] = [];
    const nAtt = source === 'operator' ? 0 : int(rng, 1, 2);
    for (let a = 0; a < nAtt; a++) {
      const fileId = id();
      const kind = source === 'app' ? 'receipt' : 'invoice';
      files.push({
        id: fileId,
        mime: 'image/png',
        claimId,
        insuredId: who.id,
        seedText: [provider, isoDay(serviceMs), `${kind === 'receipt' ? 'Чек' : 'Счёт'} №${int(rng, 1000, 9999)}`, `Итого: ${amount}`],
      });
      attachments.push({ id: fileId, kind, fileName: `${kind}-${a + 1}.png`, mime: 'image/png', sizeBytes: int(rng, 80, 400) * 1024, url: `/api/files/${fileId}` });
    }
    const slaDue = overdue ? now - int(rng, 1, 5) * DAY : createdMs + 5 * DAY;
    return {
      id: claimId,
      number: docNumber('claim', { year: new Date(createdMs).getFullYear(), n: claimSeq++ }),
      insuredId: who.id,
      insuredName: who.fullName,
      clientId: who.clientId,
      clientName: who.clientName,
      category,
      source,
      amountClaimed: amount,
      amountApproved,
      providerName: provider,
      serviceDate: isoDay(serviceMs),
      status,
      slaDueAt: tzIso(Math.max(slaDue, overdue ? 0 : now + int(rng, 2, 96) * 3600_000)),
      createdAt: tzIso(createdMs),
      updatedAt: tzIso(t),
      attachments,
      history,
      approvedById,
      publicRejectionReason,
      // Receipts from the app carry fiscal data recognized from the photo.
      receiptFiscal: source === 'app' ? fakeFiscal(hashString(claimId), provider, isoDay(serviceMs), amount) : undefined,
    };
  };

  for (const p of shuffle(rng, plan)) {
    const who = pick(rng, insuredWithPolicy);
    const cat = pickCategory(rng);
    const amount = claimAmount(rng, cat);
    const ageDays = p.recent ? (p.overdue ? int(rng, 6, 12) : int(rng, 0, 4)) : int(rng, 8, 360);
    const createdMs = now - ageDays * DAY - int(rng, 1, 600) * 60_000;
    const c = makeClaim(who, p.status, createdMs, cat, amount, !!p.overdue);
    if (!p.overdue && ['new', 'review', 'medical_review'].includes(p.status)) {
      c.slaDueAt = tzIso(Math.max(now + int(rng, 2, 72) * 3600_000, createdMs + 5 * DAY));
    }
    claims.push(c);
  }

  // demo insured: one approved, one on review, big dental usage (> 80 %)
  const demo = insured.find((x) => x.id === demoInsuredId)!;
  claims.push(makeClaim(demo, 'approved', now - 3 * DAY, 'medicines', 245_000, false, 'app'));
  claims.push(makeClaim(demo, 'review', now - 1 * DAY + 3600_000, 'doctor_visit', 380_000, false, 'app'));
  claims.push(makeClaim(demo, 'paid', now - 40 * DAY, 'dental', 2_550_000, false, 'clinic_invoice'));
  claims.push(makeClaim(demo, 'paid', now - 75 * DAY, 'diagnostics', 640_000, false, 'app'));
  const demoApproved = claims[claims.length - 4]!;
  demoApproved.amountApproved = 245_000;
  // Dental limit must be running low (demo value of `limitLowShare`): the paid dental claim is approved in full.
  for (const c of claims.slice(-2)) {
    c.amountApproved = c.amountClaimed;
    for (const h of c.history) if (h.to === 'approved') delete h.comment;
  }
  const demoReview = claims[claims.length - 3]!;
  demoReview.slaDueAt = tzIso(now + 2 * DAY);

  // ---------- appointments ----------
  const appointments: Appointment[] = [];
  for (let i = 0; i < 300; i++) {
    const who = pick(rng, insuredWithPolicy);
    const clinic = pick(rng, clinics);
    const dayOffset = int(rng, -14, 14);
    const startsMs = at(today + dayOffset * DAY, int(rng, 9, 17), pick(rng, [0, 30]));
    let status: AppointmentStatus;
    if (startsMs < now) status = pick(rng, ['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'cancelled', 'declined'] as const);
    else status = pick(rng, ['requested', 'requested', 'requested', 'confirmed', 'confirmed', 'confirmed', 'cancelled'] as const);
    if (dayOffset === 0 && startsMs >= now && i % 2 === 0) status = 'requested';
    appointments.push({
      id: id(),
      insuredId: who.id,
      insuredName: who.fullName,
      clientName: who.clientName,
      clinicId: clinic.id,
      clinicName: clinic.name,
      specialty: pick(rng, clinic.specialties),
      startsAt: tzIso(startsMs),
      status,
      createdAt: tzIso(Math.min(startsMs, now) - int(rng, 1, 7) * DAY),
    });
  }
  // make sure there are requests today for the operator queue
  for (let i = 0; i < 6; i++) {
    const who = pick(rng, insuredWithPolicy);
    const clinic = pick(rng, clinics);
    const startsMs = Math.max(at(today, 10 + i, 0), now + (i + 1) * 3600_000);
    appointments.push({
      id: id(),
      insuredId: who.id,
      insuredName: who.fullName,
      clientName: who.clientName,
      clinicId: clinic.id,
      clinicName: clinic.name,
      specialty: pick(rng, clinic.specialties),
      startsAt: tzIso(startsMs),
      status: 'requested',
      createdAt: tzIso(now - int(rng, 1, 20) * 3600_000),
    });
  }
  const demoClinic = clinics.find((c) => c.specialties.includes('therapist'))!;
  appointments.push({
    id: id(),
    insuredId: demo.id,
    insuredName: demo.fullName,
    clientName: demo.clientName,
    clinicId: demoClinic.id,
    clinicName: demoClinic.name,
    specialty: 'therapist',
    startsAt: tzIso(at(today + 2 * DAY, 10, 30)),
    status: 'confirmed',
    createdAt: tzIso(now - DAY),
  });

  // ---------- limit change requests ----------
  const uwDemo = underwriters[0]!;
  const opDemo = operators[0]!;
  const limitRequests: LimitChangeRequest[] = [];
  const cats: LimitCategory[] = ['outpatient', 'dental', 'medicines', 'inpatient'];
  const lr = (by: StaffRow, status: LimitChangeRequest['status'], decider?: StaffRow) => {
    const policy = pick(rng, policies.filter((p) => p.status === 'active'));
    const member = insured.find((x) => x.policyId === policy.id);
    const category = pick(rng, cats);
    const from = PROGRAMS[policy.program].limits[category];
    limitRequests.push({
      id: id(),
      policyId: policy.id,
      policyNumber: policy.number,
      insuredId: chance(rng, 0.6) ? member?.id : undefined,
      category,
      from,
      to: Math.round((from * (1.2 + rng() * 0.6)) / 100_000) * 100_000,
      justification: pick(rng, [
        'Плановая операция по направлению врача, текущего лимита не хватает',
        'Клиент просит расширить лимит для всех сотрудников с 1-го числа',
        'Длительное лечение, согласовано с HR компании',
      ]),
      requestedById: by.id,
      requestedByName: by.fullName,
      status,
      decidedById: decider?.id,
      decidedByName: decider?.fullName,
      createdAt: tzIso(now - int(rng, 1, 20) * DAY),
    });
  };
  lr(opDemo, 'pending');
  lr(operators[1] ?? opDemo, 'pending');
  lr(opDemo, 'pending');
  lr(uwDemo, 'pending');
  lr(uwDemo, 'pending');
  lr(opDemo, 'approved', uwDemo);
  lr(uwDemo, 'approved', underwriters[1]);
  lr(operators[1] ?? opDemo, 'rejected', underwriters[1]);

  // ---------- audit ----------
  const audit: AuditEntry[] = [];
  const auditActions: AuditAction[] = [
    'login', 'login', 'login', 'login', 'logout', 'logout', 'login_failed',
    'reveal_pii', 'reveal_pii', 'open_medical', 'claim_transition', 'claim_transition', 'claim_transition',
    'export', 'limit_change_request', 'limit_change_approve', 'role_change', 'hr_add_employee',
  ];
  for (let i = 0; i < 500; i++) {
    const action = pick(rng, auditActions);
    const atMs = now - int(rng, 5, 30 * 24 * 60) * 60_000;
    let actor: { id: string; name: string; role: Role } = (() => {
      const s = pick(rng, staff);
      return { id: s.id, name: s.fullName, role: s.role };
    })();
    let entry: Partial<AuditEntry> = { targetType: 'session' };
    if (action === 'reveal_pii') {
      const s = pick(rng, [...operators, ...doctors]);
      actor = { id: s.id, name: s.fullName, role: s.role };
      const t = pick(rng, insured);
      entry = { targetType: 'insured', targetId: t.id, targetLabel: `Застрахованный #${t.id.slice(0, 4)}`, reason: pick(rng, ['Звонок застрахованного', 'Запрос клиники', 'Обработка убытка по обращению']) };
    } else if (action === 'open_medical') {
      const s = pick(rng, doctors);
      actor = { id: s.id, name: s.fullName, role: s.role };
      const t = pick(rng, insured);
      entry = { targetType: 'insured', targetId: t.id, targetLabel: `Застрахованный #${t.id.slice(0, 4)}`, reason: 'Медэкспертиза по убытку' };
    } else if (action === 'claim_transition') {
      const c = pick(rng, claims);
      entry = { targetType: 'claim', targetId: c.id, targetLabel: c.number };
    } else if (action === 'export') {
      const s = pick(rng, [...underwriters, ...accountants]);
      actor = { id: s.id, name: s.fullName, role: s.role };
      entry = { targetType: 'export', targetLabel: pick(rng, ['clients', 'claims_financial', 'policies']) };
    } else if (action.startsWith('limit_change')) {
      const r = pick(rng, limitRequests);
      entry = { targetType: 'policy', targetId: r.policyId, targetLabel: r.policyNumber };
    } else if (action === 'role_change') {
      const admin = byRole('admin')[0]!;
      actor = { id: admin.id, name: admin.fullName, role: 'admin' };
      const u = pick(rng, staff);
      entry = { targetType: 'user', targetId: u.id, targetLabel: u.fullName };
    } else if (action === 'hr_add_employee') {
      const h = hrUsers[0]!;
      actor = { id: h.id, name: h.fullName, role: 'hr' };
      const t = pick(rng, insured.filter((x) => x.clientId === h.companyId));
      entry = { targetType: 'insured', targetId: t.id, targetLabel: `Застрахованный #${t.id.slice(0, 4)}` };
    } else if (action === 'login_failed') {
      actor = { id: NIL, name: 'Неизвестный', role: 'operator' };
    }
    audit.push({ id: id(), at: tzIso(atMs), actorId: actor.id, actorName: actor.name, actorRole: actor.role, action, targetType: 'session', ...entry } as AuditEntry);
  }
  audit.sort((a, b) => (a.at < b.at ? 1 : -1));

  // ---------- chat ----------
  const chat: ChatRow[] = [
    { id: id(), insuredId: demo.id, from: 'operator', text: 'Здравствуйте! Я оператор MIG. Чем помочь?', at: tzIso(now - 5 * DAY), visibleAt: tzIso(now - 5 * DAY) },
    { id: id(), insuredId: demo.id, from: 'insured', text: 'Покрывает ли полис анализ крови?', at: tzIso(now - 5 * DAY + 60_000), visibleAt: tzIso(now - 5 * DAY + 60_000) },
    { id: id(), insuredId: demo.id, from: 'operator', text: 'Да, анализы по направлению врача входят в амбулаторный лимит.', at: tzIso(now - 5 * DAY + 180_000), visibleAt: tzIso(now - 5 * DAY + 180_000) },
  ];
  if (opts.xss) {
    chat.push(
      // eslint-disable-next-line no-script-url -- XSS probe data, rendered as plain text
      { id: id(), insuredId: demo.id, from: 'operator', text: 'javascript:alert(1)', at: tzIso(now - 4 * DAY), visibleAt: tzIso(now - 4 * DAY) },
      { id: id(), insuredId: demo.id, from: 'operator', text: 'Подробнее: https://example.com', at: tzIso(now - 4 * DAY + 1000), visibleAt: tzIso(now - 4 * DAY + 1000) },
    );
  }

  const insuredDocuments: InsuredDocRow[] = [];
  const policySeed = seedPolicyChanges({ clients, policies, insured, staff, hrUsers }, { now });
  documents.push(...policySeed.documents);
  const { demoClinicId: _demoClinicId, ...clinicSeed } = seedClinics({ clinics, insured, policies, staff, appointments }, { xss: opts.xss, now });

  const out: Db = {
    staff,
    hrUsers,
    clients,
    policies,
    insured,
    claims,
    appointments,
    clinics,
    audit,
    limitRequests,
    invoices,
    documents,
    insuredDocuments,
    chat,
    files,
    sessions: [],
    challenges: [],
    grants: [],
    loginFailures: [],
    lockouts: [],
    kp: [],
    kpSeq: 122,
    ...clinicSeed,
    cardTokens: [],
    checkAttempts: [],
    checkLocks: [],
    accessTokens: [],
    idempotency: [],
    apiCalls: [],
    integrationsSeed: int(rng, 1, 1000),
    policyChanges: policySeed.policyChanges,
    assistances: [],
    assignments: [],
    assistUsers: [],
    cases: [],
    caseSeq: 0,
    clinicContracts: [],
    rebills: [],
    qaSamples: [],
    dmsParams: { values: {}, changes: [] },
    ai: { settings: defaultAiSettings(), changes: [], logs: [], rebillFlags: {} },
    help: { questions: [] },
    authorityChanges: [],
    deals: [],
    dealEvents: [],
    dealSeq: 40,
    censuses: [],
    quotes: [],
    contracts: [],
    contractSeq: 120,
    contractInsured: [],
    payments: [],
    bankPayments: [],
    statementKeys: [],
    changeRequests: [],
    endorsements: [],
    smsOutbox: [],
    migrationBatches: [],
    familyConsents: [],
    familyRequests: [],
    tasks: [],
    notifications: [],
  };
  seedAssistance(out, { now });
  seedLifecycle(out, { now });
  seedFamilyActivity(out, family, { now });
  return out;
}

/** Work log of the demo client: 40 events every few days back (a long «Активность»); no rng draws. */
function clientLog(now: number): { at: string; text: string }[] {
  const kinds = [
    'Звонок HR: уточнение списка застрахованных',
    'Встреча с HR: итоги квартала',
    'Отправлено письмо HR с отчётом по убыткам',
    'Получен запрос на включение сотрудников',
    'Согласован график медосмотров',
    'Звонок HR: вопрос по лимиту стоматологии',
    'Отправлена памятка застрахованным',
    'Обсуждение условий продления',
  ];
  return Array.from({ length: 40 }, (_, k) => ({ at: tzIso(now - (3 + k * 6) * DAY - (k % 5) * 3_600_000), text: kinds[k % kinds.length]! }));
}
