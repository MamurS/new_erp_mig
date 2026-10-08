/*
 * Configuration of the API from the environment (secrets only from the environment, BACKEND_SPEC §11; the full
 * list is in README «API (бэкенд)»).
 *
 * APP_ENV: production | staging | ci | development.
 * - production: every secret is required and must not be a published development value; no demo routes, no
 *   demo password, no test MFA codes, no bearer sessions; personal data of key version 0 (plaintext) is refused.
 * - staging, ci, development: demo routes (`/api/__demo/*`), the test MFA mode (`000000`), development keys
 *   when none are given (the generated seed is sealed with them).
 */
import { DEV_PII_KEY, DEV_PII_KEY_VERSION, aesPiiCrypto, parsePiiKeys, sameKey, type AesPiiCrypto } from '@mig/domain/store/piiAes';
import { DEV_HMAC_KEY } from '@mig/domain/store/devKeys';

export type AppEnv = 'production' | 'staging' | 'ci' | 'development';

/** DEV/CI ONLY defaults (local Supabase stack): never accepted in production. */
export const DEV_SESSION_SECRET = 'dev-only-session-secret-not-a-secret-0000';
export const DEV_SMS_HOOK_SECRET = 'v1,whsec_bWlnLWRtcyBkZXYtb25seSBzbXMgaG9vayBzZWNyZXQ=';

export interface ApiEnv {
  appEnv: AppEnv;
  databaseUrl: string;
  host: string;
  port: number;
  poolSize: number;
  helpDir?: string;
  /** Supabase (Kong) URL, the service role key, the JWT secret for HS256 tokens. */
  supabaseUrl: string;
  serviceKey: string;
  jwtSecret?: string;
  crypto: AesPiiCrypto;
  sessionSecret: string;
  smsHookSecret: string;
  smsProvider: string;
  /** Demo routes, the test MFA mode, codes in the development SMS log: everything but production. */
  demo: boolean;
  /** DEV/CI/STAGING ONLY: the password new e-mail accounts get instead of an invitation. */
  demoPassword?: string;
  /** `mig_session` without `Secure` (local http only). */
  insecureDevCookie: boolean;
  inviteRedirectTo?: string;
  /** `inline` (the worker runs in the API process) or `off` (a separate `dist/worker.js`). */
  worker: 'inline' | 'off';
}

function piiCrypto(env: NodeJS.ProcessEnv, prod: boolean): AesPiiCrypto {
  const spec = env.PII_KEYS?.trim();
  if (!spec) {
    if (prod) throw new Error('PII_KEYS is required in production');
    return aesPiiCrypto({ keys: new Map([[DEV_PII_KEY_VERSION, DEV_PII_KEY]]), current: DEV_PII_KEY_VERSION, hmacKey: env.PII_HMAC_KEY || DEV_HMAC_KEY, allowPlaintextV0: true });
  }
  const keys = parsePiiKeys(spec);
  const current = Number(env.PII_KEY_CURRENT ?? Math.max(...keys.keys()));
  if (!keys.has(current)) throw new Error(`PII_KEY_CURRENT=${current} is not in PII_KEYS`);
  const hmacKey = env.PII_HMAC_KEY;
  if (prod) {
    for (const k of keys.values()) if (sameKey(k, DEV_PII_KEY)) throw new Error('PII_KEYS contains the published development key');
    if (!hmacKey || Buffer.from(hmacKey, 'utf8').length < 32 || hmacKey === DEV_HMAC_KEY) throw new Error('PII_HMAC_KEY: at least 32 bytes, not the development key');
  }
  return aesPiiCrypto({ keys, current, hmacKey: hmacKey || DEV_HMAC_KEY, allowPlaintextV0: !prod });
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const appEnv = (env.APP_ENV ?? 'development') as AppEnv;
  if (!['production', 'staging', 'ci', 'development'].includes(appEnv)) throw new Error(`APP_ENV: unknown value ${appEnv}`);
  const prod = appEnv === 'production';
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const sessionSecret = env.SESSION_SECRET || (prod ? '' : DEV_SESSION_SECRET);
  const smsHookSecret = env.SMS_HOOK_SECRET || (prod ? '' : DEV_SMS_HOOK_SECRET);
  if (prod) {
    if (sessionSecret.length < 32 || sessionSecret === DEV_SESSION_SECRET) throw new Error('SESSION_SECRET: at least 32 characters, not the development value');
    if (!/^v1,whsec_[A-Za-z0-9+/=]{32,}$/.test(smsHookSecret) || smsHookSecret === DEV_SMS_HOOK_SECRET) throw new Error('SMS_HOOK_SECRET: v1,whsec_<base64>, not the development value');
    if (env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD must not be set in production');
  }
  // Step 4's temporary bearer sessions are gone: the web app uses the session cookie in every environment.
  if (env.AUTH_BEARER_COMPAT) throw new Error('AUTH_BEARER_COMPAT was removed: sessions are cookies only');
  if (env.INSECURE_DEV_COOKIE === '1' && appEnv !== 'development') throw new Error('INSECURE_DEV_COOKIE is for local development only');
  return {
    appEnv,
    databaseUrl,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8787),
    poolSize: Number(env.DB_POOL_SIZE ?? 10),
    ...(env.HELP_DIR ? { helpDir: env.HELP_DIR } : {}),
    supabaseUrl,
    serviceKey,
    ...(env.SUPABASE_JWT_SECRET ? { jwtSecret: env.SUPABASE_JWT_SECRET } : {}),
    crypto: piiCrypto(env, prod),
    sessionSecret,
    smsHookSecret,
    smsProvider: env.SMS_PROVIDER ?? 'log',
    demo: !prod,
    ...(env.DEMO_PASSWORD && !prod ? { demoPassword: env.DEMO_PASSWORD } : {}),
    insecureDevCookie: env.INSECURE_DEV_COOKIE === '1',
    ...(env.INVITE_REDIRECT_URL ? { inviteRedirectTo: env.INVITE_REDIRECT_URL } : {}),
    worker: env.WORKER === 'off' ? 'off' : 'inline',
  };
}
