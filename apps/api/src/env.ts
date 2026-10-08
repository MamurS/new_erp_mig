/*
 * Configuration of the API from the environment (secrets only from the environment, BACKEND_SPEC §11).
 *
 * APP_ENV: production | staging | ci | development. Demo routes (`/api/__demo/*`) exist in staging, ci and
 * development only. Part 1 has no Supabase Auth and no production keys for personal data yet, so the server
 * refuses to start with APP_ENV=production.
 */
export type AppEnv = 'production' | 'staging' | 'ci' | 'development';

export interface ApiEnv {
  appEnv: AppEnv;
  databaseUrl: string;
  host: string;
  port: number;
  /** DEV/CI ONLY: the password of every demo account (no Supabase Auth in part 1). */
  demoPassword?: string;
  helpDir?: string;
  poolSize: number;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const appEnv = (env.APP_ENV ?? 'development') as AppEnv;
  if (!['production', 'staging', 'ci', 'development'].includes(appEnv)) throw new Error(`APP_ENV: unknown value ${appEnv}`);
  if (appEnv === 'production') {
    // Part 2 brings Supabase Auth sessions and AES-256-GCM keys; until then nothing here is fit for production.
    throw new Error('APP_ENV=production is not supported yet (backend step 4, part 2: auth, keys of personal data)');
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return {
    appEnv,
    databaseUrl,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8787),
    ...(env.DEMO_PASSWORD ? { demoPassword: env.DEMO_PASSWORD } : {}),
    ...(env.HELP_DIR ? { helpDir: env.HELP_DIR } : {}),
    poolSize: Number(env.DB_POOL_SIZE ?? 10),
  };
}
