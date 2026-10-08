/*
 * The API from its configuration: Supabase Auth and Storage, the session store, the SMS hook, the routes and the
 * worker — what server.ts runs, and what the tests build for a given APP_ENV (production has no demo routes, no
 * test MFA codes, no bearer sessions).
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { DEMO_INSURED_PHONE } from '@mig/seed/credentials';
import { buildApp } from './app';
import { bffAuth } from './auth/bff';
import { cookiePolicy } from './auth/cookies';
import { GoTrue } from './auth/gotrue';
import { JwtVerifier } from './auth/jwt';
import { smsSender, type SmsSender } from './auth/sms';
import { createPool } from './db';
import { serverDeps } from './deps';
import type { ApiEnv } from './env';
import { supabaseStorage, type SupabaseStorage } from './files/storage';
import { identitySync, type IdentitySync } from './jobs/identity';
import { createWorker, type Worker } from './jobs/worker';
import { serverLog } from './log';

export interface Assembled {
  app: FastifyInstance;
  pool: pg.Pool;
  storage: SupabaseStorage;
  identity: IdentitySync;
  sms: SmsSender;
  /** The worker when it runs in the API process (WORKER=inline); not started yet. */
  worker: Worker | null;
}

export async function assemble(
  env: ApiEnv,
  o: { pool?: pg.Pool; logger?: boolean; log?: typeof serverLog } = {},
): Promise<Assembled> {
  const log = o.log ?? serverLog;
  const pool = o.pool ?? createPool(env.databaseUrl, env.poolSize);
  const gotrue = new GoTrue({ url: env.supabaseUrl, serviceKey: env.serviceKey });
  const jwt = new JwtVerifier({
    jwksUrl: `${gotrue.base}/.well-known/jwks.json`,
    ...(env.jwtSecret ? { secret: env.jwtSecret } : {}),
  });
  const storage = supabaseStorage({ url: env.supabaseUrl, serviceKey: env.serviceKey });
  const identity = identitySync({
    pool,
    crypto: env.crypto,
    gotrue,
    demoPassword: env.demoPassword,
    testMfa: env.demo,
    inviteRedirectTo: env.inviteRedirectTo,
    log,
  });
  const sms = smsSender(env.smsProvider, { revealCodes: env.demo, log });
  await storage.ensureBuckets();
  const app = await buildApp({
    pool,
    crypto: env.crypto,
    deps: serverDeps({ helpDir: env.helpDir, demo: env.demo }),
    auth: bffAuth({
      pool,
      gotrue,
      jwt,
      crypto: env.crypto,
      sessionSecret: env.sessionSecret,
      cookie: cookiePolicy(env.insecureDevCookie),
      // The demo code 000000 and demo factors: development, ci and staging only.
      testMfa: env.demo,
      bearerCompat: env.bearerCompat,
      syncIdentity: identity.syncOne,
      ...(env.demo ? { ensureDemoFactor: identity.ensureDemoFactor } : {}),
      now: () => Date.now(),
      log,
    }),
    storage,
    smsHook: { secret: env.smsHookSecret, sender: sms },
    demoRoutes: env.demo ? { insuredPhone: DEMO_INSURED_PHONE } : null,
    logger: o.logger ?? false,
  });
  const worker = env.worker === 'inline' ? createWorker({ pool, crypto: env.crypto, identity, log }) : null;
  return { app, pool, storage, identity, sms, worker };
}
