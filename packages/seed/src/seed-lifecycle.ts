/*
 * Seed of the contract lifecycle and claims settlement (LIFECYCLE_SPEC §16). Runs last on its own RNG
 * stream, so the earlier data does not shift. Uses only demo parameter values (DMS_DEFAULTS): the
 * database is not ready yet, so dmsParam() cannot be called here.
 */
import type { ChangeRequest, Census, Client, Contract, Deal, Endorsement, KpDocument, Quote } from '@mig/contracts';
import { DMS_DEFAULTS } from '@mig/domain/config/dmsParameters';
import { calculateQuote, type CensusRow } from '@mig/domain/tariff';
import { addLine, excludeLine, REFUND_RULES } from '@mig/domain/endorsements';
import { buildPaymentSchedule, defaultStartDate } from '@mig/domain/contracts';
import { docNumber } from '@mig/domain/numbering';
import { formatLegalName } from '@mig/domain/config/legalForms';
import { defaultEndDate, tariffOf } from '@mig/domain/policies';
import { KP_TEMPLATE_VERSION, kpTotalPremium } from '@mig/domain/kp';
import { detectFlags } from '@mig/domain/settlement';
import { statementLineKey } from '@mig/domain/payments';
import { DOC_TEMPLATES } from '@mig/domain/documents/templates/index';
import type { ChangeRequestRow, ClaimRow, ClientRow, Db } from './db';
import { DEMO_INSURED_PHONE, DEMO_PASSWORD } from './credentials';
import { int, mulberry32, pick, SEED, uuidFrom, type Rng } from './rng';
import { DAY, isoDay, parseIso, tzIso } from './time';
import { PROGRAMS } from './programs';

const LEADS: Pick<Client, 'legalForm' | 'name' | 'inn'>[] = [
  { legalForm: 'llc', name: 'Samarqand Agro Eksport', inn: '309112233' },
  { legalForm: 'jsc', name: 'Fargʻona Tekstil Kombinati', inn: '305445566' },
];
/** Minimal group (DECISIONS «Только корпоративные клиенты»): a sole proprietor lead, a lead of 6, an approved exception. */
const SMALL: Pick<Client, 'legalForm' | 'name' | 'inn'>[] = [
  { legalForm: 'sole_proprietor', name: 'Karimov Anvar Rustamovich', inn: '512340001' },
  { legalForm: 'llc', name: 'Navoiy Mebel', inn: '309550066' },
  { legalForm: 'llc', name: 'Termiz Agro Servis', inn: '309660077' },
];
const PROSPECTS: Pick<Client, 'legalForm' | 'name' | 'inn'>[] = [
  { legalForm: 'llc', name: 'Fargʻona Qurilish', inn: '307778899' },
  { legalForm: 'jv_llc', name: 'Buxoro Savdo', inn: '308001122' },
  { legalForm: 'private_enterprise', name: 'Xorazm Logistik', inn: '306334455' },
  { legalForm: 'jsc', name: 'Andijon Farm Distribyusiya', inn: '304556677' },
];

function census(rng: Rng, employees: number, year: number): CensusRow[] {
  const rows: CensusRow[] = [];
  for (let k = 0; k < employees; k++) {
    rows.push({ gender: rng() < 0.55 ? 'm' : 'f', birthYear: int(rng, year - 62, year - 21), relation: 'employee' });
    if (rng() < 0.35) rows.push({ gender: rng() < 0.5 ? 'm' : 'f', birthYear: int(rng, year - 60, year - 22), relation: 'spouse' });
    if (rng() < 0.3) rows.push({ gender: rng() < 0.5 ? 'm' : 'f', birthYear: int(rng, year - 17, year - 1), relation: 'child' });
  }
  return rows;
}

export function seedLifecycle(d: Db, opts: { now: number }): void {
  const rng = mulberry32(SEED ^ 0x11fec7);
  const id = () => uuidFrom(rng);
  const { now } = opts;
  const today = isoDay(now);
  const year = new Date(now).getFullYear();
  const at = (daysAgo: number, h = 10) => tzIso(now - daysAgo * DAY + h * 3600_000 - 10 * 3600_000);
  const sales = d.staff.find((s) => s.role === 'sales_manager')!;
  const underwriter = d.staff.find((s) => s.email === 'underwriter@demo.mig.uz')!;
  const head = d.staff.find((s) => s.email === 'underwriter-head@demo.mig.uz')!;
  const legal = d.staff.find((s) => s.role === 'legal')!;
  const claimsOfficer = d.staff.find((s) => s.email === 'claims@demo.mig.uz')!;
  const hr = d.hrUsers[0]!;
  const event = (dealId: string, daysAgo: number, actorName: string, text: string) => d.dealEvents.unshift({ id: id(), dealId, at: at(daysAgo), actorName, text });

  const newClient = (c: (typeof LEADS)[number], status: Client['status'], headcount: number, daysAgo: number): ClientRow => {
    const row: ClientRow = {
      id: id(),
      ...c,
      status,
      managerId: sales.id,
      managerName: sales.fullName,
      hrContact: { name: pick(rng, ['Azimova Shahlo Ravshanovna', 'Rashidov Bekzod Akmalovich', 'Yoʻldosheva Madina Farhodovna', 'Sultonov Otabek Bahromovich']), phone: `+99890${int(rng, 1000000, 9999999)}`, email: `hr@${c.inn}.example.uz` },
      premium: 0,
      lossRatio: null,
      createdAt: at(daysAgo),
      requisites: { bank: 'Demo Bank ATB', account: `2020800${int(rng, 1000000, 9999999)}${int(rng, 100000, 999999)}`, mfo: '00000', director: pick(rng, ['Aliyev Rustam Karimovich', 'Yusupova Dilnoza Anvarovna', 'Kim Sergey Vladimirovich']), directorBasis: 'Устав', address: 'г. Ташкент' },
      estimatedHeadcount: headcount,
      currentInsurer: pick(rng, ['Нет', 'Другой страховщик']),
      assistanceId: null,
    };
    d.clients.push(row);
    return row;
  };
  const newDeal = (client: ClientRow, stage: Deal['stage'], daysAgo: number, type: Deal['type'] = 'new'): Deal => {
    d.dealSeq += 1;
    const deal: Deal = {
      id: id(),
      number: docNumber('deal', { year, n: d.dealSeq }),
      clientId: client.id,
      type,
      stage,
      ownerId: sales.id,
      underwriterId: underwriter.id,
      expectedStart: defaultStartDate(isoDay(now)),
      createdAt: at(daysAgo),
      updatedAt: at(Math.max(0, daysAgo - 3)),
    };
    d.deals.push(deal);
    event(deal.id, daysAgo, sales.fullName, `Лид создан: ${formatLegalName(client.name, client.legalForm, 'ru')}`);
    return deal;
  };
  const withCensus = (deal: Deal, employees: number, daysAgo: number): Census => {
    const c: Census = { id: id(), dealId: deal.id, rows: census(rng, employees, year), uploadedAt: at(daysAgo) };
    d.censuses.push(c);
    event(deal.id, daysAgo, sales.fullName, `Загружены данные для оценки: ${c.rows.length} человек`);
    return c;
  };
  const withQuote = (deal: Deal, c: Census, program: Quote['program'], adjustments: Quote['adjustments'], status: Quote['status'], daysAgo: number, pricingBasis: Quote['pricingBasis'] = 'flat_by_type'): Quote => {
    const calc = calculateQuote({ program, rows: c.rows, startDate: deal.expectedStart!, adjustments }, DMS_DEFAULTS);
    const q: Quote = {
      id: id(),
      dealId: deal.id,
      program,
      rates: calc.rates,
      adjustments,
      groupDiscountPct: calc.groupDiscountPct,
      premiumEmployee: calc.premiumEmployee,
      premiumFamily: calc.premiumFamily,
      total: calc.total,
      discountFromTariffPct: calc.discountFromTariffPct,
      pricingBasis,
      ageBandRates: calc.ageBandRates,
      status,
      approvals: status === 'approved' ? [{ byId: underwriter.id, byName: underwriter.fullName, at: at(daysAgo), comment: 'В пределах полномочий' }] : [],
      createdById: underwriter.id,
      createdByName: underwriter.fullName,
      updatedAt: at(daysAgo),
    };
    d.quotes.push(q);
    event(deal.id, daysAgo, underwriter.fullName, status === 'pending_approval' ? `Котировка на согласовании: скидка ${Math.round(q.discountFromTariffPct * 100)}%` : status === 'draft' ? `Черновик котировки: ${PROGRAMS[program].name}` : `Котировка утверждена: ${PROGRAMS[program].name}`);
    return q;
  };
  const withKp = (deal: Deal, client: ClientRow, q: Quote, c: Census, status: KpDocument['status'], daysAgo: number): KpDocument => {
    d.kpSeq += 1;
    const employees = c.rows.filter((r) => r.relation === 'employee').length;
    const limits = PROGRAMS[q.program].limits;
    const params = {
      templateId: 'gold' as const,
      lang: 'ru' as const,
      variant: 'white' as const,
      sumInsured: limits.outpatient + limits.dental + limits.medicines + limits.inpatient,
      premiumEmployee: q.premiumEmployee,
      premiumFamily: q.premiumFamily,
      employees,
      familyMembers: c.rows.length - employees,
      coverageStart: deal.expectedStart!,
      coverageEnd: defaultEndDate(deal.expectedStart!),
      validUntil: isoDay(now + 20 * DAY),
      paymentTerms: 'single' as const,
      assistanceId: d.assistances[0]?.id ?? null,
    };
    const kp: KpDocument = {
      id: id(),
      number: docNumber('kp', { year, n: d.kpSeq }),
      clientId: client.id,
      clientName: client.name,
      clientLegalForm: client.legalForm,
      clientInn: client.inn,
      params,
      templateVersion: KP_TEMPLATE_VERSION.gold,
      totalPremium: kpTotalPremium(params),
      status,
      createdById: sales.id,
      createdByName: sales.fullName,
      createdByEmail: sales.email,
      createdAt: at(daysAgo),
      sentAt: at(daysAgo),
      dealId: deal.id,
      quoteId: q.id,
      ...(status === 'accepted' ? { response: { at: at(daysAgo - 1), byName: client.hrContact.name, via: 'hr' as const } } : {}),
    };
    d.kp.unshift(kp);
    // As on the server: sending the offer opens the HR cabinet of the client's contact.
    if (!d.hrUsers.some((h) => h.companyId === client.id)) d.hrUsers.push({ id: id(), email: client.hrContact.email, password: DEMO_PASSWORD, fullName: client.hrContact.name, companyId: client.id });
    event(deal.id, daysAgo, sales.fullName, `КП ${kp.number} отправлено клиенту`);
    if (status === 'accepted') event(deal.id, daysAgo - 1, client.hrContact.name, `КП ${kp.number} принято клиентом в кабинете`);
    return kp;
  };
  const newContract = (deal: Deal, client: ClientRow, kp: KpDocument, q: Quote | undefined, daysAgo: number): Contract => {
    d.contractSeq += 1;
    const total = kp.params.premiumEmployee * kp.params.employees + kp.params.premiumFamily * kp.params.familyMembers;
    const c: Contract = {
      id: id(),
      number: docNumber('contract', { year, n: d.contractSeq }),
      dealId: deal.id,
      clientId: client.id,
      clientName: client.name,
      version: 1,
      templateId: 'contract',
      templateVersion: DOC_TEMPLATES.contract.version,
      params: {
        startDate: kp.params.coverageStart,
        endDate: kp.params.coverageEnd,
        program: q?.program ?? 'standard',
        premiumEmployee: kp.params.premiumEmployee,
        premiumFamily: kp.params.premiumFamily,
        employees: kp.params.employees,
        familyMembers: kp.params.familyMembers,
        total,
        pricingBasis: q?.pricingBasis ?? 'flat_by_type',
        ...(q?.ageBandRates.length ? { ageBandRates: q.ageBandRates.map((r) => ({ ...r })) } : {}),
        paymentFrequency: 'quarterly',
        paymentSchedule: buildPaymentSchedule(total, kp.params.coverageStart, 'quarterly'),
        activationRule: 'after_first_payment',
        migSignatoryId: head.id,
        clientSignatory: { name: client.requisites!.director, position: 'Директор', basis: client.requisites!.directorBasis },
        assistanceId: kp.params.assistanceId ?? null,
      },
      clauseOverrides: [],
      status: 'draft',
      signing: { paperOriginal: { required: false } },
      createdAt: at(daysAgo),
      quoteId: q?.id,
      versions: [{ version: 1, at: at(daysAgo), byName: sales.fullName, changes: `Создан по КП ${kp.number}` }],
    };
    d.contracts.push(c);
    event(deal.id, daysAgo, sales.fullName, `Подготовлен договор ${c.number}`);
    return c;
  };

  // ---- 2 leads ----
  // The first lead has had no activity for a while (the manager's queue); the second is being quoted.
  newDeal(newClient(LEADS[0]!, 'lead', 80, 12), 'lead', 12);
  {
    const client = newClient(LEADS[1]!, 'lead', 150, 6);
    const deal = newDeal(client, 'quote', 6);
    const c = withCensus(deal, 148, 4);
    withQuote(deal, c, 'basic', [], 'draft', 1);
  }

  // ---- deal 1: the quote waits for approval (discount above the underwriter's 10%) ----
  {
    const client = newClient(PROSPECTS[0]!, 'negotiation', 60, 20);
    const deal = newDeal(client, 'quote', 20);
    const c = withCensus(deal, 58, 18);
    withQuote(deal, c, 'standard', [{ label: 'Скидка за лояльность', pct: -0.15, comment: 'Клиент переходит от другого страховщика с хорошей историей' }], 'pending_approval', 2);
  }
  // ---- deal 2: the offer was sent ----
  {
    const client = newClient(PROSPECTS[1]!, 'negotiation', 35, 25);
    const deal = newDeal(client, 'kp_sent', 25);
    const c = withCensus(deal, 33, 22);
    const q = withQuote(deal, c, 'standard_plus', [], 'approved', 15);
    withKp(deal, client, q, c, 'sent', 10);
  }
  // ---- deal 3: the contract is at the lawyer with a changed clause; inclusions are priced by age band ----
  {
    const client = newClient(PROSPECTS[2]!, 'negotiation', 80, 40);
    const deal = newDeal(client, 'contract_review', 40);
    const c = withCensus(deal, 76, 36);
    const q = withQuote(deal, c, 'standard', [{ label: 'Надбавка за отрасль', pct: 0.06, comment: 'Тяжёлые условия труда на складах' }], 'approved', 30, 'age_banded');
    const kp = withKp(deal, client, q, c, 'accepted', 25);
    const contract = newContract(deal, client, kp, q, 15);
    contract.clauseOverrides = [
      {
        clauseId: '5.3',
        original: DOC_TEMPLATES.contract.sections.flatMap((s) => s.clauses).find((x) => x.id === '5.3')!.text,
        text: 'При просрочке взноса более чем на 15 календарных дней Страховщик вправе приостановить обслуживание по договору до погашения задолженности.',
        byId: sales.id,
        byName: sales.fullName,
        at: at(4),
      },
    ];
    contract.status = 'legal_review';
    contract.versions.push({ version: 1, at: at(4), byName: sales.fullName, changes: 'изменены пункты 5.3' }, { version: 1, at: at(3), byName: sales.fullName, changes: 'Отправлен юристу' });
    event(deal.id, 3, sales.fullName, `Договор ${contract.number} у юриста: изменено пунктов 1`);
  }
  // ---- deal 4: signing — MIG signed with E-IMZO, the client sent a scan, the original is not received ----
  {
    const client = newClient(PROSPECTS[3]!, 'negotiation', 45, 50);
    const deal = newDeal(client, 'signing', 50);
    const c = withCensus(deal, 42, 46);
    const q = withQuote(deal, c, 'premium', [], 'approved', 40);
    const kp = withKp(deal, client, q, c, 'accepted', 35);
    const contract = newContract(deal, client, kp, q, 25);
    contract.status = 'signing';
    contract.legalApprovedByName = legal.fullName;
    const scanId = id();
    d.files.push({ id: scanId, mime: 'image/png', clientId: client.id, contractId: contract.id, fileName: 'scan-client.png', seedText: [`Скан договора ${contract.number}`, 'Подпись клиента', 'Печать организации'] });
    contract.signing = {
      mig: { method: 'eimzo', signedAt: at(6), signerName: head.fullName, certificate: { serial: '5F3A9C21', owner: head.fullName, validTo: isoDay(now + 300 * DAY) } },
      paperOriginal: { required: true },
      pendingScans: [{ side: 'client', fileId: scanId, uploadedAt: at(2), uploadedByName: sales.fullName }],
    };
    contract.versions.push({ version: 1, at: at(8), byName: sales.fullName, changes: 'Согласован без юриста (пункты не менялись)' }, { version: 1, at: at(7), byName: sales.fullName, changes: 'Отправлен клиенту' });
    event(deal.id, 6, head.fullName, `${contract.number}: подпись МИГ (ЭЦП)`);
    event(deal.id, 2, sales.fullName, `${contract.number}: загружен скан подписи клиента, ждёт проверки`);
  }

  // ---- the demo HR company: an active contract with two endorsements and this month's requests ----
  const demoClient = d.clients.find((c) => c.id === hr.companyId)!;
  const demoPolicy = d.policies.find((p) => p.id === demoClient.activePolicyId)!;
  const members = d.insured.filter((i) => i.policyId === demoPolicy.id);
  const tariff = tariffOf(demoPolicy);
  // A row per person (FAMILY_SPEC): employees and family members by type.
  const family = members.filter((i) => i.relation !== 'employee').length;
  const employees = members.length - family;
  demoClient.requisites = { bank: 'Demo Bank ATB', account: '20208000900123456789', mfo: '00000', director: 'Tursunov Baxtiyor Alisherovich', directorBasis: 'Устав', address: 'г. Ташкент, Юнусабадский р-н' };
  const demoDeal: Deal = {
    id: id(),
    number: docNumber('deal', { year, n: ++d.dealSeq }),
    clientId: demoClient.id,
    type: 'new',
    stage: 'active',
    ownerId: sales.id,
    underwriterId: underwriter.id,
    expectedStart: demoPolicy.startDate,
    createdAt: tzIso(parseIso(demoPolicy.startDate) - 45 * DAY),
    updatedAt: tzIso(parseIso(demoPolicy.startDate)),
  };
  d.deals.push(demoDeal);
  d.contractSeq += 1;
  const demoContractYear = Number(demoPolicy.startDate.slice(0, 4));
  const demoContractSeq = d.contractSeq;
  const total = tariff.employee * employees + tariff.family * family;
  const demoContract: Contract = {
    id: id(),
    number: docNumber('contract', { year: demoContractYear, n: demoContractSeq }),
    dealId: demoDeal.id,
    clientId: demoClient.id,
    clientName: demoClient.name,
    version: 1,
    templateId: 'contract',
    templateVersion: DOC_TEMPLATES.contract.version,
    params: {
      startDate: demoPolicy.startDate,
      endDate: demoPolicy.endDate,
      program: demoPolicy.program,
      premiumEmployee: tariff.employee,
      premiumFamily: tariff.family,
      employees,
      familyMembers: family,
      total,
      // The demo HR company's contract prices inclusions by type (premium_employee / premium_family).
      pricingBasis: 'flat_by_type',
      paymentFrequency: 'quarterly',
      paymentSchedule: buildPaymentSchedule(total, demoPolicy.startDate, 'quarterly'),
      activationRule: 'on_start_date',
      migSignatoryId: head.id,
      clientSignatory: { name: demoClient.requisites.director, position: 'Директор', basis: 'Устав' },
      assistanceId: demoPolicy.assistanceId ?? d.assistances[0]?.id ?? null,
    },
    clauseOverrides: [],
    status: 'active',
    signing: {
      mig: { method: 'eimzo', signedAt: tzIso(parseIso(demoPolicy.startDate) - 10 * DAY), signerName: head.fullName, certificate: { serial: '5F3A9C21', owner: head.fullName, validTo: isoDay(now + 300 * DAY) } },
      client: { method: 'eimzo', signedAt: tzIso(parseIso(demoPolicy.startDate) - 9 * DAY), signerName: demoClient.requisites.director, certificate: { serial: '41D2A0B7', owner: demoClient.requisites.director, validTo: isoDay(now + 200 * DAY) } },
      paperOriginal: { required: false },
    },
    createdAt: tzIso(parseIso(demoPolicy.startDate) - 20 * DAY),
    versions: [{ version: 1, at: tzIso(parseIso(demoPolicy.startDate) - 20 * DAY), byName: sales.fullName, changes: 'Создан' }],
    policyId: demoPolicy.id,
    activatedAt: tzIso(parseIso(demoPolicy.startDate)),
  };
  d.contracts.push(demoContract);
  demoPolicy.contractId = demoContract.id;
  members.forEach((m, k) => {
    m.contractId = demoContract.id;
    m.certificateNumber = docNumber('certificate', { year: demoContractYear, n: demoContractSeq, m: k + 1 });
  });
  const pinflOf = (id: string | undefined) => members.find((m) => m.id === id)?.pinfl;
  d.contractInsured.push({
    contractId: demoContract.id,
    rows: members.map((m) => ({ fullName: m.fullName, birthDate: m.birthDate, pinfl: m.pinfl, phone: m.phone, position: m.position, relation: m.relation, ...(m.principalId ? { principalPinfl: pinflOf(m.principalId) } : {}) })),
  });
  for (const inv of d.invoices.filter((i) => i.clientId === demoClient.id)) {
    inv.contractId = demoContract.id;
    inv.paid = inv.status === 'paid' ? inv.amount : 0;
  }
  // «Ручная разноска»: a payment by a holding company for the demo client, and one from an unknown payer.
  const accountant = d.staff.find((u) => u.role === 'accountant');
  const upcoming = d.invoices.find((i) => i.clientId === demoClient.id && i.contractId === demoContract.id && i.status !== 'paid');
  if (upcoming) {
    d.bankPayments.push({
      id: id(),
      docNumber: '4817',
      date: isoDay(now - DAY),
      amount: upcoming.amount,
      payerInn: '302998877',
      payerName: 'Demo Holding Group',
      payerLegalForm: 'llc',
      purpose: `Оплата за ${formatLegalName(demoClient.name, demoClient.legalForm, 'ru')} по счёту ${upcoming.number}, договор ${demoContract.number}`,
      reason: 'third_party',
      importedAt: at(1),
      importedByName: accountant?.fullName ?? 'Бухгалтер',
      allocated: 0,
      status: 'pending',
      allocations: [],
    });
  }
  d.bankPayments.push({
    id: id(),
    docNumber: '4790',
    date: isoDay(now - 2 * DAY),
    amount: 12_500_000,
    payerInn: '301556677',
    payerName: 'Toshkent Servis Treyd',
    payerLegalForm: 'llc',
    purpose: 'Оплата по договору страхования ДМС',
    reason: 'unknown_payer',
    importedAt: at(2),
    importedByName: accountant?.fullName ?? 'Бухгалтер',
    allocated: 0,
    status: 'pending',
    allocations: [],
  });
  // These lines were imported: uploading the same statement again skips them.
  for (const b of d.bankPayments) d.statementKeys.push(statementLineKey({ docNumber: b.docNumber ?? '', date: b.date, amount: b.amount, payerInn: b.payerInn }));
  event(demoDeal.id, 1, 'Система', `Договор ${demoContract.number} действует: полис ${demoPolicy.number}`);

  // The demo contract prices by type; the seed's requests are about employees.
  const EMPLOYEE_RULE = { basis: 'flat_by_type', key: 'premium_employee' } as const;
  const request = (type: ChangeRequest['type'], insuredId: string, effective: string, status: ChangeRequest['status'], description: string): ChangeRequestRow => {
    const r: ChangeRequestRow = {
      id: id(),
      contractId: demoContract.id,
      type,
      effectiveDate: effective,
      insuredId,
      payload: { relation: members.find((m) => m.id === insuredId)?.relation ?? 'employee', annual: tariff.employee, rule: EMPLOYEE_RULE },
      requestedBy: { id: hr.id, role: 'hr', name: hr.fullName },
      status,
      createdAt: tzIso(parseIso(effective) - DAY),
      description,
    };
    d.changeRequests.push(r);
    return r;
  };
  const short = (name: string) => name.split(' ').map((w, k) => (k === 0 ? w : `${w[0]}.`)).join(' ');
  const staffOnly = members.filter((m) => m.relation === 'employee');
  const recent = staffOnly.filter((m) => m.phone !== DEMO_INSURED_PHONE && m.status === 'active' && m.insuredFrom > demoPolicy.startDate).sort((a, b) => (a.insuredFrom < b.insuredFrom ? -1 : 1));
  const leavers = staffOnly.filter((m) => m.phone !== DEMO_INSURED_PHONE && m.status === 'active' && m.appStatus === 'active' && m.insuredFrom === demoPolicy.startDate);
  const refund = REFUND_RULES[DMS_DEFAULTS.refundRule]!;
  const line = (r: ChangeRequestRow) => {
    // The requests of the seed are about employees: the employee's tariff.
    const annual = tariff.employee;
    const calc =
      r.type === 'add_insured'
        ? addLine(annual, r.effectiveDate, demoContract.params.startDate, demoContract.params.endDate, EMPLOYEE_RULE)
        : excludeLine(annual, r.effectiveDate, demoContract.params.startDate, demoContract.params.endDate, refund, 0);
    return { changeRequestId: r.id, description: r.description!, ...calc };
  };
  const endorsement = (n: number, requests: ChangeRequestRow[], status: Endorsement['status'], daysAgo: number): Endorsement => {
    const lines = requests.map(line);
    const e: Endorsement = {
      id: id(),
      number: docNumber('endorsement', { n, ref: demoContract.number }),
      contractId: demoContract.id,
      kind: 'changes',
      changeRequestIds: requests.map((r) => r.id),
      lines,
      total: lines.reduce((s, l) => s + l.amount, 0),
      clauseOverrides: [],
      status,
      signing: {
        mig: { method: 'eimzo', signedAt: at(daysAgo), signerName: head.fullName, certificate: { serial: '5F3A9C21', owner: head.fullName, validTo: isoDay(now + 300 * DAY) } },
        ...(status === 'signed' ? { client: { method: 'eimzo' as const, signedAt: at(daysAgo - 1), signerName: demoClient.requisites!.director, certificate: { serial: '41D2A0B7', owner: demoClient.requisites!.director, validTo: isoDay(now + 200 * DAY) } } } : {}),
        paperOriginal: { required: false },
      },
      createdAt: at(daysAgo + 2),
    };
    for (const r of requests) r.endorsementId = e.id;
    d.endorsements.push(e);
    return e;
  };
  // ДС-1: signed, its surcharge invoice paid.
  const first = recent[0];
  if (first) {
    const r1 = request('add_insured', first.id, first.insuredFrom, 'included', `Включение: ${short(first.fullName)} (${first.position})`);
    const e1 = endorsement(1, [r1], 'signed', 20);
    const inv = { id: id(), clientId: demoClient.id, number: docNumber('invoice', { year, n: 9101 }), amount: Math.max(1000, e1.total), issuedAt: isoDay(now - 19 * DAY), dueDate: isoDay(now - 9 * DAY), status: 'paid' as const, contractId: demoContract.id, endorsementId: e1.id, paid: Math.max(1000, e1.total) };
    d.invoices.unshift(inv);
    e1.invoiceId = inv.id;
    d.documents.unshift({ id: id(), clientId: demoClient.id, title: `Дополнительное соглашение ${e1.number}`, kind: 'endorsement', createdAt: isoDay(now - 19 * DAY) });
  }
  // ДС-2: sent to the client, MIG signed; HR has to sign it in the cabinet.
  const leaver = leavers[5];
  if (leaver && recent[1]) {
    leaver.status = 'excluded';
    leaver.excludedFrom = isoDay(now - 6 * DAY);
    leaver.updatedAt = tzIso(now - 6 * DAY);
    const r2 = request('exclude_insured', leaver.id, leaver.excludedFrom, 'pending', `Исключение: ${short(leaver.fullName)} (${leaver.position})`);
    const r3 = request('add_insured', recent[1].id, recent[1].insuredFrom, 'pending', `Включение: ${short(recent[1].fullName)} (${recent[1].position})`);
    endorsement(2, [r2, r3], 'signing', 3);
  }
  // ДС-3: an individual change («прочее») with a changed clause — the lawyer reviews it, the underwriter approves the amount.
  {
    const r4: ChangeRequestRow = {
      id: id(),
      contractId: demoContract.id,
      type: 'other',
      effectiveDate: isoDay(now - 2 * DAY),
      payload: { amount: 1_200_000, description: 'Расширение покрытия: стоматология для руководителей' },
      requestedBy: { id: sales.id, role: 'sales_manager', name: sales.fullName },
      status: 'included',
      createdAt: at(4),
      description: 'Расширение покрытия: стоматология для руководителей',
    };
    d.changeRequests.push(r4);
    const e3 = endorsement(3, [], 'legal_review', 2);
    e3.changeRequestIds = [r4.id];
    e3.lines = [{ changeRequestId: r4.id, description: r4.description!, days: 0, amount: 1_200_000, formula: 'Сумма по согласованию (утверждает андеррайтер)' }];
    e3.total = 1_200_000;
    e3.signing = { paperOriginal: { required: false } };
    const clause = DOC_TEMPLATES.endorsement.sections.flatMap((s) => s.clauses)[0];
    if (clause) e3.clauseOverrides = [{ clauseId: clause.id, original: clause.text, text: `${clause.text} Изменение распространяется только на руководителей подразделений.`, byId: sales.id, byName: sales.fullName, at: at(2) }];
    r4.endorsementId = e3.id;
  }
  // Requests of this month not yet in an endorsement.
  const leaver2 = leavers[9];
  if (leaver2 && recent[2]) {
    leaver2.status = 'excluded';
    leaver2.excludedFrom = today;
    leaver2.updatedAt = tzIso(now);
    request('exclude_insured', leaver2.id, today, 'pending', `Исключение: ${short(leaver2.fullName)} (${leaver2.position})`);
    request('add_insured', recent[2].id, recent[2].insuredFrom > isoDay(now - 25 * DAY) ? recent[2].insuredFrom : today, 'pending', `Включение: ${short(recent[2].fullName)} (${recent[2].position})`);
  }
  demoPolicy.insuredCount = members.filter((m) => m.status === 'active').length;

  // ---- the renewal offer of the demo company: HR can accept it ----
  {
    const deal: Deal = {
      id: id(),
      number: docNumber('deal', { year, n: ++d.dealSeq }),
      clientId: demoClient.id,
      type: 'renewal',
      stage: 'kp_sent',
      ownerId: sales.id,
      underwriterId: underwriter.id,
      expectedStart: isoDay(parseIso(demoPolicy.endDate) + DAY),
      previousPolicyId: demoPolicy.id,
      createdAt: at(12),
      updatedAt: at(5),
    };
    d.deals.push(deal);
    const c: Census = { id: id(), dealId: deal.id, rows: members.filter((m) => m.status === 'active').map((m) => ({ gender: m.pinfl.startsWith('4') ? 'f' : 'm', birthYear: Number(m.birthDate.slice(0, 4)), relation: 'employee' })), uploadedAt: at(11) };
    d.censuses.push(c);
    const q = withQuote(deal, c, demoPolicy.program, [], 'approved', 8);
    withKp(deal, demoClient, q, c, 'sent', 5);
    event(deal.id, 12, sales.fullName, `Сделка на продление полиса ${demoPolicy.number}`);
  }

  // ---- claims for the claims officer (§16): 5 above claims@'s authority, 4 flagged, 2 appeals, 3 waiting for the doctor ----
  const mig = (c: ClaimRow) => !c.registryLineId && c.source !== 'assistance';
  const open = d.claims.filter((c) => mig(c) && (c.status === 'new' || c.status === 'review') && c.insuredId !== members.find((m) => m.phone === DEMO_INSURED_PHONE)?.id);
  for (const c of d.claims) c.handledBy = 'mig';
  const take = (n: number) => open.splice(0, n);
  const reviewNote = (c: ClaimRow, actor: string, daysAgo: number) => {
    if (c.status === 'new') {
      c.history.push({ at: at(daysAgo), actorName: actor, from: 'new', to: 'review' });
      c.status = 'review';
    }
  };
  // Above claims@'s authority (5 000 000): decisions wait for claims-head@.
  take(5).forEach((c, k) => {
    c.amountClaimed = [6_400_000, 8_900_000, 12_500_000, 7_200_000, 18_000_000][k]!;
    c.category = k % 2 ? 'inpatient' : 'diagnostics';
    reviewNote(c, claimsOfficer.fullName, 3);
    const kind = k === 3 ? 'reject' : k === 2 ? 'partial' : 'approve';
    const amount = kind === 'reject' ? 0 : kind === 'partial' ? Math.round((c.amountClaimed * 0.7) / 1000) * 1000 : c.amountClaimed;
    c.pendingDecision = {
      kind,
      amount,
      ...(kind === 'approve' ? {} : { clauseId: kind === 'reject' ? 'contract:4.3' : 'contract:8.5' }),
      reason: kind === 'approve' ? '' : kind === 'reject' ? 'Услуга входит в исключения программы' : 'Часть услуг не входит в программу',
      byId: claimsOfficer.id,
      byName: claimsOfficer.fullName,
      at: at(1),
      required: kind === 'reject' ? c.amountClaimed : amount,
    };
  });
  // Two more above 5 000 000 without a decision yet (e2e: an officer's decision goes for approval).
  take(2).forEach((c, k) => {
    c.amountClaimed = [9_600_000, 11_300_000][k]!;
    reviewNote(c, claimsOfficer.fullName, 2);
  });
  // Flags: a duplicate receipt, frequent claims, outside the coverage period, above the price list.
  const flagged = take(4);
  if (flagged.length === 4) {
    const [dup, freq, outside, price] = flagged as [ClaimRow, ClaimRow, ClaimRow, ClaimRow];
    // The same pharmacy receipt claimed by two different insured people: the fiscal sign gives it away.
    const twin = d.claims.find((x) => x.id !== dup.id && x.insuredId !== dup.insuredId && x.receiptFiscal?.fiscalNumber && x.status === 'paid') ?? d.claims.find((x) => x.id !== dup.id && x.receiptFiscal?.fiscalNumber)!;
    dup.source = 'app';
    dup.category = twin.category;
    dup.amountClaimed = twin.amountClaimed;
    dup.serviceDate = twin.serviceDate;
    dup.providerName = twin.providerName;
    dup.receiptFiscal = { ...twin.receiptFiscal! };
    const month = freq.serviceDate.slice(0, 7);
    for (const x of d.claims.filter((o) => o.insuredId !== freq.insuredId).slice(0, DMS_DEFAULTS.fraudMaxClaimsPerMonth + 1)) {
      if (x.id === freq.id) continue;
      x.insuredId = freq.insuredId;
      x.insuredName = freq.insuredName;
      x.clientId = freq.clientId;
      x.clientName = freq.clientName;
      x.serviceDate = `${month}-${String(int(rng, 1, 27)).padStart(2, '0')}`;
    }
    const who = d.insured.find((i) => i.id === outside.insuredId);
    if (who) outside.serviceDate = isoDay(parseIso(who.insuredFrom) - 5 * DAY);
    price.expectedPrice = Math.round(price.amountClaimed / 2 / 1000) * 1000;
  }
  // Appeals: refused with a clause, the insured disputes the decision.
  take(2).forEach((c, k) => {
    reviewNote(c, claimsOfficer.fullName, 9);
    c.decision = { kind: 'reject', amount: 0, clauseId: k ? 'contract:8.4' : 'contract:4.3', reason: k ? 'Нет документов, подтверждающих оплату' : 'Услуга не входит в программу страхования', byId: claimsOfficer.id, byName: claimsOfficer.fullName, at: at(7) };
    c.history.push({ at: at(7), actorName: claimsOfficer.fullName, from: 'review', to: 'rejected', comment: c.decision.reason });
    c.status = 'rejected';
    c.publicRejectionReason = c.decision.reason;
    c.appeal = { at: at(2), by: 'insured', text: k ? 'Чек и выписка банка приложены, прошу пересмотреть' : 'Врач назначил это обследование, направление есть', status: 'open' };
  });
  // Waiting for the doctor's opinion.
  take(3).forEach((c) => {
    reviewNote(c, claimsOfficer.fullName, 4);
    c.opinion = { requestedAt: at(2), requestedByName: claimsOfficer.fullName, question: 'Обоснованность назначения и объём услуг' };
    c.history.push({ at: at(2), actorName: claimsOfficer.fullName, from: 'review', to: 'medical_review', comment: 'Запрошено заключение врача' });
    c.status = 'medical_review';
  });
  // Fraud flags of every claim, from the same rules as the server.
  for (const c of d.claims) {
    const i = d.insured.find((x) => x.id === c.insuredId);
    const p = i ? d.policies.find((x) => x.id === i.policyId) : undefined;
    const found = detectFlags({
      claim: c,
      others: d.claims.filter((o) => o.id !== c.id),
      coverageFrom: i?.insuredFrom ?? p?.startDate ?? '0000-01-01',
      coverageTo: p?.endDate ?? '9999-12-31',
      excludedFrom: i?.excludedFrom,
      params: { maxPerMonth: DMS_DEFAULTS.fraudMaxClaimsPerMonth, priceExcessShare: DMS_DEFAULTS.fraudPriceExcessShare, daysBeforeExclusion: DMS_DEFAULTS.fraudDaysBeforeExclusion },
    });
    c.flags = found.map((f) => ({ id: id(), ...f }));
  }

  // ---- minimal group: an ИП lead (cannot be taken further), a quote of 6 employees, an approved exception ----
  newDeal(newClient(SMALL[0]!, 'lead', 4, 30), 'lead', 30);
  {
    const client = newClient(SMALL[1]!, 'lead', 6, 9);
    const deal = newDeal(client, 'quote', 9);
    const c: Census = { id: id(), dealId: deal.id, rows: census(rng, 6, year), uploadedAt: at(7) };
    d.censuses.push(c);
    event(deal.id, 7, sales.fullName, `Загружены данные для оценки: ${c.rows.length} человек`);
    withQuote(deal, c, 'standard', [], 'draft', 5);
  }
  {
    const client = newClient(SMALL[2]!, 'negotiation', 8, 15);
    const deal = newDeal(client, 'quote', 15);
    const c: Census = { id: id(), dealId: deal.id, rows: census(rng, 8, year), uploadedAt: at(13) };
    d.censuses.push(c);
    const q = withQuote(deal, c, 'standard', [], 'approved', 10);
    q.approvals = [{ byId: head.id, byName: head.fullName, at: at(10), comment: 'Исключение: компания растёт, через 3 месяца 15 сотрудников' }];
    q.belowMinException = { byName: head.fullName, at: at(10), comment: 'Компания растёт, через 3 месяца 15 сотрудников' };
  }

  // Changes proposed by the second administrator: the first one confirms them (four eyes).
  const admin2 = d.staff.find((x) => x.email === 'admin2@demo.mig.uz');
  const uw2 = d.staff.find((x) => x.role === 'underwriter' && x.email !== underwriter.email && x.email !== head.email);
  if (admin2) {
    d.dmsParams.changes.push({ id: id(), key: 'limitLowShare', from: DMS_DEFAULTS.limitLowShare, to: 0.25, reason: 'Предупреждать о лимите на исходе раньше', status: 'pending', proposedById: admin2.id, proposedByName: admin2.fullName, proposedAt: at(1) });
    if (uw2) {
      const from = { authority: uw2.authority ?? {} };
      d.authorityChanges.push({ id: id(), staffId: uw2.id, staffName: uw2.fullName, from, to: { authority: { ...from.authority, quoteDiscountMaxPct: 0.12 } }, reason: 'Расширение полномочий после аттестации', status: 'pending', proposedById: admin2.id, proposedByName: admin2.fullName, proposedAt: at(1) });
    }
  }
}
