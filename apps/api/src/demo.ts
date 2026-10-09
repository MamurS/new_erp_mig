/*
 * DEMO/CI/STAGING ONLY — the server-side analogs of the mock's demo knobs (BACKEND_SPEC §12.3). The routes exist
 * only where the demo routes do (APP_ENV development, ci, staging); production never registers them, and its
 * test proves it (production.test.ts). What the mock does with its in-memory database the server does here:
 *
 * - `POST /api/__demo/reset` `{ xss?: boolean }` — the seed again, for the server's current time (as the mock
 *   builds its seed for the page's time); people stay signed in. `xss`: the seed variant with markup in names
 *   (the mock's VITE_SEED_XSS, used by the e2e suite);
 * - `GET|POST /api/__demo/failures` `{ enabled }` — «Имитировать сбои сети»: 10 % of the API's requests answer 500
 *   (not the demo routes, not the partner API), like the mock;
 * - `GET|POST /api/__demo/clock` `{ offsetMs }` or `{ advanceMs }` — the test clock: the services' «now» (ctx.now(),
 *   idle limits, sign-in steps) runs ahead of the real time by the offset, as `page.clock` moves the page's time in
 *   the e2e suite. Supabase Auth and its tokens keep the real time.
 *
 * Mutations need the CSRF header like every route of the portals; no session is needed (the mock's knobs need
 * none either, and the e2e suite resets before signing in).
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { ZodType } from 'zod';
import { CSRF_HEADER, CSRF_VALUE } from '@mig/domain/http/csrf';
import { demoClockSchema, demoFailuresSchema, demoResetSchema, MAX_CLOCK_OFFSET } from '@mig/domain/http/demoRoutes';
import type { Db } from '@mig/domain/store/db';
import { buildSeedSql } from '@mig/domain/store/sql/seed';
import { createSeed } from '@mig/seed/seed';
import { loadSeed } from './jobs/seedLoad';

/** A seed built ahead for the next reset (building it takes about a second of CPU). */
interface Prepared {
  now: number;
  xss: boolean;
  db: Db;
  sql: string;
}
/** How far the «now» of a prepared seed may be from the reset's (the mock's seed is as old as the page). */
const PREPARED_FRESH_MS = 2 * 60_000;

/**
 * The switches of the demo deployment: the failure simulation and the test clock. They live in Postgres
 * (`app.demo_state`, shared by the API replicas); each request reads them first (`sync`), so every replica answers
 * with the same clock and the same failure switch.
 */
export interface DemoControls {
  failures: boolean;
  offsetMs: number;
  /** The services' clock: the real time plus the test clock's offset. */
  now(): number;
  /** Reads the shared state (at the start of every request). */
  sync(): Promise<void>;
  /** Writes the shared state. */
  set(patch: Partial<Pick<DemoControls, 'failures' | 'offsetMs'>>): Promise<void>;
}

export function demoControls(pool: Pick<pg.Pool, 'query'>): DemoControls {
  const c: DemoControls = {
    failures: false,
    offsetMs: 0,
    now: () => Date.now() + c.offsetMs,
    async sync() {
      const { rows } = await pool.query<{ failures: boolean; offset_ms: string }>(`select failures, offset_ms from app.demo_state`);
      if (rows[0]) {
        c.failures = rows[0].failures;
        c.offsetMs = Number(rows[0].offset_ms);
      }
    },
    async set(patch) {
      if (patch.failures !== undefined) c.failures = patch.failures;
      if (patch.offsetMs !== undefined) c.offsetMs = patch.offsetMs;
      await pool.query(
        `insert into app.demo_state (id, failures, offset_ms, updated_at) values (true, $1, $2, now())
           on conflict (id) do update set failures = excluded.failures, offset_ms = excluded.offset_ms, updated_at = now()`,
        [c.failures, c.offsetMs],
      );
    },
  };
  return c;
}

/** The share of requests the failure simulation answers with 500 (the mock's 10 %). */
export const FAILURE_RATE = 0.1;


const BAD = { code: 'validation', key: 'errors.validation' } as const;
const CSRF = { code: 'forbidden', key: 'errors.csrf' } as const;

function parse<T>(schema: ZodType<T>, body: unknown): T | null {
  let v: unknown = {};
  if (body instanceof Buffer && body.length) {
    try {
      v = JSON.parse(body.toString('utf8'));
    } catch {
      return null;
    }
  }
  const r = schema.safeParse(v);
  return r.success ? r.data : null;
}

export function registerDemoControls(app: FastifyInstance, o: { pool: pg.Pool; controls: DemoControls; runClocks?: () => Promise<unknown>; log?: (msg: string, data?: Record<string, unknown>) => void }): void {
  const { controls } = o;
  const json = (reply: import('fastify').FastifyReply, status: number, body: unknown) => reply.code(status).type('application/json').send(JSON.stringify(body));
  const csrf = (h: Record<string, unknown>) => h[CSRF_HEADER] === CSRF_VALUE;

  // These routes read and change the shared knobs: each starts from what the other replicas wrote.
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/__demo/')) await controls.sync();
  });

  let prepared: Prepared | null = null;
  const build = (now: number, xss: boolean): Prepared => {
    const db = createSeed({ now, xss });
    return { now, xss, db, sql: buildSeedSql(db) };
  };

  app.post('/api/__demo/reset', async (request, reply) => {
    if (!csrf(request.headers)) return json(reply, 403, CSRF);
    const body = parse(demoResetSchema, request.body);
    if (!body) return json(reply, 400, BAD);
    const started = Date.now();
    const xss = body.xss ?? false;
    const now = controls.now();
    const seed = prepared && prepared.xss === xss && Math.abs(prepared.now - now) < PREPARED_FRESH_MS ? prepared : build(now, xss);
    prepared = null;
    await loadSeed(o.pool, seed.db, { keepSessions: true, authUsers: 'when-changed', sql: seed.sql });
    o.log?.('demo reset', { ms: Date.now() - started, xss });
    // The next reset (the next e2e test) is likely soon: build its seed when this answer has gone.
    setTimeout(() => {
      prepared = build(controls.now(), xss);
    }, 1_000).unref();
    return json(reply, 200, { ok: true });
  });

  app.get('/api/__demo/failures', async (_request, reply) => json(reply, 200, { ok: true, enabled: controls.failures }));
  app.post('/api/__demo/failures', async (request, reply) => {
    if (!csrf(request.headers)) return json(reply, 403, CSRF);
    const body = parse(demoFailuresSchema, request.body);
    if (!body) return json(reply, 400, BAD);
    await controls.set({ failures: body.enabled });
    return json(reply, 200, { ok: true, enabled: controls.failures });
  });

  app.get('/api/__demo/clock', async (_request, reply) => json(reply, 200, { now: controls.now(), offsetMs: controls.offsetMs }));
  app.post('/api/__demo/clock', async (request, reply) => {
    if (!csrf(request.headers)) return json(reply, 403, CSRF);
    const body = parse(demoClockSchema, request.body);
    if (!body) return json(reply, 400, BAD);
    await controls.set({ offsetMs: 'offsetMs' in body ? body.offsetMs : Math.min(MAX_CLOCK_OFFSET, controls.offsetMs + body.advanceMs) });
    // The date clocks are a background job (services/jobs.ts `contract-lifecycle`, every 15 minutes): a jump of the
    // test clock runs it at once, as the schedule would have on the way (contracts coming into force, invoices overdue).
    await o.runClocks?.();
    return json(reply, 200, { now: controls.now(), offsetMs: controls.offsetMs });
  });
}
