import { describe, expect, it } from 'vitest';
import { createSeed } from '@mig/seed/seed';
import { matchesSearch } from '../lib/searchNormalize';
import { currentReserve } from '../services/reserve';
import type { Db } from './db';
import { memoryRepos } from './memory';
import { applyQuery, type Query } from './query';

interface Row {
  id: number;
  name?: string | null;
  n?: number;
  tags?: string[];
}

const ROWS: Row[] = [
  { id: 1, name: 'Bravo', n: 2 },
  { id: 2, name: 'alfa', n: 1 },
  { id: 3, name: null, n: 3 },
  { id: 4, name: 'Ёлка', n: 2, tags: ['x'] },
  { id: 5, name: 'Елка', n: 2 },
  { id: 6, name: '"Alfa"', tags: ['x', 'y'] },
  { id: 7, name: 'ALFA', n: 1 },
  { id: 8, n: 2 },
];
const ids = (q: Query<Row>) => applyQuery(ROWS, q).map((r) => r.id);

describe('memory query engine', () => {
  it('orders by code points by default, rows without a value last in both directions, ties in storage order', () => {
    // Code points: Ё (U+0401) before Е (U+0415).
    expect(ids({ orderBy: [['name', 'asc']] })).toEqual([6, 7, 1, 2, 4, 5, 3, 8]);
    expect(ids({ orderBy: [['name', 'desc']] })).toEqual([5, 4, 2, 1, 7, 6, 3, 8]);
    expect(ids({ orderBy: [{ field: 'name', nulls: 'first' }] })).toEqual([3, 8, 6, 7, 1, 2, 4, 5]);
    // Ties of n keep storage order; the rows without n go last.
    expect(ids({ orderBy: [['n', 'asc']] })).toEqual([2, 7, 1, 4, 5, 8, 3, 6]);
    expect(ids({ orderBy: [['n', 'desc']] })).toEqual([3, 1, 4, 5, 8, 2, 7, 6]);
  });

  it('collations: ru as localeCompare, legal names ignoring case and punctuation (equal names are a tie)', () => {
    const named = ROWS.filter((r) => r.name);
    const ru = [...named].sort((a, b) => a.name!.localeCompare(b.name!, 'ru')).map((r) => r.id);
    expect(ids({ where: { name: { isNull: false } }, orderBy: [{ field: 'name', collate: 'ru' }] })).toEqual(ru);
    // alfa, "Alfa" and ALFA are one name: storage order (2, 6, 7).
    expect(ids({ where: { name: { isNull: false } }, orderBy: [{ field: 'name', collate: 'legal' }] })).toEqual([2, 6, 7, 1, 4, 5]);
    expect(ids({ where: { name: { isNull: false } }, orderBy: [{ field: 'name', collate: 'legal', dir: 'desc' }] })).toEqual([4, 5, 1, 2, 6, 7]);
  });

  it('a value for rows without one (`ifNull`) sorts them among the others', () => {
    expect(ids({ orderBy: [{ field: 'name', ifNull: '' }] })).toEqual([3, 8, 6, 7, 1, 2, 4, 5]);
    expect(ids({ orderBy: [{ field: 'n', ifNull: 0, dir: 'desc' }, ['id', 'desc']] })).toEqual([3, 8, 5, 4, 1, 7, 2, 6]);
  });

  it('limit and offset page the ordered rows', () => {
    const all = ids({ orderBy: [['n', 'asc']] });
    expect(ids({ orderBy: [['n', 'asc']], limit: 3 })).toEqual(all.slice(0, 3));
    expect(ids({ orderBy: [['n', 'asc']], limit: 3, offset: 3 })).toEqual(all.slice(3, 6));
    expect(ids({ orderBy: [['n', 'asc']], limit: 3, offset: 6 })).toEqual(all.slice(6));
    expect(ids({ orderBy: [['n', 'asc']], limit: 3, offset: 9 })).toEqual([]);
    expect(ids({ limit: 0 })).toEqual([]);
  });

  it('$or, $and, search and includes', () => {
    expect(ids({ where: { $or: [{ n: 3 }, { name: 'Bravo' }] } })).toEqual([1, 3]);
    expect(ids({ where: { $or: [] } })).toEqual([]);
    expect(ids({ where: { $and: [{ n: { gte: 2 } }, { n: { lte: 2 } }] } })).toEqual([1, 4, 5, 8]);
    expect(ids({ where: { tags: { includes: 'x' } } })).toEqual([4, 6]);
    // The search of the lists: searchKey substring, Latin ~ Cyrillic; an empty key matches every row.
    for (const term of ['alf', 'елк', 'yolka', 'ALFA', '']) {
      expect(ids({ where: { name: { search: term } } })).toEqual(ROWS.filter((r) => matchesSearch(term, r.name)).map((r) => r.id));
    }
    expect(ids({ where: { name: { search: "'" } } })).toEqual(ROWS.map((r) => r.id));
  });
});

describe('memory repositories: list queries', () => {
  const T = Date.parse('2026-10-09T10:00:00+05:00');
  let db: Db = createSeed({ now: T });
  const repos = memoryRepos(() => db);

  it('computed fields filter and order without being returned', async () => {
    db = createSeed({ now: T });
    const top = await repos.claims.list({ orderBy: [{ field: 'reserve', dir: 'desc' }], limit: 5 });
    const expected = [...db.claims].sort((a, b) => currentReserve(b) - currentReserve(a)).slice(0, 5);
    expect(top.map((c) => c.id)).toEqual(expected.map((c) => c.id));
    expect(top[0]).not.toHaveProperty('reserve');
    const counts = new Map<string, number>();
    for (const i of db.insured) if (i.status === 'active') counts.set(i.clientId, (counts.get(i.clientId) ?? 0) + 1);
    const byCount = await repos.clients.list({ orderBy: [{ field: 'insuredCount', dir: 'desc' }] });
    const want = [...db.clients].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
    expect(byCount.map((c) => c.id)).toEqual(want.map((c) => c.id));
    expect(await repos.claims.count({ flagged: true })).toBe(db.claims.filter((c) => c.flags?.some((f) => !f.dismissed)).length);
  });

  it('count, sum and select', async () => {
    db = createSeed({ now: T });
    expect(await repos.clients.sum('premium')).toBe(db.clients.reduce((s, c) => s + c.premium, 0));
    expect(await repos.clients.sum('premium', { status: 'active' })).toBe(db.clients.filter((c) => c.status === 'active').reduce((s, c) => s + c.premium, 0));
    const some = await repos.insured.select(['id', 'policyId'], { where: { relation: 'employee' }, limit: 3 });
    expect(some).toHaveLength(3);
    expect(Object.keys(some[0]!).sort()).toEqual(['id', 'policyId']);
  });
});
