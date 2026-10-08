/*
 * The request transaction (BACKEND_SPEC §2.2): one transaction per API request on one connection. It starts
 * as the service role (signing in, resolving the session — tables no person may read) and switches to the
 * person before the service runs:
 *
 *   set local role authenticated;
 *   select set_config('request.jwt.claims', '<claims>', true);
 *
 * so every statement of the service is checked by row-level security. `privileged()` runs a group of
 * statements as the service role and switches back (the narrow capability of postgres.ts and `ctx.system`).
 * Statements of one request never interleave inside such a group.
 */
import pg from 'pg';
import type { Role, SessionUser } from '@mig/contracts';
import type { Sql, SqlResult, SqlSession } from '@mig/domain/store/postgres';

/** The claims of a person as the Custom Access Token Hook will put them into the JWT (BACKEND_SPEC §7). */
export interface Claims {
  sub: string;
  role: 'authenticated';
  aal: 'aal1' | 'aal2';
  app_metadata: {
    role: Role;
    company_id?: string;
    clinic_id?: string;
    assistance_id?: string;
    insured_id?: string;
  };
}

/**
 * Claims of a signed-in person. Part 1: the session store of the mock (sign-in with a one-time code), so the
 * code counts as the second factor (`aal2`); part 2 takes `aal` from Supabase Auth (TOTP for staff, clinics,
 * assistance companies).
 */
export function claimsOf(user: SessionUser): Claims {
  return {
    sub: user.id,
    role: 'authenticated',
    aal: 'aal2',
    app_metadata: {
      role: user.role,
      ...(user.companyId ? { company_id: user.companyId } : {}),
      ...(user.clinicId ? { clinic_id: user.clinicId } : {}),
      ...(user.assistanceId ? { assistance_id: user.assistanceId } : {}),
      ...(user.insuredId ? { insured_id: user.insuredId } : {}),
    },
  };
}

/** node-pg sends a Buffer as bytea; a plain Uint8Array (WebCrypto, TextEncoder) must become one. */
function param(v: unknown): unknown {
  if (v instanceof Uint8Array && !Buffer.isBuffer(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return v.map(param);
  return v;
}

async function exec(client: pg.PoolClient | pg.Client, text: string, params: readonly unknown[] = []): Promise<SqlResult> {
  const r = await client.query(text, params.map(param));
  return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount ?? 0 };
}

/** The service role of Supabase (BYPASSRLS): system work and the privileged groups. */
const SYSTEM_ROLE = 'service_role';

export class RequestTx implements SqlSession {
  private queue: Promise<unknown> = Promise.resolve();
  private asPerson = false;
  private done = false;

  private constructor(private readonly client: pg.PoolClient) {}

  /** Begins a transaction as the service role (READ COMMITTED: the audit hash chain relies on it). */
  static async begin(pool: pg.Pool): Promise<RequestTx> {
    const client = await pool.connect();
    try {
      await client.query('begin isolation level read committed');
      await client.query(`set local role ${SYSTEM_ROLE}`);
    } catch (e) {
      client.release();
      throw e;
    }
    return new RequestTx(client);
  }

  /** Runs `fn` alone on the connection (statements of one request are serialized). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private raw: Sql = { query: (text, params) => exec(this.client, text, params) };

  query(text: string, params?: readonly unknown[]): Promise<SqlResult> {
    return this.exclusive(() => exec(this.client, text, params));
  }

  privileged<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      if (!this.asPerson) return fn(this.raw);
      await exec(this.client, `set local role ${SYSTEM_ROLE}`);
      try {
        return await fn(this.raw);
      } finally {
        await exec(this.client, 'set local role authenticated');
      }
    });
  }

  /** From here on the statements run as the person: RLS with their claims. */
  asUser(claims: Claims): Promise<void> {
    return this.exclusive(async () => {
      await exec(this.client, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await exec(this.client, 'set local role authenticated');
      this.asPerson = true;
    });
  }

  /** A session that runs every statement as the service role (system repositories). */
  system(): SqlSession {
    return { query: (text, params) => this.privileged((s) => s.query(text, params)), privileged: (fn) => this.privileged(fn) };
  }

  async commit(): Promise<void> {
    await this.end('commit');
  }

  async rollback(): Promise<void> {
    await this.end('rollback');
  }

  private async end(sql: 'commit' | 'rollback'): Promise<void> {
    if (this.done) return;
    this.done = true;
    try {
      await this.queue;
      await this.client.query(sql);
      this.client.release();
    } catch (e) {
      // A broken connection must not go back to the pool.
      this.client.release(e instanceof Error ? e : true);
      if (sql === 'commit') throw e;
    }
  }
}

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max, application_name: 'mig-api' });
}
