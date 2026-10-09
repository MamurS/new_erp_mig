/*
 * The SQL twins of the list queries (store/sql/listQueries.ts) against their TypeScript originals: `app.search_key`
 * vs lib/searchNormalize.ts `searchKey`, `app.claim_reserve` vs reserve.ts `currentReserve`, the collations
 * `app.ru` / `app.legal_name` vs `localeCompare(…, 'ru')` / `legalNameCollator` — over the seed's texts and edge
 * cases. Read-only (no seed is loaded): it may run next to the other database tests.
 *
 * Needs DATABASE_URL (CI job `api`); skipped otherwise.
 */
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { legalNameCollator } from '@mig/domain/config/legalForms';
import { searchKey } from '@mig/domain/lib/searchNormalize';
import { currentReserve } from '@mig/domain/services/reserve';
import { createSeed } from '@mig/seed/seed';
import { hasDb, testPool } from './test/support';

const T = Date.parse('2026-10-09T10:00:00+05:00');

const EDGE = [
  '',
  ' ',
  'Ташкент',
  'Toshkent',
  'TOSHKENT',
  'Ғулом Қодиров',
  'Ўрмонов Ҳасан',
  "O‘zbekiston  Temir   yo'llari",
  'Oʻzbekiston Oʼzbekiston O`zbekiston',
  'Самарканд Samarqand',
  'Аллаёров Шухрат Щукин',
  'Объект Мельник',
  'Юлдуз ёқубова  ',
  '\tтаб\nстрока nbsp em　ideo',
  'XXL Kh qq kx kkh',
  'İstanbul Σίσυφος ΣΑΣ',
  'école',
  'АО «Узбектелеком»',
  'MChJ "Alfa-Invest"',
  '😀😀 aa',
  '%_\\',
  'ЁЛКА Ёлка ёлка',
  '12345 001',
];

describe.skipIf(!hasDb)('list queries: SQL twins of the TypeScript rules', () => {
  let pool: pg.Pool;
  const seed = createSeed({ now: T });
  const texts = [
    ...EDGE,
    ...seed.insured.flatMap((i) => [i.fullName, i.position, i.clientName]),
    ...seed.clients.map((c) => c.name),
    ...seed.clinics.flatMap((c) => [c.name, c.district]),
    ...seed.claims.flatMap((c) => [c.number, c.insuredName, c.clientName, c.externalNumber ?? '']),
    ...seed.appointments.flatMap((a) => [a.insuredName, a.clinicName]),
  ];

  beforeAll(() => {
    pool = testPool();
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('app.search_key = searchKey', async () => {
    const unique = [...new Set(texts)];
    const { rows } = await pool.query<{ k: string | null }>('select app.search_key(x) as k from unnest($1::text[]) with ordinality as u(x, n) order by n', [unique]);
    const diffs = unique.map((x, i) => [x, searchKey(x), rows[i]?.k] as const).filter(([, js, sql]) => js !== sql);
    expect(diffs).toEqual([]);
    expect((await pool.query('select app.search_key(null) as k')).rows[0].k).toBeNull();
  });

  it('app.claim_reserve = currentReserve', async () => {
    const claims = seed.claims.map((c) => ({ history: c.history, reserveHistory: c.reserveHistory ?? null, amountClaimed: c.amountClaimed, amountApproved: c.amountApproved ?? null }));
    // Edge cases: explicit changes at the same time as a derived event (the later one wins), no history at all.
    const at = '2026-10-01T10:00:00+05:00';
    claims.push(
      { history: [{ at, from: null, to: 'new', actorName: 'x' }] as never, reserveHistory: [{ at, byName: 'y', from: 0, to: 777, reason: 'r' }] as never, amountClaimed: 500, amountApproved: null },
      { history: [] as never, reserveHistory: null, amountClaimed: 100, amountApproved: null },
      { history: [{ at, to: 'new', actorName: 'x' }, { at: '2026-10-02T10:00:00+05:00', from: 'review', to: 'approved', actorName: 'x' }] as never, reserveHistory: null, amountClaimed: 100, amountApproved: null },
    );
    const { rows } = await pool.query<{ r: string }>(
      `select app.claim_reserve(c -> 'history', c -> 'reserveHistory', (c ->> 'amountClaimed')::bigint, (c ->> 'amountApproved')::bigint) as r
         from jsonb_array_elements($1::jsonb) with ordinality as u(c, n) order by n`,
      [JSON.stringify(claims)],
    );
    expect(rows.map((r) => Number(r.r))).toEqual(claims.map((c) => currentReserve({ ...c, reserveHistory: c.reserveHistory ?? undefined, amountApproved: c.amountApproved ?? undefined } as never)));
  });

  it('collations app.ru and app.legal_name order as the JavaScript collators', async () => {
    const names = [...new Set(texts.filter(Boolean))];
    const order = async (collation: string) =>
      (await pool.query<{ x: string }>(`select x from unnest($1::text[]) with ordinality as u(x, n) order by x collate ${collation}, n`, [names])).rows.map((r) => r.x);
    // A stable sort: ties keep the input order (the `n` above, `_pos` in the tables).
    expect(await order('app.ru')).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ru')));
    expect(await order('app.legal_name')).toEqual([...names].sort(legalNameCollator.compare));
  });
});
