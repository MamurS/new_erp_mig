/* The API process: configuration, the connection pool, the Fastify app. */
import { DEMO_INSURED_PHONE } from '@mig/seed/credentials';
import { devPiiCrypto } from '@mig/domain/store/pii';
import { buildApp } from './app';
import { createPool } from './db';
import { serverDeps } from './deps';
import { readEnv } from './env';

const env = readEnv();
const demo = env.appEnv !== 'production';
const pool = createPool(env.databaseUrl, env.poolSize);
const app = await buildApp({
  pool,
  // DEV/CI ONLY: key version 0 (plaintext) as in supabase/seed.sql; part 2 brings AES-256-GCM keys.
  crypto: devPiiCrypto(),
  deps: serverDeps({ helpDir: env.helpDir, demo, demoPassword: env.demoPassword }),
  demoRoutes: demo ? { insuredPhone: DEMO_INSURED_PHONE } : null,
  demoPassword: env.demoPassword,
  logger: true,
});

const stop = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

await app.listen({ host: env.host, port: env.port });
