/*
 * Configuration of the API from the environment (secrets only from the environment, BACKEND_SPEC §11; the full
 * list is in README «API (бэкенд)»).
 *
 * APP_ENV: production | staging | ci | development.
 * - production: every secret is required and must not be a published development value; no demo routes, no
 *   demo password, no test MFA codes, no bearer sessions; personal data of key version 0 (plaintext) is refused.
 * - staging, ci, development: demo routes (`/api/__demo/*`), development keys when none are given (the generated
 *   seed is sealed with them).
 *
 * ALLOW_TEST_TOTP=true (off by default): the test MFA mode — `000000` is accepted as a TOTP code (and stands for the
 * last SMS code of a phone), people without a factor get a demo factor, «Войти как…» works. The API refuses to start
 * with it when APP_ENV=production or NODE_ENV=production.
 */
import { DEV_PII_KEY, DEV_PII_KEY_VERSION, aesPiiCrypto, parsePiiKeys, sameKey, type AesPiiCrypto } from '@mig/domain/store/piiAes';
import { DEV_HMAC_KEY } from '@mig/domain/store/devKeys';
import type { SmtpConfig } from './mail/smtp';

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
  /** Demo routes, codes in the development SMS log: everything but production. */
  demo: boolean;
  /** The test MFA mode (`000000`, demo factors, «Войти как…»): only with ALLOW_TEST_TOTP=true, never in production. */
  testTotp: boolean;
  /** DEV/CI/STAGING ONLY: the password new e-mail accounts get instead of an invitation. */
  demoPassword?: string;
  /** `mig_session` without `Secure` (local http only). */
  insecureDevCookie: boolean;
  inviteRedirectTo?: string;
  /** The SMTP of MIG for invitation e-mails (required in production). */
  smtp?: SmtpConfig;
  /** `inline` (the worker runs in the API process) or `off` (a separate `dist/worker.js`). */
  worker: 'inline' | 'off';
  /** WORKER_INTERVAL_MS: the pause between the worker's passes (default 10 s; e2e use a shorter one). */
  workerIntervalMs?: number;
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

/** SMTP_* of the deployment: required in production (with TLS and a public https link of the invitations). */
function smtpConfig(env: NodeJS.ProcessEnv, prod: boolean): SmtpConfig | undefined {
  const host = env.SMTP_HOST?.trim();
  if (!host) {
    if (prod) throw new Error('SMTP_HOST is required in production (invitation e-mails)');
    return undefined;
  }
  const tls = (env.SMTP_TLS || 'starttls') as SmtpConfig['tls'];
  if (!['starttls', 'tls', 'none'].includes(tls)) throw new Error(`SMTP_TLS: unknown value ${tls}`);
  if (prod && tls === 'none') throw new Error('SMTP_TLS=none is not allowed in production');
  const from = env.SMTP_FROM?.trim();
  if (!from) throw new Error('SMTP_FROM is required with SMTP_HOST');
  if (prod && !/^https:\/\//.test(env.INVITE_REDIRECT_URL ?? '')) throw new Error('INVITE_REDIRECT_URL: the https address of the portal is required in production');
  return {
    host,
    port: env.SMTP_PORT ? Number(env.SMTP_PORT) : tls === 'tls' ? 465 : 587,
    tls,
    from,
    ...(env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : {}),
  };
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
  const testTotp = env.ALLOW_TEST_TOTP === 'true';
  if (testTotp && (prod || env.NODE_ENV === 'production')) throw new Error('ALLOW_TEST_TOTP must not be set when APP_ENV or NODE_ENV is production');
  if (env.INSECURE_DEV_COOKIE === '1' && appEnv !== 'development') throw new Error('INSECURE_DEV_COOKIE is for local development only');
  const smtp = smtpConfig(env, prod);
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
    testTotp,
    ...(env.DEMO_PASSWORD && !prod ? { demoPassword: env.DEMO_PASSWORD } : {}),
    insecureDevCookie: env.INSECURE_DEV_COOKIE === '1',
    ...(env.INVITE_REDIRECT_URL ? { inviteRedirectTo: env.INVITE_REDIRECT_URL } : {}),
    ...(smtp ? { smtp } : {}),
    worker: env.WORKER === 'off' ? 'off' : 'inline',
    ...(Number(env.WORKER_INTERVAL_MS) >= 500 ? { workerIntervalMs: Number(env.WORKER_INTERVAL_MS) } : {}),
  };
}
