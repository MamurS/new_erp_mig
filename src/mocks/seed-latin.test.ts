/*
 * The seed names legal entities and people in Latin script (as in the state register and the ID card)
 * and issues ASCII document numbers; a saved mock database of an older seed version is discarded.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LEGAL_FORMS } from '@/shared/config/legalForms';
import { DOC_NUMBER_RE } from '@/shared/domain/numbering';
import { db, resetDb, type Db } from './db';
import { initMockDb } from './setup';
import { createSeed } from './seed';
import { clearSnapshot, loadSnapshot, MOCK_DB_VERSION } from './persist';

const CYRILLIC = /[Ѐ-ӿ]/;

initMockDb({ restore: false });
beforeEach(() => {
  resetDb();
});

function names(d: Db): [string, string][] {
  const out: [string, string][] = [];
  const add = (where: string, v: string | undefined) => {
    if (v !== undefined) out.push([where, v]);
  };
  for (const c of d.clients) {
    add('client', c.name);
    add('client.hrContact', c.hrContact.name);
    add('client.director', c.requisites?.director);
    add('client.manager', c.managerName);
  }
  for (const c of d.clinics) add('clinic', c.name);
  for (const a of d.assistances) add('assistance', a.name);
  for (const p of d.policies) add('policy.client', p.clientName);
  for (const s of d.staff) add('staff', s.fullName);
  for (const u of d.hrUsers) add('hr', u.fullName);
  for (const u of d.clinicUsers) add('clinicUser', u.fullName);
  for (const u of d.assistUsers) add('assistUser', u.fullName);
  for (const i of d.insured) {
    add('insured', i.fullName);
    add('insured.client', i.clientName);
  }
  for (const r of d.contractInsured.flatMap((c) => c.rows)) add('contractInsured', r.fullName);
  for (const r of d.policyChanges) add('policyChange', r.fullName);
  for (const c of d.claims) {
    add('claim.insured', c.insuredName);
    add('claim.client', c.clientName);
    add('claim.provider', c.providerName);
  }
  for (const k of d.kp) add('kp.client', k.clientName);
  for (const c of d.contracts) add('contract.client', c.clientName);
  for (const g of d.guarantees) add('guarantee.insured', g.insuredName);
  for (const b of d.bankPayments) add('bankPayment.payer', b.payerName);
  return out;
}

function numbers(d: Db): [string, string][] {
  const out: [string, string][] = [];
  const add = (where: string, v: string | undefined) => {
    if (v !== undefined) out.push([where, v]);
  };
  for (const p of d.policies) add('policy', p.number);
  for (const c of d.claims) add('claim', c.number);
  for (const i of d.invoices) add('invoice', i.number);
  for (const c of d.contracts) add('contract', c.number);
  for (const e of d.endorsements) add('endorsement', e.number);
  for (const k of d.kp) add('kp', k.number);
  for (const g of d.guarantees) add('guarantee', g.number);
  for (const x of d.deals) add('deal', x.number);
  for (const c of d.cases) add('case', c.number);
  for (const r of d.rebills) add('assistInvoice', r.number);
  for (const a of d.assistances) add('assistContract', a.contract.number);
  for (const i of d.insured) add('certificate', i.certificateNumber);
  for (const l of d.registries.flatMap((r) => r.lines)) {
    add('paymentOrder', l.payment?.orderNumber);
    add('registryLine.guarantee', l.guaranteeNumber);
  }
  for (const r of d.limitRequests) add('limitRequest.policy', r.policyNumber);
  for (const r of d.policyChanges) add('policyChange.policy', r.policyNumber);
  return out;
}

describe('Latin seed', () => {
  it('legal entities and people have Latin names', () => {
    const list = names(db());
    expect(list.length).toBeGreaterThan(1000);
    expect(list.filter(([, v]) => CYRILLIC.test(v))).toEqual([]);
    // Without the legal form and without quotes.
    for (const n of [...db().clients, ...db().clinics, ...db().assistances].map((x) => x.name)) expect(n).not.toMatch(/[«»"]|^(MChJ|AJ|OOO|LLC)\b/);
  });

  it('people are named «Surname Given Patronymic»', () => {
    const d = db();
    const people = [...d.staff, ...d.hrUsers, ...d.clinicUsers, ...d.assistUsers, ...d.insured].map((p) => p.fullName);
    for (const n of people) expect(n).toMatch(/^\S+ \S+ \S+(ovich|ovna|evich|evna)$/);
  });

  it('legal entities carry a legal form code; the clients use several forms, mostly LLC', () => {
    const d = db();
    for (const x of [...d.clients, ...d.clinics, ...d.assistances]) expect(LEGAL_FORMS).toContain(x.legalForm);
    const forms = d.clients.map((c) => c.legalForm);
    const count = (f: string) => forms.filter((x) => x === f).length;
    for (const f of LEGAL_FORMS.filter((x) => x !== 'llc')) expect(count('llc'), f).toBeGreaterThan(count(f));
    expect(new Set(forms).size).toBeGreaterThanOrEqual(4);
    const demo = d.clients.find((c) => c.name === 'Toshkent Agrologistika');
    expect(demo?.legalForm).toBe('llc');
  });

  it('every document number is ASCII', () => {
    const list = numbers(db());
    for (const kind of ['policy', 'claim', 'invoice', 'contract', 'endorsement', 'kp', 'guarantee', 'deal', 'case', 'assistInvoice', 'assistContract', 'certificate', 'paymentOrder']) {
      expect(list.some(([k]) => k === kind), kind).toBe(true);
    }
    expect(list.filter(([, v]) => CYRILLIC.test(v) || !DOC_NUMBER_RE.test(v))).toEqual([]);
    expect(list.filter(([, v]) => !/^[A-Za-z0-9/-]+$/.test(v))).toEqual([]);
  });

  it('the seed stays deterministic', () => {
    const a = numbers(db());
    const b = numbers(resetDb());
    expect(b).toEqual(a);
    expect(names(db()).slice(0, 200)).toEqual(names(createSeed()).slice(0, 200));
    resetDb();
  });

  it('the XSS probe data is still seeded with VITE_SEED_XSS', () => {
    const d = createSeed({ xss: true });
    expect(d.clients.some((c) => c.name === '<img src=x onerror=alert(1)>')).toBe(true);
    expect(d.insured.some((i) => i.position === '"><script>alert(1)</script>')).toBe(true);
    resetDb();
  });
});

describe('saved mock database', () => {
  beforeEach(() => clearSnapshot());

  it('a snapshot of another or no version is discarded', () => {
    const { sessions: _s, ...rest } = db();
    sessionStorage.setItem('mig.mock.db', JSON.stringify(rest));
    expect(loadSnapshot()).toBeNull();
    expect(sessionStorage.getItem('mig.mock.db')).toBeNull();
    sessionStorage.setItem('mig.mock.db', JSON.stringify({ ...rest, schemaVersion: MOCK_DB_VERSION - 1 }));
    expect(loadSnapshot()).toBeNull();
  });

  it('a snapshot of the current version is restored', () => {
    const { sessions: _s, ...rest } = db();
    sessionStorage.setItem('mig.mock.db', JSON.stringify({ ...rest, schemaVersion: MOCK_DB_VERSION }));
    const got = loadSnapshot();
    expect(got?.clients[0]?.name).toBe(rest.clients[0]?.name);
    expect(got).not.toHaveProperty('schemaVersion');
  });
});
