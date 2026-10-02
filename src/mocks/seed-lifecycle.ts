/*
 * Seed of the contract lifecycle and claims settlement (LIFECYCLE_SPEC §16). Runs last on its own RNG
 * stream, so the earlier data does not shift. Uses only demo parameter values (DMS_DEFAULTS): the
 * database is not ready yet, so dmsParam() cannot be called here.
 */
import type { ChangeRequest, Census, Client, Contract, Deal, Endorsement, KpDocument, Quote } from '@/shared/types';
import { DMS_DEFAULTS } from '@/shared/config/dmsParameters';
import { calculateQuote, type CensusRow } from '@/shared/domain/tariff';
import { addLine, excludeLine, REFUND_RULES } from '@/shared/domain/endorsements';
import { buildPaymentSchedule, certificateNumber, contractNumber, dealNumber, defaultStartDate, endorsementNumber } from '@/shared/domain/contracts';
import { defaultEndDate, tariffOf } from '@/shared/domain/policies';
import { KP_TEMPLATE_VERSION, kpNumber, kpTotalPremium } from '@/shared/domain/kp';
import { detectFlags } from '@/shared/domain/settlement';
import { DOC_TEMPLATES } from '@/features/documents/templates';
import type { ChangeRequestRow, ClaimRow, ClientRow, Db } from './db';
import { DEMO_INSURED_PHONE } from './credentials';
import { int, mulberry32, pick, SEED, uuidFrom, type Rng } from './rng';
import { DAY, isoDay, parseIso, tzIso } from './time';
import { PROGRAMS } from './programs';

const LEADS: Pick<Client, 'legalForm' | 'name' | 'inn'>[] = [
  { legalForm: 'ООО', name: 'Самарканд Агро Экспорт', inn: '309112233' },
  { legalForm: 'АО', name: 'Ферганский текстильный комбинат', inn: '305445566' },
];
const PROSPECTS: Pick<Client, 'legalForm' | 'name' | 'inn'>[] = [
  { legalForm: 'ООО', name: 'Наманган Строй Инвест', inn: '307778899' },
  { legalForm: 'СП ООО', name: 'Бухара Тревел Сервис', inn: '308001122' },
  { legalForm: 'ООО', name: 'Хорезм Логистик Плюс', inn: '306334455' },
  { legalForm: 'АО', name: 'Андижан Фарм Дистрибуция', inn: '304556677' },
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
      hrContact: { name: pick(rng, ['Шахло Азимова', 'Бекзод Рашидов', 'Мадина Юлдашева', 'Отабек Султанов']), phone: `+99890${int(rng, 1000000, 9999999)}`, email: `hr@${c.inn}.example.uz` },
      premium: 0,
      lossRatio: null,
      createdAt: at(daysAgo),
      requisites: { bank: 'АКБ «Демо Банк»', account: `2020800${int(rng, 1000000, 9999999)}${int(rng, 100000, 999999)}`, mfo: '00000', director: pick(rng, ['Алиев Рустам Каримович', 'Юсупова Дилноза Анваровна', 'Ким Сергей Владимирович']), directorBasis: 'Устав', address: 'г. Ташкент' },
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
      number: dealNumber(year, d.dealSeq),
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
    event(deal.id, daysAgo, sales.fullName, `Лид создан: ${client.legalForm} «${client.name}»`);
    return deal;
  };
  const withCensus = (deal: Deal, employees: number, daysAgo: number): Census => {
    const c: Census = { id: id(), dealId: deal.id, rows: census(rng, employees, year), uploadedAt: at(daysAgo) };
    d.censuses.push(c);
    event(deal.id, daysAgo, sales.fullName, `Загружены данные для оценки: ${c.rows.length} человек`);
    return c;
  };
  const withQuote = (deal: Deal, c: Census, program: Quote['program'], adjustments: Quote['adjustments'], status: Quote['status'], daysAgo: number): Quote => {
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
      status,
      approvals: status === 'approved' ? [{ byId: underwriter.id, byName: underwriter.fullName, at: at(daysAgo), comment: 'В пределах полномочий' }] : [],
      createdById: underwriter.id,
      createdByName: underwriter.fullName,
      updatedAt: at(daysAgo),
    };
    d.quotes.push(q);
    event(deal.id, daysAgo, underwriter.fullName, status === 'pending_approval' ? `Котировка на согласовании: скидка ${Math.round(q.discountFromTariffPct * 100)}%` : `Котировка утверждена: ${PROGRAMS[program].name}`);
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
      number: kpNumber(year, d.kpSeq),
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
    event(deal.id, daysAgo, sales.fullName, `КП ${kp.number} отправлено клиенту`);
    if (status === 'accepted') event(deal.id, daysAgo - 1, client.hrContact.name, `КП ${kp.number} принято клиентом в кабинете`);
    return kp;
  };
  const newContract = (deal: Deal, client: ClientRow, kp: KpDocument, q: Quote | undefined, daysAgo: number): Contract => {
    d.contractSeq += 1;
    const total = kp.params.premiumEmployee * kp.params.employees + kp.params.premiumFamily * kp.params.familyMembers;
    const c: Contract = {
      id: id(),
      number: contractNumber(year, d.contractSeq),
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
  LEADS.forEach((l, k) => newDeal(newClient(l, 'lead', 80 + k * 70, 6 - k * 3), 'lead', 6 - k * 3));

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
  // ---- deal 3: the contract is at the lawyer with a changed clause ----
  {
    const client = newClient(PROSPECTS[2]!, 'negotiation', 80, 40);
    const deal = newDeal(client, 'contract_review', 40);
    const c = withCensus(deal, 76, 36);
    const q = withQuote(deal, c, 'standard', [{ label: 'Надбавка за отрасль', pct: 0.06, comment: 'Тяжёлые условия труда на складах' }], 'approved', 30);
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
  const employees = members.length;
  const family = members.reduce((s, i) => s + i.familyMembersCount, 0);
  demoClient.requisites = { bank: 'АКБ «Демо Банк»', account: '20208000900123456789', mfo: '00000', director: 'Турсунов Бахтиёр Алишерович', directorBasis: 'Устав', address: 'г. Ташкент, Юнусабадский р-н' };
  const demoDeal: Deal = {
    id: id(),
    number: dealNumber(year, ++d.dealSeq),
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
  const total = tariff.employee * employees + tariff.family * family;
  const demoContract: Contract = {
    id: id(),
    number: contractNumber(Number(demoPolicy.startDate.slice(0, 4)), d.contractSeq),
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
    m.certificateNumber = certificateNumber(demoContract.number, k + 1);
  });
  d.contractInsured.push({ contractId: demoContract.id, rows: members.map((m) => ({ fullName: m.fullName, birthDate: m.birthDate, pinfl: m.pinfl, phone: m.phone, position: m.position, familyMembers: m.familyMembersCount })) });
  for (const inv of d.invoices.filter((i) => i.clientId === demoClient.id)) {
    inv.contractId = demoContract.id;
    inv.paid = inv.status === 'paid' ? inv.amount : 0;
  }
  event(demoDeal.id, 1, 'Система', `Договор ${demoContract.number} действует: полис ${demoPolicy.number}`);

  const request = (type: ChangeRequest['type'], insuredId: string, effective: string, status: ChangeRequest['status'], description: string): ChangeRequestRow => {
    const r: ChangeRequestRow = {
      id: id(),
      contractId: demoContract.id,
      type,
      effectiveDate: effective,
      insuredId,
      payload: { familyMembers: members.find((m) => m.id === insuredId)?.familyMembersCount ?? 0 },
      requestedBy: { id: hr.id, role: 'hr', name: hr.fullName },
      status,
      createdAt: tzIso(parseIso(effective) - DAY),
      description,
    };
    d.changeRequests.push(r);
    return r;
  };
  const short = (name: string) => name.split(' ').map((w, k) => (k === 0 ? w : `${w[0]}.`)).join(' ');
  const recent = members.filter((m) => m.phone !== DEMO_INSURED_PHONE && m.status === 'active' && m.insuredFrom > demoPolicy.startDate).sort((a, b) => (a.insuredFrom < b.insuredFrom ? -1 : 1));
  const leavers = members.filter((m) => m.phone !== DEMO_INSURED_PHONE && m.status === 'active' && m.appStatus === 'active' && m.insuredFrom === demoPolicy.startDate);
  const refund = REFUND_RULES[DMS_DEFAULTS.refundRule]!;
  const line = (r: ChangeRequestRow) => {
    const person = members.find((m) => m.id === r.insuredId)!;
    const annual = tariff.employee + tariff.family * person.familyMembersCount;
    const calc =
      r.type === 'add_insured'
        ? addLine(annual, r.effectiveDate, demoContract.params.startDate, demoContract.params.endDate)
        : excludeLine(annual, r.effectiveDate, demoContract.params.startDate, demoContract.params.endDate, refund, 0);
    return { changeRequestId: r.id, description: r.description!, ...calc };
  };
  const endorsement = (n: number, requests: ChangeRequestRow[], status: Endorsement['status'], daysAgo: number): Endorsement => {
    const lines = requests.map(line);
    const e: Endorsement = {
      id: id(),
      number: endorsementNumber(n, demoContract.number),
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
    const inv = { id: id(), clientId: demoClient.id, number: `СЧ-${year}-ДС1`, amount: Math.max(1000, e1.total), issuedAt: isoDay(now - 19 * DAY), dueDate: isoDay(now - 9 * DAY), status: 'paid' as const, contractId: demoContract.id, endorsementId: e1.id, paid: Math.max(1000, e1.total) };
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
      number: dealNumber(year, ++d.dealSeq),
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
    const twin = d.claims.find((x) => x.insuredId === dup.insuredId && x.id !== dup.id) ?? d.claims.find((x) => x.id !== dup.id)!;
    dup.amountClaimed = twin.amountClaimed;
    dup.serviceDate = twin.serviceDate;
    dup.providerName = twin.providerName;
    dup.insuredId = twin.insuredId;
    dup.insuredName = twin.insuredName;
    dup.clientId = twin.clientId;
    dup.clientName = twin.clientName;
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
      others: d.claims.filter((o) => o.id !== c.id && o.insuredId === c.insuredId),
      coverageFrom: i?.insuredFrom ?? p?.startDate ?? '0000-01-01',
      coverageTo: p?.endDate ?? '9999-12-31',
      excludedFrom: i?.excludedFrom,
      params: { maxPerMonth: DMS_DEFAULTS.fraudMaxClaimsPerMonth, priceExcessShare: DMS_DEFAULTS.fraudPriceExcessShare, daysBeforeExclusion: DMS_DEFAULTS.fraudDaysBeforeExclusion },
    });
    c.flags = found.map((f) => ({ id: id(), ...f }));
  }
}
