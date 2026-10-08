/*
 * Seed of assistance companies (ASSISTANCE_SPEC §12). Runs after the rest of the seed on its own
 * RNG stream, so the earlier data does not shift.
 */
import { DMS_DEFAULTS } from '@mig/domain/config/dmsParameters';
import type {
  AssistanceAssignment,
  AssistanceCaseStatus,
  AssistanceCaseType,
  AssistanceCompany,
  ClinicContract,
  QaSample,
  Rebill,
  RebillLine,
  RegistryLine,
  Visit,
} from '@mig/contracts';
import { feeFor, payerOn, CASE_SLA_MINUTES } from '@mig/domain/assistance';
import { formatMoney } from '@mig/domain/lib/format';
import { registryTotals } from '@mig/domain/clinics';
import { docNumber } from '@mig/domain/numbering';
import { DEMO_ASSIST2_OPERATOR, DEMO_ASSIST_USERS, DEMO_INSURED_PHONE, DEMO_PASSWORD } from './credentials';
import type { AssistanceCaseRow, AssistUserRow, Db, GuaranteeRow, IntegrationClientRow, WebhookEndpointRow } from '@mig/domain/store/db';
import { seedClaimsFromRebill } from './seed-rebill-claims';
import { int, mulberry32, pick, SEED, uuidFrom, type Rng } from './rng';
import { DAY, isoDay, monthStartTz, parseIso, tzIso } from './time';

function hex(rng: Rng, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(rng() * 16)]!;
  return s;
}

const COMPANIES: Omit<AssistanceCompany, 'id' | 'contract'>[] = [
  { name: 'Shifo Assistans Group', legalForm: 'llc', phone24x7: '+998 71 205 00 01', integrationMode: 'hybrid' },
  { name: 'MedYurt Servis 24', legalForm: 'jv_llc', phone24x7: '+998 71 207 24 24', integrationMode: 'api' },
  { name: 'Turon Care Assistans', legalForm: 'private_enterprise', phone24x7: '+998 71 209 33 33', integrationMode: 'portal' },
];

export function seedAssistance(d: Db, opts: { now: number }): void {
  const rng = mulberry32(SEED ^ 0xa55157);
  const id = () => uuidFrom(rng);
  const { now } = opts;
  const today = isoDay(now);
  const year = new Date(now).getFullYear();
  const underwriter = d.staff.find((s) => s.role === 'underwriter')!;
  const operator = d.staff.find((s) => s.role === 'operator')!;
  const accountant = d.staff.find((s) => s.role === 'accountant')!;
  // The first day of a month in Tashkent (not by the machine's time zone).
  const monthStart = (offset: number) => monthStartTz(now, offset);
  const periodOf = (m: number) => isoDay(monthStart(m)).slice(0, 7);

  // ---- companies and contracts (§4) ----
  const fees: [AssistanceCompany['contract']['feeModel'], number][] = [
    ['pepm', 15_000],
    ['percent_of_claims', 0.07],
    ['per_case', 50_000],
  ];
  const assistances: AssistanceCompany[] = COMPANIES.map((c, k) => ({
    ...c,
    id: id(),
    contract: {
      number: docNumber('assistContract', { year, n: k + 1 }),
      validFrom: `${year - 1}-01-01`,
      validTo: `${year + 1}-12-31`,
      feeModel: fees[k]![0],
      feeValue: fees[k]![1],
      // The second company has an individual authority in its contract; the others use the DMS parameter.
      ...(k === 1 ? { guaranteeAuthorityLimit: 12_000_000 } : {}),
      rebillPaymentDays: 10,
      // The first company passes reimbursements of the insured to MIG's claims officer (LIFECYCLE_SPEC §13).
      ...(k === 0 ? { handlesReimbursements: false } : {}),
    },
  }));
  const [A1, A2, A3] = assistances as [AssistanceCompany, AssistanceCompany, AssistanceCompany];

  // ---- assignments: demo company → A1; the rest ~13/10/6 and 5 without an assistance (§12) ----
  const demoInsured = d.insured.find((i) => i.phone === DEMO_INSURED_PHONE)!;
  const demoPolicy = d.policies.find((p) => p.id === demoInsured.policyId)!;
  const plan = [...Array(12).fill(A1.id), ...Array(10).fill(A2.id), ...Array(6).fill(A3.id), ...Array(5).fill(null)] as (string | null)[];
  const assignments: AssistanceAssignment[] = [];
  const others = d.policies.filter((p) => p.id !== demoPolicy.id);
  const setAt = (from: string) => tzIso(parseIso(from) - 5 * DAY);
  assignments.push({ policyId: demoPolicy.id, assistanceId: A1.id, from: demoPolicy.startDate, setById: underwriter.id, setAt: setAt(demoPolicy.startDate) });
  others.forEach((p, k) => {
    const a = plan[k % plan.length] ?? null;
    assignments.push({ policyId: p.id, assistanceId: a, from: p.startDate, setById: underwriter.id, setAt: setAt(p.startDate) });
  });
  // One client moved from A2 to A1 in the middle of the year (access by date, §12).
  const moved = others.find((p, k) => plan[k % plan.length] === A1.id && p.status === 'active' && parseIso(p.startDate) < now - 150 * DAY)!;
  const switchDate = isoDay(Math.max(parseIso(moved.startDate) + 120 * DAY, now - 60 * DAY));
  const first = assignments.find((a) => a.policyId === moved.id)!;
  first.assistanceId = A2.id;
  first.to = isoDay(parseIso(switchDate) - DAY);
  assignments.push({ policyId: moved.id, assistanceId: A1.id, from: switchDate, setById: underwriter.id, setAt: setAt(switchDate) });

  for (const p of d.policies) p.assistanceId = payerOrNull(assignments, p.id, p.status === 'expired' ? p.endDate : today);
  for (const c of d.clients) {
    const p = d.policies.find((x) => x.id === c.activePolicyId);
    c.assistanceId = p ? (p.assistanceId ?? null) : null;
  }

  // ---- users (§12) ----
  const assistUsers: AssistUserRow[] = [
    ...DEMO_ASSIST_USERS.map((u) => ({ id: id(), ...u, password: DEMO_PASSWORD, assistanceId: A1.id, active: true, createdAt: tzIso(now - 200 * DAY) })),
    { id: id(), ...DEMO_ASSIST2_OPERATOR, password: DEMO_PASSWORD, assistanceId: A2.id, active: true, createdAt: tzIso(now - 200 * DAY) },
    { id: id(), role: 'asst_admin', email: 'admin@demo-assist2.uz', fullName: 'Karimov Bobur Nodirovich', password: DEMO_PASSWORD, assistanceId: A2.id, active: true, createdAt: tzIso(now - 300 * DAY) },
    { id: id(), role: 'asst_admin', email: 'admin@demo-assist3.uz', fullName: 'Saidova Lola Zafarovna', password: DEMO_PASSWORD, assistanceId: A3.id, active: true, createdAt: tzIso(now - 300 * DAY) },
  ];
  const a1doctor = assistUsers.find((u) => u.role === 'asst_doctor')!;
  const a1operator = assistUsers.find((u) => u.role === 'asst_operator')!;

  // ---- clinic contracts: «[Клиника 1]» has its own prices for A1 (§5.3) ----
  const demoClinicId = d.clinicUsers.find((u) => u.role === 'clinic_registrar')!.clinicId;
  const migPrices = d.priceLists.find((p) => p.clinicId === demoClinicId)!.items;
  const clinicContracts: ClinicContract[] = [
    { clinicId: demoClinicId, payer: A1.id, priceList: migPrices.map((i) => ({ ...i, price: Math.round((i.price * 0.95) / 1000) * 1000 })) },
  ];
  d.clinicContracts = clinicContracts;
  d.assignments = assignments;
  d.assistances = assistances;
  const priceOf = (payer: string, code: string) => (payer === A1.id ? clinicContracts[0]!.priceList : migPrices).find((i) => i.code === code);

  // ---- existing letters and registry lines get their payer on the date of the event ----
  const policyOfInsured = (insuredId: string) => d.policies.find((p) => p.id === d.insured.find((i) => i.id === insuredId)?.policyId);
  for (const g of d.guarantees) {
    const policy = policyOfInsured(g.insuredId);
    g.policyId = policy?.id;
    const a = policy ? payerOrNull(assignments, policy.id, g.createdAt.slice(0, 10)) : null;
    g.assistanceId = a;
    g.assistanceName = assistances.find((x) => x.id === a)?.name;
    if (!a) {
      if (g.approvals.length) g.decidedBy = 'mig';
      continue;
    }
    const over = g.estimatedCost > (assistances.find((x) => x.id === a)?.contract.guaranteeAuthorityLimit ?? DMS_DEFAULTS.assistanceGuaranteeAuthority);
    if (over) {
      g.escalated = true;
      g.assistanceOpinion = 'Показания подтверждены, сумма выше полномочий ассистанса';
      if (g.status !== 'requested' && g.status !== 'info_requested') g.decidedBy = 'mig';
    } else if (g.status !== 'requested' && g.status !== 'info_requested') {
      g.decidedBy = 'assistance';
      g.approvals = g.status === 'rejected' ? [] : [{ byId: a1doctor.id, byName: a1doctor.fullName, at: g.approvals[0]?.at ?? g.createdAt }];
    }
    if (g.decidedBy) {
      // Most letters are decided within a day; a few are late (KPI «ГП решены в срок»).
      g.decidedAt = tzIso(parseIso(g.createdAt) + int(rng, 2, 30) * 3600_000);
      if (g.approvals[0]) g.approvals[0] = { ...g.approvals[0], at: g.decidedAt };
    }
  }
  const visitById = new Map(d.visits.map((v) => [v.id, v]));
  for (const r of d.registries) {
    for (const l of r.lines) {
      const v = l.visitId ? visitById.get(l.visitId) : undefined;
      const policy = v ? policyOfInsured(v.insuredId) : undefined;
      l.payer = policy ? payerOn(assignments, policy.id, l.serviceDate) : 'mig';
    }
  }

  // ---- extra A1 data in «[Клиника 1]»: visits, letters in every state ----
  const a1People = d.insured.filter((i) => i.status === 'active' && payerOrNull(assignments, i.policyId, today) === A1.id);
  const registrarId = d.clinicUsers.find((u) => u.role === 'clinic_registrar')!.id;
  const openVisit = (insuredId: string, atMs: number): Visit => {
    const v: Visit = { id: id(), clinicId: demoClinicId, insuredId, openedById: registrarId, method: 'policy', openedAt: tzIso(atMs), expiresAt: tzIso(atMs + DAY) };
    d.visits.push(v);
    return v;
  };
  const gpService = (code: string) => migPrices.find((p) => p.code === code) ?? migPrices.find((p) => p.requiresGuarantee)!;
  const addLetter = (who: typeof demoInsured, code: string, status: GuaranteeRow['status'], extra: Partial<GuaranteeRow>, hoursAgo: number): GuaranteeRow => {
    const svc = gpService(code);
    const created = now - hoursAgo * 3600_000;
    const v = openVisit(who.id, created - 20 * 60_000);
    const price = priceOf(A1.id, svc.code)?.price ?? svc.price;
    const g: GuaranteeRow = {
      id: id(),
      number: docNumber('guarantee', { year, n: ++d.guaranteeSeq }),
      clinicId: demoClinicId,
      visitId: v.id,
      insuredId: who.id,
      policyId: who.policyId,
      insuredName: who.fullName,
      serviceCode: svc.code,
      serviceName: svc.name,
      icd10: pick(rng, ['K80.2', 'M51.1', 'G43.9', 'I20.8', 'K35.8']),
      estimatedCost: price,
      status,
      approvals: [],
      comment: 'Запрос регистратуры по направлению лечащего врача',
      attachments: [],
      createdAt: tzIso(created),
      assistanceId: A1.id,
      assistanceName: A1.name,
      ...extra,
    };
    d.guarantees.push(g);
    return g;
  };
  const other = (k: number) => a1People.filter((p) => p.id !== demoInsured.id)[k % Math.max(1, a1People.length - 1)] ?? demoInsured;
  const cheap = migPrices.filter((p) => p.requiresGuarantee && p.price <= DMS_DEFAULTS.assistanceGuaranteeAuthority);
  const costly = migPrices.filter((p) => p.requiresGuarantee && p.price > DMS_DEFAULTS.assistanceGuaranteeAuthority);
  addLetter(other(0), cheap[0]!.code, 'requested', {}, 3);
  addLetter(other(1), cheap[1 % cheap.length]!.code, 'approved', { decidedBy: 'assistance', decidedAt: tzIso(now - 20 * 3600_000), approvedAmount: priceOf(A1.id, cheap[1 % cheap.length]!.code)!.price, validUntil: isoDay(now + DMS_DEFAULTS.guaranteeValidityDays * DAY), approvals: [{ byId: a1doctor.id, byName: a1doctor.fullName, at: tzIso(now - 20 * 3600_000) }] }, 26);
  addLetter(other(2), cheap[2 % cheap.length]!.code, 'rejected', { decidedBy: 'assistance', decidedAt: tzIso(now - 30 * 3600_000), reason: 'Нет показаний: сначала амбулаторное лечение' }, 50);
  if (costly.length) {
    addLetter(other(3), costly[0]!.code, 'requested', { escalated: true, assistanceOpinion: 'Показана плановая операция; сумма выше полномочий ассистанса' }, 6);
    const done = addLetter(other(4), costly[costly.length - 1]!.code, 'approved', { escalated: true, decidedBy: 'mig', assistanceOpinion: 'Операция показана, прошу одобрить' }, 70);
    done.approvedAmount = done.estimatedCost;
    done.decidedAt = tzIso(now - 58 * 3600_000);
    done.validUntil = isoDay(now + DMS_DEFAULTS.guaranteeValidityDays * DAY);
    const doctors = d.staff.filter((s) => s.role === 'doctor_expert');
    done.approvals = doctors.slice(0, done.estimatedCost > DMS_DEFAULTS.guaranteeDualApprovalThreshold ? 2 : 1).map((s, k) => ({ byId: s.id, byName: s.fullName, at: tzIso(now - (60 - k) * 3600_000) }));
  }

  // ---- an older A1-only registry (paid two months ago) for the paid rebill ----
  const olderLines: RegistryLine[] = [];
  const simple = migPrices.filter((p) => !p.requiresGuarantee && !/[<>]/.test(p.name));
  for (let k = 0; k < 8 && a1People.length; k++) {
    const who = a1People[k % a1People.length]!;
    const day = monthStart(3) + int(rng, 1, 25) * DAY;
    const v = openVisit(who.id, day + 10 * 3600_000);
    const svc = simple[k % simple.length]!;
    const price = priceOf(A1.id, svc.code)!.price;
    olderLines.push({
      id: id(),
      visitId: v.id,
      insuredName: who.fullName,
      serviceDate: isoDay(day),
      serviceCode: svc.code,
      serviceName: svc.name,
      icd10: 'J06.9',
      quantity: 1,
      price,
      amount: price,
      status: 'accepted',
      payer: A1.id,
      payment: { paidAt: isoDay(monthStart(2) + int(rng, 5, 20) * DAY), amount: price, orderNumber: docNumber('paymentOrder', { n: int(rng, 10000, 99999) }) },
    });
  }
  if (olderLines.length) {
    const submitted = monthStart(2) + 2 * DAY;
    d.registries.push({ id: id(), clinicId: demoClinicId, period: periodOf(3), status: 'paid', source: 'portal', lines: olderLines, totals: registryTotals(olderLines, true), submittedAt: tzIso(submitted), paidAt: tzIso(submitted + 20 * DAY) });
  }

  // ---- a registry of another clinic waiting for review: lines of A1 and of MIG (§5.3, e2e 4) ----
  const clinic2 = d.clinics.find((c) => c.id !== demoClinicId && d.priceLists.some((p) => p.clinicId === c.id))!;
  const prices2 = d.priceLists.find((p) => p.clinicId === clinic2.id)!.items.filter((p) => !p.requiresGuarantee && !/[<>]/.test(p.name));
  const migPeople = d.insured.filter((i) => i.status === 'active' && payerOrNull(assignments, i.policyId, today) === null && parseIso(d.policies.find((p) => p.id === i.policyId)!.startDate) < monthStart(1));
  const pendingLines: RegistryLine[] = [];
  const pendingOf = (who: (typeof d.insured)[number], k: number): RegistryLine => {
    const day = monthStart(1) + int(rng, 1, 25) * DAY;
    const v: Visit = { id: id(), clinicId: clinic2.id, insuredId: who.id, openedById: registrarId, method: 'policy', openedAt: tzIso(day + 9 * 3600_000), expiresAt: tzIso(day + 33 * 3600_000) };
    d.visits.push(v);
    const svc = prices2[k % prices2.length]!;
    return {
      id: id(),
      visitId: v.id,
      insuredName: who.fullName,
      serviceDate: isoDay(day),
      serviceCode: svc.code,
      serviceName: svc.name,
      icd10: pick(rng, ['J06.9', 'K29.7', 'M54.5']),
      quantity: 1,
      price: svc.price,
      amount: svc.price,
      status: 'pending',
      payer: payerOn(assignments, who.policyId, isoDay(day)),
    };
  };
  for (let k = 0; k < 4; k++) pendingLines.push(pendingOf(other(k + 6), k));
  for (let k = 0; k < 2 && migPeople.length; k++) pendingLines.push(pendingOf(migPeople[k]!, k + 4));
  if (pendingLines.length) {
    d.registries.push({ id: id(), clinicId: clinic2.id, period: periodOf(1), status: 'submitted', source: 'portal', lines: pendingLines, totals: registryTotals(pendingLines, false), submittedAt: tzIso(Math.min(now - DAY, monthStart(0) + 2 * DAY)) });
  }

  // ---- payments of A1 lines: two months ago → last month, last month → this month ----
  const regOf = (m: number) => d.registries.find((r) => r.clinicId === demoClinicId && r.period === periodOf(m) && r.status !== 'draft');
  const payLines = (m: number, payMonth: number) => {
    const r = regOf(m);
    if (!r) return;
    for (const l of r.lines) {
      if (l.payer === A1.id && l.status === 'accepted') {
        const at = Math.min(now - DAY, monthStart(payMonth) + int(rng, 3, 20) * DAY);
        l.payment = { paidAt: isoDay(Math.max(at, monthStart(payMonth))), amount: l.amount, orderNumber: docNumber('paymentOrder', { n: int(rng, 10000, 99999) }) };
      }
      if (l.payer === 'mig' && l.status === 'accepted' && r.status === 'paid') l.payment = { paidAt: (r.paidAt ?? tzIso(now)).slice(0, 10), amount: l.amount, orderNumber: docNumber('paymentOrder', { n: int(rng, 10000, 99999) }) };
    }
  };
  payLines(2, 1);
  payLines(1, 0);

  // ---- rebills of A1: paid, partially accepted with flags, draft of this month (§12) ----
  const toRebillLine = (l: RegistryLine, status: RebillLine['status'] = 'accepted'): RebillLine => ({
    id: id(),
    registryLineId: l.id,
    clinicName: d.clinics.find((c) => c.id === demoClinicId)!.name,
    insuredName: l.insuredName,
    serviceDate: l.serviceDate,
    serviceName: l.serviceName,
    amount: l.amount,
    checks: [],
    status,
  });
  const a1Insured = (month: number) => d.insured.filter((i) => i.status === 'active' && payerOrNull(assignments, i.policyId, isoDay(monthStart(month))) === A1.id).length;
  const makeRebill = (month: number, lines: RebillLine[], status: Rebill['status'], suffix: string): Rebill => {
    const claims = lines.reduce((s, l) => s + l.amount, 0);
    const fee = feeFor(A1.contract.feeModel, A1.contract.feeValue, { insuredCount: a1Insured(month), claimsAmount: claims, casesCount: 0 });
    const accepted = lines.filter((l) => l.status === 'accepted').reduce((s, l) => s + l.amount, 0);
    const rejected = lines.filter((l) => l.status === 'rejected').reduce((s, l) => s + l.amount, 0);
    return {
      id: id(),
      number: docNumber('assistInvoice', { period: periodOf(month), code: suffix }),
      assistanceId: A1.id,
      period: periodOf(month),
      lines,
      fee,
      totals: { claims, fee: fee.amount, total: claims + fee.amount, accepted, rejected },
      status,
      ...(status !== 'draft' ? { submittedAt: tzIso(monthStart(month - 1 < 0 ? 0 : month - 1) + 2 * DAY) } : {}),
      ...(status === 'paid' || status === 'partially_accepted' ? { acceptedById: operator.id } : {}),
      ...(status === 'paid' ? { paidById: accountant.id, paidAt: tzIso(monthStart(month - 1) + 12 * DAY) } : {}),
    };
  };
  const rebills: Rebill[] = [];
  const paidLines = olderLines.map((l) => toRebillLine(l));
  if (paidLines.length) rebills.push(makeRebill(2, paidLines, 'paid', 'A1'));
  const lastMonth = (regOf(2)?.lines ?? []).filter((l) => l.payer === A1.id && l.payment).map((l) => toRebillLine(l));
  if (paidLines[0]) {
    lastMonth.push({ ...toRebillLine(olderLines[0]!, 'rejected'), checks: [{ code: 'duplicate', message: 'Эта строка реестра уже есть в другом счёте' }], rejectionReason: 'Дубль: строка уже оплачена в прошлом счёте' });
  }
  if (lastMonth[0]) {
    const l = lastMonth[0];
    l.status = 'rejected';
    l.checks = [{ code: 'over_limit', message: `Сумма ${formatMoney(l.amount)} больше остатка лимита ${formatMoney(Math.round(l.amount / 2000) * 1000)}` }];
    l.rejectionReason = 'Превышен лимит по амбулаторной помощи';
  }
  if (lastMonth.length) rebills.push(makeRebill(1, lastMonth, 'partially_accepted', 'A1'));
  const thisMonth = (regOf(1)?.lines ?? []).filter((l) => l.payer === A1.id && l.payment).map((l) => toRebillLine(l, 'pending'));
  rebills.push(makeRebill(0, thisMonth, 'draft', 'A1'));
  // Accepted lines of reviewed rebills are MIG claims with the `assistance` source.
  d.rebills = rebills;
  for (const b of rebills) {
    if (b.status === 'draft') continue;
    seedClaimsFromRebill(d, b, operator.fullName, opts);
    if (b.status === 'paid') {
      const ids = new Set(b.lines.map((l) => l.registryLineId));
      for (const c of d.claims) if (c.registryLineId && ids.has(c.registryLineId)) c.status = 'paid';
    }
  }

  // ---- cases (§5.1): A1 in every status; the moved client has old A2 cases ----
  let caseSeq = 12_300;
  const cases: AssistanceCaseRow[] = [];
  const statuses: AssistanceCaseStatus[] = ['open', 'open', 'in_progress', 'in_progress', 'waiting', 'resolved', 'resolved', 'resolved'];
  const types: AssistanceCaseType[] = ['appointment', 'consultation', 'guarantee', 'complaint', 'emergency', 'appointment', 'consultation', 'appointment'];
  const TEXT: Record<AssistanceCaseType, string> = {
    appointment: 'Просит записать к терапевту на ближайшие дни',
    consultation: 'Вопрос о покрытии анализов по программе',
    guarantee: 'Клиника запросила гарантийное письмо на МРТ',
    complaint: 'Жалоба на долгое ожидание ответа колл-центра',
    emergency: 'Высокая температура у ребёнка, нужна помощь ночью',
  };
  const addCase = (assistanceId: string, who: typeof demoInsured, type: AssistanceCaseType, status: AssistanceCaseStatus, atMs: number): void => {
    cases.push({
      id: id(),
      number: docNumber('case', { year: new Date(atMs).getFullYear(), n: ++caseSeq }),
      assistanceId,
      insuredId: who.id,
      insuredName: who.fullName,
      policyId: who.policyId,
      type,
      channel: type === 'complaint' ? 'app' : pick(rng, ['phone', 'phone', 'chat'] as const),
      status,
      slaDueAt: tzIso(atMs + CASE_SLA_MINUTES[type] * 60_000),
      description: TEXT[type],
      ...(status === 'resolved' ? { resolution: 'Вопрос решён, застрахованный уведомлён' } : {}),
      links: {},
      createdAt: tzIso(atMs),
      createdById: a1operator.id,
    });
  };
  statuses.forEach((st, k) => addCase(A1.id, k < 3 ? demoInsured : other(k), types[k]!, st, now - (k * 7 + 1) * 3600_000 - (st === 'resolved' ? 3 * DAY : 0)));
  addCase(A1.id, other(5), 'complaint', 'open', now - 30 * 60_000);
  const movedPeople = d.insured.filter((i) => i.policyId === moved.id && i.status === 'active');
  for (let k = 0; k < Math.min(3, movedPeople.length); k++) {
    const cases2 = cases.length;
    addCase(A2.id, movedPeople[k]!, pick(rng, ['appointment', 'consultation'] as const), 'resolved', parseIso(switchDate) - (10 + k * 7) * DAY);
    cases[cases2]!.createdById = assistUsers.find((u) => u.email === DEMO_ASSIST2_OPERATOR.email)!.id;
  }

  // ---- quality-control sample: 20 decisions of A1, 2 «не согласен» (§12) ----
  const subjects: QaSample['subject'][] = [
    ...d.guarantees.filter((g) => g.assistanceId === A1.id && g.decidedBy === 'assistance').map((g) => ({ type: 'guarantee' as const, id: g.id, label: g.number })),
    ...d.registries.flatMap((r) => r.lines.filter((l) => l.payer === A1.id && l.status === 'accepted').map((l) => ({ type: 'registry_line' as const, id: l.id, label: `${r.period}: ${l.serviceName}` }))),
  ].slice(0, 20);
  const doctor = d.staff.find((s) => s.role === 'doctor_expert')!;
  const qaSamples: QaSample[] = subjects.map((subject, k) => ({
    id: id(),
    assistanceId: A1.id,
    subject,
    createdAt: tzIso(monthStart(k < 12 ? 1 : 0) + (k % 10) * DAY),
    ...(k < 14
      ? {
          verdict: k === 3 || k === 9 ? ('disagree' as const) : ('agree' as const),
          comment: k === 3 ? 'Показания к МРТ не подтверждены' : k === 9 ? 'Услуга не соответствует диагнозу' : undefined,
          reviewedById: doctor.id,
        }
      : {}),
  }));

  // ---- integration: A1 (hybrid) has a key and a webhook, A2 (api) a key (§8) ----
  const key = (assistanceId: string, name: string): IntegrationClientRow => ({
    id: id(),
    clinicId: assistanceId,
    partnerType: 'assistance',
    name,
    clientId: `mig_${hex(rng, 20)}`,
    secretLast4: hex(rng, 4),
    secretHash: hex(rng, 64),
    scopes: ['roster:read', 'cases:write', 'appointments:write', 'guarantees:decide', 'registries:review', 'payments:write', 'rebills:write'],
    ipAllowlist: [],
    createdAt: tzIso(now - 90 * DAY),
    lastUsedAt: tzIso(now - 2 * 3600_000),
  });
  const k1 = key(A1.id, 'Shifo CRM');
  const k2 = key(A2.id, 'MedYurt API');
  d.integrationClients.push(k1, k2);
  const templates = ['/assistance/roster', '/assistance/guarantees', '/assistance/guarantees/{id}/decide', '/assistance/registries', '/assistance/cases'];
  for (const [k, n] of [[k1, 24], [k2, 30]] as const) {
    for (let j = 0; j < n; j++) {
      const path = pick(rng, templates);
      d.apiLogs.push({
        id: id(),
        clinicId: k.clinicId,
        clientId: k.clientId,
        at: tzIso(now - j * 53 * 60_000 - int(rng, 0, 600) * 1000),
        method: path.includes('decide') ? 'POST' : 'GET',
        pathTemplate: path,
        status: j % 11 === 5 ? 404 : 200,
        latencyMs: int(rng, 40, 300),
      });
    }
  }
  const hook: WebhookEndpointRow = {
    id: id(),
    clinicId: A1.id,
    partnerType: 'assistance',
    url: 'https://crm.shifo-assist.uz/mig/hooks',
    events: ['insured.added', 'insured.excluded', 'policy.assigned', 'guarantee.requested', 'registry.received', 'rebill.reviewed', 'rebill.paid', 'qa.disagreement'],
    secretLast4: hex(rng, 4),
    signingSecret: hex(rng, 64),
    active: true,
    createdAt: tzIso(now - 90 * DAY),
  };
  d.webhooks.push(hook);

  Object.assign(d, { assistances, assignments, assistUsers, cases, caseSeq, qaSamples });
}

function payerOrNull(assignments: readonly AssistanceAssignment[], policyId: string, date: string): string | null {
  const p = payerOn(assignments, policyId, date);
  return p === 'mig' ? null : p;
}

