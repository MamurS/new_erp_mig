/*
 * systemDb (BACKEND_SPEC §2.3): the service role outside of a person's request — background jobs, database
 * maintenance, test fixtures. Row-level security does not apply here. ESLint forbids importing this module
 * from the route table, the services and the request adapter (eslint.config.js): a request runs as its person
 * (db.ts), with only the narrow privileged capability of the repositories and `ctx.system`.
 */
import type pg from 'pg';
import type { BaseCtx } from '@mig/domain/services/kernel';
import { postgresRepos } from '@mig/domain/store/postgres';
import type { PiiCrypto } from '@mig/domain/store/pii';
import { RequestTx } from './db';

export interface SystemDbOptions {
  crypto: PiiCrypto;
  now?: () => number;
}

/** Runs `fn` in one transaction as the service role; commits when it returns. */
export async function withSystemDb<T>(pool: pg.Pool, o: SystemDbOptions, fn: (ctx: BaseCtx) => Promise<T>): Promise<T> {
  const tx = await RequestTx.begin(pool);
  try {
    const repos = postgresRepos(tx.system(), { crypto: o.crypto, privileged: true });
    const out = await fn({ repos, now: o.now ?? (() => Date.now()), env: { demo: false }, system: { repos } });
    await tx.commit();
    return out;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}
