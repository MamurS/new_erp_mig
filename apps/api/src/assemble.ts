/*
 * The API from its configuration: Supabase Auth and Storage, the session store, the SMS hook, the routes and the
 * worker — what server.ts runs, and what the tests build for a given APP_ENV (production has no demo routes, no
 * test MFA codes).
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { DEMO_INSURED_PHONE, DEMO_LOGIN_AS } from '@mig/seed/credentials';
import { demoControls, type DemoControls } from './demo';
import { buildApp } from './app';
import { bffAuth } from './auth/bff';
import { cookiePolicy } from './auth/cookies';
import { GoTrue } from './auth/gotrue';
import { JwtVerifier } from './auth/jwt';
import { smsSender, testPhoneCodes, type SmsSender } from './auth/sms';
import { createPool } from './db';
import { serverDeps } from './deps';
import type { ApiEnv } from './env';
import { sharpImageCodec } from './files/imageCodec';
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
  /** Development, ci, staging: the demo knobs (failure simulation, test clock); null in production. */
  demo: DemoControls | null;
}

export async function assemble(
  env: ApiEnv,
  o: { pool?: pg.Pool; logger?: boolean | { level: string }; log?: typeof serverLog } = {},
): Promise<Assembled> {
  const log = o.log ?? serverLog;
  // The demo routes and knobs (and the test clock behind the services' «now»): everything but production.
  const pool = o.pool ?? createPool(env.databaseUrl, env.poolSize);
  const demo = env.demo ? demoControls(pool) : null;
  const now = demo ? demo.now : () => Date.now();
  const demoOptions = { insuredPhone: DEMO_INSURED_PHONE, accounts: DEMO_LOGIN_AS };
  /*
   * Writes made outside a request's transaction while it is open (the session's activity, refreshed tokens, the
   * identity of a just-created account) take their own small pool: on the request pool, ten requests holding all
   * its connections would each wait for an eleventh — a deadlock of the pool under load.
   */
  const side = createPool(env.databaseUrl, 4);
  const gotrue = new GoTrue({ url: env.supabaseUrl, serviceKey: env.serviceKey });
  const jwt = new JwtVerifier({
    jwksUrl: `${gotrue.base}/.well-known/jwks.json`,
    ...(env.jwtSecret ? { secret: env.jwtSecret } : {}),
  });
  const storage = supabaseStorage({ url: env.supabaseUrl, serviceKey: env.serviceKey });
  const identity = identitySync({
    pool: side,
    crypto: env.crypto,
    gotrue,
    demoPassword: env.demoPassword,
    testMfa: env.testTotp,
    inviteRedirectTo: env.inviteRedirectTo,
    log,
  });
  const sms = smsSender(env.smsProvider, { revealCodes: env.demo, log });
  // The test mode of phone sign-in (ALLOW_TEST_TOTP only): `000000` stands for the last code sent to the phone.
  const testCodes = env.testTotp ? testPhoneCodes(pool) : null;
  await storage.ensureBuckets();
  // The worker's job runner (started below when WORKER=inline); the demo clock runs the date clocks with it.
  const jobs = createWorker({ pool, crypto: env.crypto, identity, storage, log, now, ...(env.workerIntervalMs ? { intervalMs: env.workerIntervalMs } : {}) });
  const app = await buildApp({
    pool,
    crypto: env.crypto,
    deps: serverDeps({ helpDir: env.helpDir, demo: env.demo }),
    auth: bffAuth({
      pool: side,
      gotrue,
      jwt,
      crypto: env.crypto,
      sessionSecret: env.sessionSecret,
      cookie: cookiePolicy(env.insecureDevCookie),
      // The test code 000000 and demo factors: ALLOW_TEST_TOTP=true only (never production, see env.ts).
      testMfa: env.testTotp,
      syncIdentity: identity.syncOne,
      ...(env.testTotp ? { ensureDemoFactor: identity.ensureDemoFactor } : {}),
      now,
      log,
      ...(env.demo ? { demoAccounts: demoOptions, testPhoneCodes: testCodes } : {}),
    }),
    storage,
    images: sharpImageCodec(),
    smsHook: { secret: env.smsHookSecret, sender: sms, testCodes },
    demoRoutes: env.demo ? demoOptions : null,
    demo,
    ...(demo ? { runClocks: async () => { await jobs.runJob('contract-lifecycle'); await jobs.runJob('task-deadlines'); } } : {}),
    now,
    logger: o.logger ?? false,
  });
  app.addHook('onClose', async () => {
    await side.end();
  });
  const worker = env.worker === 'inline' ? jobs : null;
  return { app, pool, storage, identity, sms, worker, demo };
}
