/*
 * The seed names legal entities and people in Latin script (as in the state register and the ID card)
 * and issues ASCII document numbers; a saved mock database of an older seed version is discarded.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LEGAL_FORMS } from '@mig/domain/config/legalForms';
import { DOC_NUMBER_RE } from '@mig/domain/numbering';
import { db, resetDb, type Db } from './db';
import { initMockDb } from './setup';
import { createMockSeed as createSeed } from './seed-db';
import { clearSnapshot, loadSnapshot, MOCK_DB_VERSION } from './persist';

const CYRILLIC = /[Ѐ-ӿ]/;
/** The mock server's own storage (persist.ts emulates the server database there). */
// eslint-disable-next-line no-restricted-properties -- the test plants a saved server database, like persist.ts does
const store = (): Storage => window.sessionStorage;

initMockDb({ restore: false });
beforeEach(() => {
  resetDb();
});

/** Fields with a name of a legal entity or a person, wherever they are in the database. */
const NAME_KEY = /^(name|director|owner|signer)$|[a-z]Name$/;
/** Fields with a document number. */
const NUMBER_KEY = /^(number|refundDocument)$|[a-z]Number$/;
/**
 * Text data that may stay in Russian: names of medical services (catalogue and price lists) and the
 * labels of system actors in histories (not people).
 */
const TEXT_PATHS = [/\.serviceName$/, /^db\.(priceLists|clinicContracts)\[\]\.(items|priceList)\[\]\.name$/];
const SYSTEM_ACTORS = new Set(['Оператор', 'Система', 'Неизвестный', 'Бухгалтер', 'Застрахованный (приложение)', 'Клиника (счёт)']);

interface Field {
  path: string;
  key: string;
  value: string;
}

/** Every string field of the database whose key is a name or a number field, with its path. */
function fields(d: Db): { names: Field[]; numbers: Field[] } {
  const names: Field[] = [];
  const numbers: Field[] = [];
  const walk = (v: unknown, path: string, key: string): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, `${path}[]`, key);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, k);
    } else if (typeof v === 'string' && v !== '') {
      if (NUMBER_KEY.test(key)) numbers.push({ path, key, value: v });
      else if (NAME_KEY.test(key) && !TEXT_PATHS.some((re) => re.test(path)) && !SYSTEM_ACTORS.has(v)) names.push({ path, key, value: v });
    }
  };
  walk(d, 'db', '');
  return { names, numbers };
}

const paths = (list: Field[]) => new Set(list.map((f) => f.path));

describe('Latin seed', () => {
  it('no name of a legal entity or a person in the whole database has Cyrillic letters', () => {
    const { names } = fields(db());
    // The walk reaches the collections it must cover.
    for (const p of ['db.clients[].name', 'db.clinics[].name', 'db.assistances[].name', 'db.staff[].fullName', 'db.hrUsers[].fullName', 'db.insured[].fullName', 'db.clinicUsers[].fullName', 'db.assistUsers[].fullName', 'db.claims[].insuredName', 'db.bankPayments[].payerName', 'db.clients[].requisites.director']) {
      expect(paths(names), p).toContain(p);
    }
    expect(names.filter((f) => CYRILLIC.test(f.value))).toEqual([]);
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

  it('every document number in the whole database is ASCII', () => {
    const { numbers } = fields(db());
    for (const p of ['db.policies[].number', 'db.claims[].number', 'db.invoices[].number', 'db.contracts[].number', 'db.endorsements[].number', 'db.kp[].number', 'db.guarantees[].number', 'db.deals[].number', 'db.cases[].number', 'db.rebills[].number', 'db.assistances[].contract.number', 'db.insured[].certificateNumber', 'db.registries[].lines[].payment.orderNumber']) {
      expect(paths(numbers), p).toContain(p);
    }
    expect(numbers.filter((f) => CYRILLIC.test(f.value) || !DOC_NUMBER_RE.test(f.value) || !/^[A-Za-z0-9/-]+$/.test(f.value))).toEqual([]);
  });

  it('the hand-written lifecycle demo: Toshkent Agrologistika LLC, contract DMS-D-2026-000123 and its endorsements', () => {
    const d = db();
    const client = d.clients.find((c) => c.name === 'Toshkent Agrologistika');
    expect(client?.legalForm).toBe('llc');
    const contracts = d.contracts.filter((c) => c.clientId === client?.id);
    expect(contracts.map((c) => c.number)).toContain('DMS-D-2026-000123');
    const contract = contracts.find((c) => c.number === 'DMS-D-2026-000123')!;
    expect(contract.clientName).toBe('Toshkent Agrologistika');
    const endorsements = d.endorsements.filter((e) => e.contractId === contract.id);
    expect(endorsements.length).toBeGreaterThan(0);
    for (const e of endorsements) expect(e.number).toMatch(/^DS-\d+\/DMS-D-2026-000123$/);
    expect(client?.requisites?.director).not.toMatch(CYRILLIC);
    const members = d.insured.filter((i) => i.clientId === client?.id);
    expect(members.length).toBeGreaterThan(0);
    for (const m of members) expect(m.fullName).not.toMatch(CYRILLIC);
  });
  it('the seed stays deterministic', () => {
    const a = fields(db());
    const b = fields(resetDb());
    expect(b).toEqual(a);
    expect(fields(createSeed()).names.slice(0, 500)).toEqual(a.names.slice(0, 500));
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
    store().setItem('mig.mock.db', JSON.stringify(rest));
    expect(loadSnapshot()).toBeNull();
    expect(store().getItem('mig.mock.db')).toBeNull();
    store().setItem('mig.mock.db', JSON.stringify({ ...rest, schemaVersion: MOCK_DB_VERSION - 1 }));
    expect(loadSnapshot()).toBeNull();
  });

  it('on start, a saved state of an older seed is replaced by the fresh seed automatically', () => {
    const { sessions: _s, ...rest } = db();
    const old = { ...rest, clients: rest.clients.map((c, k) => (k === 0 ? { ...c, name: 'Ташкент Агрологистика', legalForm: 'ООО' } : c)) };
    store().setItem('mig.mock.db', JSON.stringify(old));
    initMockDb({ restore: true });
    expect(db().clients.some((c) => CYRILLIC.test(c.name))).toBe(false);
    expect(db().clients.map((c) => c.name)).toEqual(createSeed().clients.map((c) => c.name));
    expect(store().getItem('mig.mock.db')).toBeNull();
    initMockDb({ restore: false });
    resetDb();
  });

  it('a snapshot of the current version is restored', () => {
    const { sessions: _s, ...rest } = db();
    store().setItem('mig.mock.db', JSON.stringify({ ...rest, schemaVersion: MOCK_DB_VERSION }));
    const got = loadSnapshot();
    expect(got?.clients[0]?.name).toBe(rest.clients[0]?.name);
    expect(got).not.toHaveProperty('schemaVersion');
  });
});
