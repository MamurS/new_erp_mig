// @vitest-environment node
/*
 * Contract lifecycle on the mock server (LIFECYCLE_SPEC §17): the full path of a new client through
 * the API, signing by paper/scan and EDO, endorsements by formulas, claims settlement within authority,
 * appeals, reserves and fraud flags, and the new cells of the permission matrix as server answers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClaimDetail, ContractView, DealCard, DealView, EndorsementView, QuoteView, ReserveReport, SessionResponse } from '@mig/contracts/dto';
import type { Claim, KpDocument, MyClaim } from '@mig/contracts';
import { tm } from '@mig/i18n';
import { createMockServer } from './node';
import { lastSession, track, withSession } from './test-session';
import { db, resetDb } from './db';
import { currentReserve, refreshFlags } from '@mig/domain/services/settlement';
import { baseCtx } from './http';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

type Res<T> = { status: number; data: T };
async function call<T = Record<string, unknown>>(path: string, init: { method?: string; sid?: string; json?: unknown; text?: string; form?: FormData } = {}): Promise<Res<T>> {
  const headers = new Headers();
  withSession(headers, init.sid);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  if (init.text !== undefined) headers.set('Content-Type', 'text/csv');
  const res = track(await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.form ?? init.text ?? (init.json === undefined ? undefined : JSON.stringify(init.json)) }));
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { status: res.status, data: data as T };
}
async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status, email).toBe(200);
  return lastSession();
}
async function loginPhone(phone: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/phone', { method: 'POST', json: { phone } });
  const b = await call<SessionResponse>('/auth/phone/verify', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return lastSession();
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const scan = (side: 'mig' | 'client') => {
  const f = new FormData();
  f.set('side', side);
  f.set('file', new Blob([PNG], { type: 'image/png' }), 'scan.png');
  return f;
};
const iso = (ms: number) => new Date(ms + 5 * 3600_000).toISOString().slice(0, 10);
const today = () => iso(Date.now());

// 24 rows, 12 of them employees: at or above the minimal group size (minGroupSize, demo 10).
const CENSUS = ['gender,birthYear,relation,fullName,pinfl', ...Array.from({ length: 24 }, (_, k) => `${k % 2 ? 'f' : 'm'},${1975 + (k % 12) * 2},${k % 4 === 3 ? 'child' : k % 4 === 2 ? 'spouse' : 'employee'},Имя ${k},3000000000000${k}`)].join('\n');
// Appendix 2: ten employees, the minimal group size.
const LIST = ['fullName,birthDate,pinfl,phone,position,familyMembers', 'Новый Сотрудник Первый,15.03.1990,31503900000101,+998935550101,Инженер,1', 'Новая Сотрудница Вторая,01.07.1988,40107880000102,+998935550102,Бухгалтер,0', ...Array.from({ length: 8 }, (_, k) => `Сотрудник Номер ${['Три', 'Четыре', 'Пять', 'Шесть', 'Семь', 'Восемь', 'Девять', 'Десять'][k]},0${k + 1}.02.198${k},3010${k + 1}8${k}0000${k + 103},+99893555${String(k + 103).padStart(4, '0')},Инженер,0`)].join('\n');

const lead = {
  legalForm: 'llc',
  name: 'Тестовый Лид Сервис',
  inn: '301234567',
  requisites: { bank: 'АКБ «Тест»', account: '20208000100000000001', mfo: '00001', director: 'Директоров Директор Директорович', directorBasis: 'Устав' },
  contactName: 'Контактова Контакта',
  contactPhone: '+998901230000',
  contactEmail: 'hr@test-lead.uz',
  estimatedHeadcount: 12,
  expectedStart: today(),
};

/** Lead → census → quote above the author's discount → approval → KP → accepted → contract with a changed clause → legal. */
async function toApprovedContract(): Promise<{ sales: string; head: string; hr: string; contract: ContractView; dealId: string }> {
  const sales = await login('sales@demo.mig.uz');
  const deal = await call<DealView>('/leads', { method: 'POST', sid: sales, json: lead });
  expect(deal.status).toBe(201);
  const census = await call<{ census: { rows: unknown[] }; dropped: string[] }>(`/deals/${deal.data.id}/census`, { method: 'POST', sid: sales, text: CENSUS });
  expect(census.status).toBe(200);
  expect(census.data.dropped).toEqual(['fullName', 'pinfl']);
  expect(JSON.stringify(db().censuses.at(-1))).not.toContain('Имя 0');

  const uw = await login('underwriter@demo.mig.uz');
  expect((await call('/quotes', { method: 'POST', sid: sales, json: { dealId: deal.data.id, program: 'standard' } })).status).toBe(403);
  const q = await call<QuoteView>('/quotes', { method: 'POST', sid: uw, json: { dealId: deal.data.id, program: 'standard', adjustments: [{ label: 'Скидка', pct: -0.15, comment: 'Переход от конкурента' }] } });
  expect(q.status).toBe(201);
  expect(tm(q.data.authorityProblem)).toMatch(/выше ваших полномочий/);
  // A KP cannot go out on an unapproved quote.
  expect((await call(`/deals/${deal.data.id}/kp`, { method: 'POST', sid: sales })).status).toBe(409);
  const submitted = await call<QuoteView>(`/quotes/${q.data.id}/submit`, { method: 'POST', sid: uw });
  expect(submitted.data.status).toBe('pending_approval');
  expect((await call(`/quotes/${q.data.id}/approve`, { method: 'POST', sid: uw, json: {} })).status).toBe(403); // author
  expect((await call(`/quotes/${q.data.id}/approve`, { method: 'POST', sid: sales, json: {} })).status).toBe(403); // not an underwriter
  const head = await login('underwriter-head@demo.mig.uz');
  const approved = await call<QuoteView>(`/quotes/${q.data.id}/approve`, { method: 'POST', sid: head, json: { comment: 'Согласовано' } });
  expect(approved.data.status).toBe('approved');

  const kp = await call<KpDocument>(`/deals/${deal.data.id}/kp`, { method: 'POST', sid: sales });
  expect(kp.status).toBe(201);
  expect(kp.data.params.premiumEmployee).toBe(approved.data.premiumEmployee);
  const hr = await login('hr@test-lead.uz');
  expect((await call(`/kp/${kp.data.id}/accept`, { method: 'POST', sid: await login('hr@demo-client.uz') })).status).toBe(404);
  expect((await call<KpDocument>(`/kp/${kp.data.id}/accept`, { method: 'POST', sid: hr })).data.status).toBe('accepted');
  expect((await call<DealCard>(`/deals/${deal.data.id}`, { sid: sales })).data.stage).toBe('kp_accepted');

  const c = await call<ContractView>('/contracts', { method: 'POST', sid: sales, json: { dealId: deal.data.id } });
  expect(c.status).toBe(201);
  expect((await call(`/contracts/${c.data.id}/insured-list`, { method: 'POST', sid: sales, text: LIST })).status).toBe(200);
  const edited = await call<ContractView>(`/contracts/${c.data.id}`, { method: 'PATCH', sid: sales, json: { clauseOverrides: [{ clauseId: '4.3', text: 'Новая формулировка исключений для этого клиента' }] } });
  expect(edited.data.clauseOverrides).toHaveLength(1);
  expect(edited.data.clauseOverrides[0]!.original).toBe('[Текст пункта 4.3 будет предоставлен МИГ]');
  const sub = await call<ContractView>(`/contracts/${c.data.id}/submit-legal`, { method: 'POST', sid: sales });
  expect(sub.data.status).toBe('legal_review');
  expect((await call(`/contracts/${c.data.id}/legal-approve`, { method: 'POST', sid: sales, json: {} })).status).toBe(403);
  const legal = await login('legal@demo.mig.uz');
  const ok = await call<ContractView>(`/contracts/${c.data.id}/legal-approve`, { method: 'POST', sid: legal, json: {} });
  expect(ok.data.status).toBe('approved');
  return { sales, head, hr, contract: ok.data, dealId: deal.data.id };
}

describe('full path of a new client (§17 e2e 1 on the API)', () => {
  it('lead → quote → KP → contract → E-IMZO by both sides → payment → policy and certificates', async () => {
    const { sales, head, hr, contract, dealId } = await toApprovedContract();
    expect((await call(`/contracts/${contract.id}/send`, { method: 'POST', sid: sales })).status).toBe(200);
    const eimzo = { method: 'eimzo', certificateSerial: 'ABCDEF0123', password: 'any' };
    // Only a signatory signs for MIG.
    expect((await call(`/contracts/${contract.id}/sign`, { method: 'POST', sid: sales, json: { side: 'mig', ...eimzo } })).status).toBe(403);
    expect((await call(`/contracts/${contract.id}/sign`, { method: 'POST', sid: head, json: { side: 'mig', ...eimzo } })).status).toBe(200);
    expect((await call(`/contracts/${contract.id}/sign`, { method: 'POST', sid: head, json: { side: 'client', ...eimzo } })).status).toBe(403);
    const signed = await call<ContractView>(`/contracts/${contract.id}/sign`, { method: 'POST', sid: hr, json: { side: 'client', ...eimzo } });
    expect(signed.data.status).toBe('signed');
    expect(signed.data.signing.paperOriginal.required).toBe(false);
    expect(signed.data.signing.client?.certificate?.serial).toBe('ABCDEF0123');
    // after_first_payment by default: in force once the accountant records the payment.
    expect(signed.data.invoices).toHaveLength(1);
    const acc = await login('accountant@demo.mig.uz');
    const inv = signed.data.invoices[0]!;
    expect((await call('/payments', { method: 'POST', sid: acc, json: { invoiceId: inv.id, amount: inv.amount, paidAt: today() } })).status).toBe(201);
    expect((await call<ContractView>(`/contracts/${contract.id}`, { sid: sales })).data.status).toBe('active');
    const card = await call<DealCard>(`/deals/${dealId}`, { sid: sales });
    expect(card.data.stage).toBe('active');
    const policy = db().policies.find((p) => p.contractId === contract.id)!;
    expect(policy.status).toBe('active');
    const people = db().insured.filter((i) => i.policyId === policy.id);
    expect(people).toHaveLength(10);
    expect(people[0]!.certificateNumber).toMatch(/^SERT-\d{4}-\d{6}-0001$/);
    expect(people[1]!.certificateNumber).toMatch(/-0002$/);
    expect(db().smsOutbox.filter((s) => people.some((p) => p.id === s.insuredId))).toHaveLength(10);
    const certs = await call<{ certificateNumber: string }[]>(`/policies/${policy.id}/certificates`, { sid: hr });
    expect(certs.data).toHaveLength(10);
    expect((await call(`/policies/${policy.id}/certificates`, { sid: await login('hr@demo-client.uz') })).status).toBe(404);
    const insured = await loginPhone('+998935550101');
    const mine = await call<{ certificateNumber: string; fullName: string }>('/me/certificate', { sid: insured });
    expect(mine.data.certificateNumber).toBe(people[0]!.certificateNumber);
  });

  it('after_first_payment: signed but not in force until the accountant records the first installment', async () => {
    const { sales, head, hr, contract } = await toApprovedContract();
    db().contracts.find((x) => x.id === contract.id)!.status = 'draft';
    const patched = await call<ContractView>(`/contracts/${contract.id}`, { method: 'PATCH', sid: sales, json: { params: { activationRule: 'after_first_payment', paymentFrequency: 'quarterly' } } });
    expect(patched.data.params.paymentSchedule).toHaveLength(4);
    expect(patched.data.params.paymentSchedule.reduce((s, x) => s + x.amount, 0)).toBe(patched.data.params.total);
    expect((await call(`/contracts/${contract.id}/submit-legal`, { method: 'POST', sid: sales })).status).toBe(200);
    await call(`/contracts/${contract.id}/legal-approve`, { method: 'POST', sid: await login('legal@demo.mig.uz'), json: {} });
    await call(`/contracts/${contract.id}/send`, { method: 'POST', sid: sales });
    const eimzo = { method: 'eimzo', certificateSerial: 'ABCDEF0123', password: 'x' };
    await call(`/contracts/${contract.id}/sign`, { method: 'POST', sid: head, json: { side: 'mig', ...eimzo } });
    const signed = await call<ContractView>(`/contracts/${contract.id}/sign`, { method: 'POST', sid: hr, json: { side: 'client', ...eimzo } });
    expect(signed.data.status).toBe('signed');
    const acc = await login('accountant@demo.mig.uz');
    const first = signed.data.invoices.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0]!;
    expect((await call('/payments', { method: 'POST', sid: sales, json: { invoiceId: first.id, amount: 1000, paidAt: today() } })).status).toBe(403);
    expect((await call('/payments', { method: 'POST', sid: acc, json: { invoiceId: first.id, amount: 1000, paidAt: today() } })).status).toBe(201);
    expect((await call<ContractView>(`/contracts/${contract.id}`, { sid: sales })).data.status).toBe('signed'); // partial
    const csv = `doc_number,date,amount,inn,purpose\n101,${today()},${first.amount - 1000},${lead.inn},Оплата по договору\n102,${today()},5000,999999999,Чужой платёж`;
    const imported = await call<{ matched: number; queued: number; unmatched: unknown[]; activated: number }>('/payments/import-1c', { method: 'POST', sid: acc, text: csv });
    // The remainder of the first installment matches by INN and exact amount; the stranger goes to manual allocation.
    expect(imported.data).toMatchObject({ matched: 1, queued: 1, activated: 1 });
    expect(imported.data.unmatched).toHaveLength(0);
    expect((await call<ContractView>(`/contracts/${contract.id}`, { sid: sales })).data.status).toBe('active');
  });
});

describe('signing methods (§8)', () => {
  it('paper and scan: «Подписано МИГ», the client scan counts only after verification, the original is required', async () => {
    const { sales, head, contract } = await toApprovedContract();
    await call(`/contracts/${contract.id}/send`, { method: 'POST', sid: sales });
    expect((await call(`/contracts/${contract.id}/sign`, { method: 'POST', sid: head, json: { side: 'mig', method: 'paper' } })).status).toBe(200);
    expect((await call(`/contracts/${contract.id}/originals`, { method: 'POST', sid: sales, json: { migCopySentAt: today() } })).status).toBe(200);
    const up = await call<ContractView>(`/contracts/${contract.id}/scan`, { method: 'POST', sid: sales, form: scan('client') });
    expect(up.status).toBe(200);
    expect(up.data.signing.client).toBeUndefined();
    expect(up.data.status).toBe('signing');
    expect((await call(`/contracts/${contract.id}/scan/verify`, { method: 'POST', sid: await login('accountant@demo.mig.uz'), json: { side: 'client' } })).status).toBe(403);
    const v = await call<ContractView>(`/contracts/${contract.id}/scan/verify`, { method: 'POST', sid: await login('legal@demo.mig.uz'), json: { side: 'client' } });
    expect(v.data.signing.client?.method).toBe('scan');
    expect(v.data.signing.paperOriginal.required).toBe(true);
    expect(['signed', 'active']).toContain(v.data.status);
    const got = await call<ContractView>(`/contracts/${contract.id}/originals`, { method: 'POST', sid: sales, json: { clientOriginalReceivedAt: today() } });
    expect(got.data.signing.paperOriginal.clientOriginalReceivedAt).toBe(today());
    expect(got.data.signing.paperOriginal.receivedByName).toBe('Karimov Aziz Shuhratovich');
  });

  it('EDO: sending signs for MIG, the client signature arrives from the operator, the contract is signed', async () => {
    const { sales, head, contract } = await toApprovedContract();
    expect((await call(`/contracts/${contract.id}/edo`, { method: 'POST', sid: sales, json: { provider: 'Didox' } })).status).toBe(403);
    const sent = await call<ContractView>(`/contracts/${contract.id}/edo`, { method: 'POST', sid: head, json: { provider: 'Didox' } });
    expect(sent.data.signing.edoPending?.provider).toBe('Didox');
    expect(sent.data.signing.client).toBeUndefined();
    // The operator's event comes 3 seconds later: move the clock of the pending send back.
    const row = db().contracts.find((x) => x.id === contract.id)!;
    row.signing.edoPending!.sentAt = new Date(Date.now() - 4000).toISOString();
    const after = await call<ContractView>(`/contracts/${contract.id}`, { sid: sales });
    expect(after.data.signing.client?.method).toBe('edo');
    expect(after.data.signing.client?.edoProvider).toBe('Didox');
    expect(['signed', 'active']).toContain(after.data.status);
  });
});

describe('endorsements (§11)', () => {
  it('HR adds and excludes; the monthly endorsement has formula lines, is signed by scan and creates an invoice', async () => {
    const hr = await login('hr@demo-client.uz');
    const companyId = db().hrUsers[0]!.companyId;
    const contract = db().contracts.find((c) => c.clientId === companyId && c.status === 'active')!;
    const tomorrow = iso(Date.now() + 86_400_000);
    const add = await call<{ id: string }>('/hr/employees', { method: 'POST', sid: hr, json: { fullName: 'Добавлен Новый Сотрудник', birthDate: '01.02.1993', pinfl: '30102930000555', phone: '901110055', position: 'Аналитик', startDate: tomorrow } });
    const leaver = db().insured.find((i) => i.clientId === companyId && i.status === 'active' && i.phone !== '+998900000001' && !db().policyChanges.some((c) => c.insuredId === i.id))!;
    await call(`/hr/employees/${leaver.id}`, { method: 'DELETE', sid: hr, json: { excludeFrom: tomorrow } });
    const uw = await login('underwriter@demo.mig.uz');
    const ids = db().policyChanges.filter((c) => c.status === 'pending' && c.clientId === companyId).map((c) => c.id);
    expect(ids).toContain(add.data.id);
    expect((await call('/policy-changes/decision', { method: 'POST', sid: uw, json: { ids, decision: 'approve' } })).status).toBe(200);
    const newcomer = db().insured.find((i) => i.fullName === 'Добавлен Новый Сотрудник')!;
    expect(newcomer.insuredFrom).toBe(tomorrow); // coverage from the HR request date
    const sales = await login('sales@demo.mig.uz');
    const formed = await call<EndorsementView[]>('/endorsements', { method: 'POST', sid: sales, json: { contractId: contract.id } });
    expect(formed.status).toBe(201);
    const e = formed.data[0]!;
    const addLine = e.lines.find((l) => l.description.startsWith('Включение: Добавлен'))!;
    const days = addLine.days;
    expect(addLine.amount).toBe(Math.round((contract.params.premiumEmployee * days) / (Math.round((Date.parse(contract.params.endDate) - Date.parse(contract.params.startDate)) / 86_400_000) + 1)));
    expect(tm(addLine.formula)).toMatch(/× \d+ \/ \d+ =/);
    const exLine = e.lines.find((l) => l.description.includes(leaver.fullName.split(' ')[0]!))!;
    expect(exLine.amount).toBeLessThanOrEqual(0);
    expect(tm(exLine.formula)).toMatch(/выплаты/); // pro_rata_minus_claims by default
    await call(`/endorsements/${e.id}/submit-legal`, { method: 'POST', sid: sales });
    await call(`/endorsements/${e.id}/send`, { method: 'POST', sid: sales });
    expect((await call(`/endorsements/${e.id}/scan`, { method: 'POST', sid: hr, form: scan('client') })).status).toBe(200);
    const head = await login('underwriter-head@demo.mig.uz');
    await call(`/endorsements/${e.id}/sign`, { method: 'POST', sid: head, json: { side: 'mig', method: 'eimzo', certificateSerial: 'ABCDEF0123', password: 'x' } });
    const signed = await call<EndorsementView>(`/endorsements/${e.id}/scan/verify`, { method: 'POST', sid: sales, json: { side: 'client' } });
    expect(signed.data.status).toBe('signed');
    if (signed.data.total > 0) expect(db().invoices.some((i) => i.endorsementId === e.id && i.amount === signed.data.total)).toBe(true);
    else expect(signed.data.refundDocument).toBeTruthy();
    expect(db().changeRequests.filter((r) => e.changeRequestIds.includes(r.id)).every((r) => r.status === 'included')).toBe(true);
  });

  it('termination: the endorsement refunds by the rule; after signing the policy is closed and people are excluded', async () => {
    const sales = await login('sales@demo.mig.uz');
    const companyId = db().hrUsers[0]!.companyId;
    const contract = db().contracts.find((c) => c.clientId === companyId && c.status === 'active')!;
    const date = iso(Date.now() + 10 * 86_400_000);
    const t = await call<EndorsementView>(`/contracts/${contract.id}/terminate`, { method: 'POST', sid: sales, json: { date, reason: 'Клиент закрывает филиал' } });
    expect(t.status).toBe(201);
    expect(t.data.kind).toBe('termination');
    expect(t.data.total).toBeLessThanOrEqual(0);
    await call(`/endorsements/${t.data.id}/submit-legal`, { method: 'POST', sid: sales });
    const head = await login('underwriter-head@demo.mig.uz');
    await call(`/endorsements/${t.data.id}/sign`, { method: 'POST', sid: head, json: { side: 'mig', method: 'paper' } });
    await call(`/endorsements/${t.data.id}/send`, { method: 'POST', sid: sales });
    await call(`/endorsements/${t.data.id}/originals`, { method: 'POST', sid: sales, json: { clientOriginalReceivedAt: today() } });
    const policy = db().policies.find((p) => p.contractId === contract.id)!;
    expect(policy.status).toBe('cancelled');
    expect(db().contracts.find((c) => c.id === contract.id)!.status).toBe('terminated');
    expect(db().insured.filter((i) => i.policyId === policy.id).every((i) => i.status === 'excluded' && i.excludedFrom)).toBe(true);
  });
});

describe('claims settlement (§13)', () => {
  it('a decision above claims@ goes to claims-head@; a refusal needs a clause; the insured sees the reason and appeals', async () => {
    const officer = await login('claims@demo.mig.uz');
    const c = db().claims.find((x) => x.status === 'review' && x.amountClaimed > 5_000_000 && !x.pendingDecision && x.handledBy === 'mig')!;
    const noClause = await call(`/claims/${c.id}/decide`, { method: 'POST', sid: officer, json: { kind: 'reject', amount: 0, reason: 'Не покрывается программой' } });
    expect(noClause.status).toBe(422);
    const r = await call<ClaimDetail>(`/claims/${c.id}/decide`, { method: 'POST', sid: officer, json: { kind: 'reject', amount: 0, clauseRef: 'contract:4.3', reason: 'Услуга входит в исключения программы' } });
    expect(r.data.pendingDecision?.required).toBe(c.amountClaimed);
    expect(r.data.status).toBe('review');
    expect((await call(`/claims/${c.id}/decision/approve`, { method: 'POST', sid: officer })).status).toBe(403);
    const head = await login('claims-head@demo.mig.uz');
    const done = await call<ClaimDetail>(`/claims/${c.id}/decision/approve`, { method: 'POST', sid: head });
    expect(done.data.status).toBe('rejected');
    expect(done.data.decision?.approvedByName).toBe('Saidova Lola Akmalovna');
    expect(currentReserve(db().claims.find((x) => x.id === c.id)!)).toBe(0);
    // The insured person sees the reason in plain words with the clause, and appeals.
    const owner = db().insured.find((i) => i.id === c.insuredId)!;
    owner.phone = '+998935559999';
    owner.status = 'active';
    const me = await loginPhone('+998935559999');
    const mine = await call<MyClaim>(`/me/claims/${c.id}`, { sid: me });
    expect(mine.data).toMatchObject({ status: 'rejected', rejectionReason: 'Услуга входит в исключения программы', canAppeal: true });
    expect(mine.data.clauseRef).toMatch(/^п\. 4\.3 договора/);
    expect((await call(`/me/claims/${c.id}/appeal`, { method: 'POST', sid: me, json: { text: 'Врач назначил по показаниям' } })).status).toBe(200);
    const tab = await call<{ items: Claim[] }>('/claims?tab=appeals&pageSize=100', { sid: officer });
    expect(tab.data.items.some((x) => x.id === c.id)).toBe(true);
    expect((await call(`/me/claims/${c.id}/letter`, { sid: me })).status).toBe(200);
  });

  it('a doctor gives an opinion, not a decision; the officer decides within authority; the reserve follows', async () => {
    const officer = await login('claims@demo.mig.uz');
    const c = db().claims.find((x) => x.status === 'review' && x.amountClaimed < 3_000_000 && !x.pendingDecision)!;
    const req = await call<ClaimDetail>(`/claims/${c.id}/request-opinion`, { method: 'POST', sid: officer, json: { question: 'Показано ли?' } });
    expect(req.data.status).toBe('medical_review');
    const doc = await login('doctor@demo.mig.uz');
    expect((await call(`/claims/${c.id}/decide`, { method: 'POST', sid: doc, json: { kind: 'approve', amount: c.amountClaimed } })).status).toBe(403);
    const op = await call<ClaimDetail>(`/claims/${c.id}/opinion`, { method: 'POST', sid: doc, json: { text: 'Назначение обосновано, объём соответствует', recommendation: 'partial' } });
    expect(op.data.status).toBe('review');
    const part = Math.round(c.amountClaimed / 2 / 1000) * 1000;
    const decided = await call<ClaimDetail>(`/claims/${c.id}/decide`, { method: 'POST', sid: officer, json: { kind: 'partial', amount: part, clauseRef: 'contract:8.5', reason: 'Часть услуг вне программы' } });
    expect(decided.data.status).toBe('approved');
    expect(decided.data.amountApproved).toBe(part);
    expect(decided.data.reserve).toBe(part);
    const changed = await call<ClaimDetail>(`/claims/${c.id}/reserve`, { method: 'PATCH', sid: officer, json: { amount: part + 1000, reason: 'Ожидается доплата' } });
    expect(changed.data.reserve).toBe(part + 1000);
    expect(changed.data.reserveHistory?.at(-1)).toMatchObject({ byName: 'Hasanov Bobur Ilhomovich', to: part + 1000 });
  });

  it('the reserve report on a date equals the sum of open reserves', async () => {
    const officer = await login('claims@demo.mig.uz');
    const r = await call<ReserveReport>(`/reports/reserves?date=${today()}`, { sid: officer });
    const sum = db().claims.reduce((s, c) => s + currentReserve(c), 0);
    expect(r.data.total).toBe(sum);
    expect(r.data.byClient.reduce((s, x) => s + x.reserve, 0)).toBe(sum);
    expect(r.data.byCategory.reduce((s, x) => s + x.claims, 0)).toBe(r.data.claims);
    const csv = await call<string>('/reports/claims-register', { sid: officer });
    expect(csv.status).toBe(200);
    expect(csv.data).not.toMatch(/\+998\d{9}/);
    expect(csv.data).not.toMatch(/\b[3-6]\d{13}\b/);
  });

  it('the same receipt twice gets the duplicate flag; the flag is dismissed only with a comment', async () => {
    const me = await loginPhone('+998900000001');
    const send = () => {
      const f = new FormData();
      f.set('category', 'medicines');
      f.set('amount', '187000');
      f.set('serviceDate', today());
      f.set('providerName', 'Аптека «Тест Фарм»');
      f.set('files', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: 'image/jpeg' }), 'r.jpg');
      return call<{ id: string }>('/me/claims', { method: 'POST', sid: me, form: f });
    };
    const first = await send();
    const second = await send();
    expect(second.status).toBe(200);
    const row = db().claims.find((c) => c.id === second.data.id)!;
    const flag = row.flags!.find((f) => f.code === 'duplicate_receipt')!;
    expect(flag).toBeTruthy();
    expect(row.handledBy).toBe('mig');
    const officer = await login('claims@demo.mig.uz');
    expect((await call(`/claims/${row.id}/flags/${flag.id}/dismiss`, { method: 'POST', sid: officer, json: { comment: '' } })).status).toBe(422);
    const ok = await call<ClaimDetail>(`/claims/${row.id}/flags/${flag.id}/dismiss`, { method: 'POST', sid: officer, json: { comment: 'Два разных чека, проверено по фото' } });
    expect(ok.data.flags?.find((f) => f.id === flag.id)?.dismissed?.comment).toBe('Два разных чека, проверено по фото');
    expect(first.status).toBe(200);
  });
});

describe('duplicate receipts by fiscal data', () => {
  const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5]);
  const send = (sid: string, amount: string) => {
    const f = new FormData();
    f.set('category', 'medicines');
    f.set('amount', amount);
    f.set('serviceDate', today());
    f.set('providerName', 'Аптека');
    f.set('files', new Blob([photo], { type: 'image/jpeg' }), 'r.jpg');
    return call<{ id: string }>('/me/claims', { method: 'POST', sid, form: f });
  };

  it('recognition returns fiscal data; the same receipt from another insured person is flagged; the server ignores fiscal data from the client', async () => {
    const me = await loginPhone('+998900000001');
    const f = new FormData();
    f.set('file', new Blob([photo], { type: 'image/jpeg' }), 'r.jpg');
    const rec = await call<{ amount: number; fiscal?: { fiscalNumber?: string; issuedAt: string; amount: number; sellerInn: string } }>('/me/claims/recognize', { method: 'POST', sid: me, form: f });
    expect(rec.status).toBe(200);
    expect(rec.data.fiscal).toMatchObject({ amount: rec.data.amount, sellerInn: expect.stringMatching(/^\d{9}$/), issuedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) });

    const first = await send(me, '150000');
    expect(first.status).toBe(200);
    expect(db().claims.find((c) => c.id === first.data.id)!.flags?.some((x) => x.code === 'duplicate_receipt')).toBe(false);
    expect(db().claims.find((c) => c.id === first.data.id)!.receiptFiscal).toEqual(rec.data.fiscal);

    // A colleague sends the same receipt with another amount (and a forged fiscal number in the form, which is ignored).
    const other = db().insured.find((i) => i.appStatus === 'active' && i.phone !== '+998900000001' && i.status === 'active')!;
    const sid = await loginPhone(other.phone);
    const g = new FormData();
    g.set('category', 'medicines');
    g.set('amount', '90000');
    g.set('serviceDate', today());
    g.set('providerName', 'Другая аптека');
    g.set('fiscalNumber', '100000000000');
    g.set('files', new Blob([photo], { type: 'image/jpeg' }), 'r.jpg');
    const second = await call<{ id: string }>('/me/claims', { method: 'POST', sid, form: g });
    expect(second.status).toBe(200);
    const row = db().claims.find((c) => c.id === second.data.id)!;
    expect(row.receiptFiscal).toEqual(rec.data.fiscal);
    const flag = row.flags!.find((x) => x.code === 'duplicate_receipt')!;
    const firstNumber = db().claims.find((c) => c.id === first.data.id)!.number;
    expect(tm(flag.message)).toContain(firstNumber);
    expect(tm(flag.message)).toContain('другого застрахованного');
    expect(tm(flag.message)).toContain('изображение чека тоже совпадает');

    // The staff card shows the fiscal data; the insured person never sees the flags.
    const officer = await login('claims@demo.mig.uz');
    const card = await call<ClaimDetail>(`/claims/${row.id}`, { sid: officer });
    expect(card.data.receiptFiscal).toEqual(rec.data.fiscal);
    const mine = await call<Record<string, unknown>>(`/me/claims/${row.id}`, { sid });
    expect(mine.data.flags).toBeUndefined();
  });

  it('a different photo of the same receipt is caught by the fiscal number alone', async () => {
    const me = await loginPhone('+998900000001');
    const first = await send(me, '150000');
    const original = db().claims.find((c) => c.id === first.data.id)!;
    // Another photo: another image hash, but the recognizer read the same fiscal data.
    const other = db().claims.find((c) => c.source === 'app' && c.insuredId !== original.insuredId && c.receiptFiscal?.fiscalNumber)!;
    other.receiptFiscal = { ...original.receiptFiscal!, fiscalNumber: original.receiptFiscal!.fiscalNumber ?? '412345678901' };
    original.receiptFiscal = { ...other.receiptFiscal };
    original.flags = [];
    const flags = await refreshFlags(baseCtx(), original);
    expect(tm(flags.find((x) => x.code === 'duplicate_receipt')?.message)).toBe(`Фискальный номер чека совпадает с чеком обращения ${other.number} другого застрахованного`);
  });
});

describe('rights on the server (§14, e2e 8)', () => {
  it('sales cannot approve a quote or sign for MIG; the lawyer sees no claims; authority changes need a second person', async () => {
    const sales = await login('sales@demo.mig.uz');
    const pending = db().quotes.find((q) => q.status === 'pending_approval')!;
    expect((await call(`/quotes/${pending.id}/approve`, { method: 'POST', sid: sales, json: {} })).status).toBe(403);
    const legal = await login('legal@demo.mig.uz');
    expect((await call('/claims', { sid: legal })).status).toBe(403);
    expect((await call(`/claims/${db().claims[0]!.id}`, { sid: legal })).status).toBe(403);
    const signing = db().contracts.find((c) => c.status === 'signing')!;
    expect((await call(`/contracts/${signing.id}/sign`, { method: 'POST', sid: sales, json: { side: 'mig', method: 'paper' } })).status).toBe(403);

    const admin = await login('admin@demo.mig.uz');
    const target = db().staff.find((s) => s.email === 'sales@demo.mig.uz')!;
    const prop = await call<{ id: string }>(`/admin/users/${target.id}/authority`, { method: 'POST', sid: admin, json: { authority: {}, signatory: { basis: 'Доверенность № 77 от 01.10.2026' }, reason: 'Подписывает договоры филиала' } });
    expect(prop.status).toBe(201);
    expect((await call(`/admin/authority-changes/${prop.data.id}/approve`, { method: 'POST', sid: admin })).status).toBe(403);
    expect((await call(`/admin/authority-changes/${prop.data.id}/approve`, { method: 'POST', sid: sales })).status).toBe(403);
    const uw = await login('underwriter@demo.mig.uz');
    expect((await call(`/admin/authority-changes/${prop.data.id}/approve`, { method: 'POST', sid: uw })).status).toBe(403);
    const admin2 = await login('admin2@demo.mig.uz');
    expect((await call(`/admin/authority-changes/${prop.data.id}/approve`, { method: 'POST', sid: admin2 })).status).toBe(200);
    expect(target.signatory?.basis).toBe('Доверенность № 77 от 01.10.2026');
    expect(db().audit.some((e) => e.action === 'authority_changed' && e.targetLabel?.includes('подписант'))).toBe(true);
    // The new right works at the next request.
    expect((await call(`/contracts/${signing.id}/sign`, { method: 'POST', sid: sales, json: { side: 'mig', method: 'paper' } })).status).toBe(409); // MIG already signed
  });
});
