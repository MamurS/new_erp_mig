/*
 * The assistance search by the last 4 digits of the phone against Postgres (stage 1.5): the separate HMAC of the tail
 * (never readable by a person), only with a part of the name or the birth date, only the assistance's own insured
 * persons (RLS and the roster), every search audited; the worker fills the tail of rows written before the column.
 *
 * Needs DATABASE_URL and the Supabase stack (CI job `api`); skipped otherwise.
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@mig/domain/store/db';
import { devAesPiiCrypto } from '@mig/domain/store/piiAes';
import { tailInput } from '@mig/domain/store/sql/physical';
import { createSeed } from '@mig/seed/seed';
import { buildApp } from './app';
import { SESSION_COOKIE } from './auth/cookies';
import { createWorker } from './jobs/worker';
import { hasSupabase, testBff, testStack } from './test/supabase';
import { fastifyClient, hasDb, loadSeed, signIn, testDeps, testPool, type Client } from './test/support';

describe.skipIf(!hasDb || !hasSupabase)('assistance search by the last 4 digits of the phone', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let api: Client;
  let d: Db;
  const crypto = devAesPiiCrypto();

  beforeAll(async () => {
    d = createSeed({ now: Date.now() });
    pool = testPool();
    await loadSeed(pool, d);
    const stack = testStack(pool, crypto);
    app = await buildApp({ pool, crypto, deps: testDeps(), auth: testBff(pool, crypto, stack), storage: stack.storage });
    api = fastifyClient(app, { cookie: SESSION_COOKIE });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const search = (sid: string, body: unknown) => api.call('POST', '/assist/insured/phone-tail', { session: sid, body });

  it('finds its own insured person with a part of the name or the birth date; audited without the data', async () => {
    const sid = await signIn(api, { email: 'asst-operator@demo-assist.uz' }, SESSION_COOKIE);
    const roster = (await api.call('GET', '/assist/insured', { session: sid })).body as { id: string }[];
    const own = d.insured.find((i) => roster.some((r) => r.id === i.id) && i.phone)!;
    const tail = own.phone.replace(/\D/g, '').slice(-4);
    const surname = own.fullName.split(' ')[0]!;
    expect((await search(sid, { tail })).status).toBe(422);
    const byName = await search(sid, { tail, name: surname.slice(0, 4) });
    expect(byName.status).toBe(200);
    expect((byName.body as { id: string }[]).map((x) => x.id)).toContain(own.id);
    const byBirth = await search(sid, { tail, birthDate: own.birthDate });
    expect((byBirth.body as { id: string }[]).map((x) => x.id)).toContain(own.id);
    const { rows } = await pool.query(`select target_label from public.audit_log where action = 'insured_phone_tail_search' order by _pos desc limit 2`);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.target_label).toMatch(/найдено \d+/);
      expect(r.target_label).not.toContain(tail);
    }
    // Another assistance does not find it.
    const other = await signIn(api, { email: 'asst-operator@demo-assist2.uz' }, SESSION_COOKIE);
    expect(((await search(other, { tail, birthDate: own.birthDate })).body as { id: string }[]).map((x) => x.id)).not.toContain(own.id);
  });

  it('the tail HMAC is separate from the full phone HMAC; the API never returns it', async () => {
    const own = d.insured.find((i) => i.phone)!;
    const { rows } = await pool.query(`select phone_hmac, phone_tail_hmac from public.insured where id = $1::uuid`, [own.id]);
    expect(Buffer.from(rows[0].phone_tail_hmac)).toEqual(Buffer.from(await crypto.hmac(tailInput(own.phone)!)));
    expect(Buffer.from(rows[0].phone_tail_hmac)).not.toEqual(Buffer.from(rows[0].phone_hmac));
    const sid = await signIn(api, { email: 'asst-operator@demo-assist.uz' }, SESSION_COOKIE);
    const roster = (await api.call('GET', '/assist/insured', { session: sid })).text;
    expect(roster).not.toMatch(/tail/i);
  });

  it('the worker fills the tail of rows written before the column, once', async () => {
    const ids = d.insured.filter((i) => i.phone).slice(0, 3).map((i) => i.id);
    await pool.query(`update public.insured set phone_tail_hmac = null where id = any($1::uuid[])`, [ids]);
    const worker = createWorker({ pool, crypto });
    expect((await worker.tick()).phoneTails).toBe(3);
    expect((await worker.tick()).phoneTails).toBe(0);
    const { rows } = await pool.query(`select count(*)::int as n from public.insured where id = any($1::uuid[]) and phone_tail_hmac is not null`, [ids]);
    expect(rows[0].n).toBe(3);
  });
});
