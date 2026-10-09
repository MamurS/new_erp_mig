/*
 * Personal-data encryption (BACKEND_SPEC §5) without a database: AES-256-GCM round trip, the search HMAC,
 * key rotation (old versions stay readable, new values take the current key), refusal of plaintext version 0 and
 * of tampered ciphertexts, the development seed's deterministic sealing, the environment's key rules.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEV_HMAC_KEY } from '@mig/domain/store/devKeys';
import { aesPiiCrypto, devAesPiiCrypto, DEV_PII_KEY, parsePiiKeys } from '@mig/domain/store/piiAes';
import { readEnv } from './env';

const k1 = new Uint8Array(randomBytes(32));
const k2 = new Uint8Array(randomBytes(32));
const b64 = (k: Uint8Array) => Buffer.from(k).toString('base64');

describe('PII crypto (AES-256-GCM)', () => {
  it('seals and opens; the ciphertext holds no plaintext and differs every time', async () => {
    const c = aesPiiCrypto({ keys: new Map([[1, k1]]), current: 1, hmacKey: 'h'.repeat(32) });
    const a = await c.seal('31234567890123');
    const b = await c.seal('31234567890123');
    expect(a.keyVer).toBe(1);
    expect(Buffer.from(a.enc).toString('latin1')).not.toContain('31234567890123');
    expect(Buffer.from(a.enc).equals(Buffer.from(b.enc))).toBe(false);
    expect(await c.open(a.enc, 1)).toBe('31234567890123');
    expect(await c.open(b.enc, 1)).toBe('31234567890123');
  });

  it('the search HMAC is stable, keyed, and different from another key', async () => {
    const c = aesPiiCrypto({ keys: new Map([[1, k1]]), current: 1, hmacKey: 'h'.repeat(32) });
    const other = aesPiiCrypto({ keys: new Map([[1, k1]]), current: 1, hmacKey: 'g'.repeat(32) });
    const h1 = await c.hmac('+998900000001');
    expect(Buffer.from(h1).equals(Buffer.from(await c.hmac('+998900000001')))).toBe(true);
    expect(Buffer.from(h1).equals(Buffer.from(await c.hmac('+998900000002')))).toBe(false);
    expect(Buffer.from(h1).equals(Buffer.from(await other.hmac('+998900000001')))).toBe(false);
  });

  it('rotation: values of the old key version stay readable, new ones take the current version', async () => {
    const before = aesPiiCrypto({ keys: new Map([[1, k1]]), current: 1, hmacKey: DEV_HMAC_KEY });
    const old = await before.seal('old value');
    const after = aesPiiCrypto({
      keys: new Map([
        [1, k1],
        [2, k2],
      ]),
      current: 2,
      hmacKey: DEV_HMAC_KEY,
    });
    expect(await after.open(old.enc, old.keyVer)).toBe('old value');
    const fresh = await after.seal('new value');
    expect(fresh.keyVer).toBe(2);
    expect(await after.open(fresh.enc, 2)).toBe('new value');
    // Without the old key the old value is unreadable, never silently wrong.
    const only2 = aesPiiCrypto({ keys: new Map([[2, k2]]), current: 2, hmacKey: DEV_HMAC_KEY });
    await expect(only2.open(old.enc, 1)).rejects.toThrow(/key version 1/);
  });

  it('refuses tampered ciphertexts and plaintext version 0 unless allowed (development only)', async () => {
    const c = aesPiiCrypto({ keys: new Map([[1, k1]]), current: 1, hmacKey: DEV_HMAC_KEY });
    const s = await c.seal('31234567890123');
    const bad = s.enc.slice();
    bad[bad.length - 20] = bad[bad.length - 20]! ^ 1;
    await expect(c.open(bad, 1)).rejects.toThrow();
    await expect(c.open(new TextEncoder().encode('31234567890123'), 0)).rejects.toThrow(/key version 0/);
    const dev = aesPiiCrypto({
      keys: new Map([[1, k1]]),
      current: 1,
      hmacKey: DEV_HMAC_KEY,
      allowPlaintextV0: true,
    });
    expect(await dev.open(new TextEncoder().encode('31234567890123'), 0)).toBe('31234567890123');
  });

  it('the development seed is sealed deterministically with the published development key', () => {
    const a = devAesPiiCrypto({ deterministic: true });
    const x = a.sealSync('31234567890123', 'insured.pinfl');
    expect(Buffer.from(a.sealSync('31234567890123', 'insured.pinfl').enc).equals(Buffer.from(x.enc))).toBe(
      true,
    );
    expect(Buffer.from(a.sealSync('31234567890123', 'insured.phone').enc).equals(Buffer.from(x.enc))).toBe(
      false,
    );
    expect(devAesPiiCrypto().openSync(x.enc, x.keyVer)).toBe('31234567890123');
  });

  it('PII_KEYS: versions and 32-byte keys only', () => {
    expect([...parsePiiKeys(`1:${b64(k1)}, 2:${b64(k2)}`).keys()]).toEqual([1, 2]);
    expect(() => parsePiiKeys('1:c2hvcnQ=')).toThrow(/32 bytes/);
    expect(() => parsePiiKeys(`x:${b64(k1)}`)).toThrow();
    expect(() => parsePiiKeys(`1:${b64(k1)},1:${b64(k2)}`)).toThrow(/twice/);
  });
});

describe('environment (production refuses development secrets)', () => {
  const prod = {
    APP_ENV: 'production',
    DATABASE_URL: 'postgresql://x@db/postgres',
    SUPABASE_URL: 'http://kong:8000',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    PII_KEYS: `3:${b64(k1)},4:${b64(k2)}`,
    PII_KEY_CURRENT: '4',
    PII_HMAC_KEY: 'p'.repeat(40),
    SESSION_SECRET: 's'.repeat(48),
    SMS_HOOK_SECRET: `v1,whsec_${Buffer.from('q'.repeat(32)).toString('base64')}`,
    SMTP_HOST: 'smtp.mig.uz',
    SMTP_FROM: 'MIG DMS <noreply@mig.uz>',
    INVITE_REDIRECT_URL: 'https://dms.mig.uz/',
  };

  it('starts with real secrets: no demo, no test MFA, no bearer path; plaintext version 0 refused', async () => {
    const env = readEnv(prod);
    expect(env.demo).toBe(false);
    expect(env.testTotp).toBe(false);
    expect('bearerCompat' in env).toBe(false);
    expect(env.demoPassword).toBeUndefined();
    expect(env.smtp).toEqual({ host: 'smtp.mig.uz', port: 587, tls: 'starttls', from: 'MIG DMS <noreply@mig.uz>' });
    expect(readEnv({ ...prod, SMTP_TLS: 'tls', SMTP_PORT: '', SMTP_USER: 'u', SMTP_PASS: 'p' }).smtp).toMatchObject({ port: 465, tls: 'tls', user: 'u', pass: 'p' });
    expect((await env.crypto.seal('x')).keyVer).toBe(4);
    await expect(env.crypto.open(new TextEncoder().encode('x'), 0)).rejects.toThrow();
  });

  it.each([
    ['without PII_KEYS', { PII_KEYS: '' }],
    ['with the development PII key', { PII_KEYS: `1:${b64(DEV_PII_KEY)}`, PII_KEY_CURRENT: '1' }],
    ['with the development HMAC key', { PII_HMAC_KEY: DEV_HMAC_KEY }],
    ['without SESSION_SECRET', { SESSION_SECRET: '' }],
    [
      'with the development SMS hook secret',
      { SMS_HOOK_SECRET: 'v1,whsec_bWlnLWRtcyBkZXYtb25seSBzbXMgaG9vayBzZWNyZXQ=' },
    ],
    ['with DEMO_PASSWORD', { DEMO_PASSWORD: 'Demo-2026!' }],
    ['with the bearer path', { AUTH_BEARER_COMPAT: '1' }],
    ['with the insecure development cookie', { INSECURE_DEV_COOKIE: '1' }],
    ['without the Supabase service key', { SUPABASE_SERVICE_ROLE_KEY: '' }],
    ['without SMTP (invitation e-mails)', { SMTP_HOST: '' }],
    ['with SMTP without TLS', { SMTP_TLS: 'none' }],
    ['without the sender of e-mails', { SMTP_FROM: '' }],
    ['without the https address of the portal', { INVITE_REDIRECT_URL: 'http://dms.mig.uz/' }],
  ])('refuses to start %s', (_label, patch) => {
    expect(() => readEnv({ ...prod, ...patch })).toThrow();
  });

  it('the test TOTP code 000000 is off unless ALLOW_TEST_TOTP=true, and refused with APP_ENV or NODE_ENV production', () => {
    const base = { DATABASE_URL: 'x', SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    expect(readEnv({ ...base, APP_ENV: 'staging' }).testTotp).toBe(false);
    expect(readEnv({ ...base, APP_ENV: 'ci', ALLOW_TEST_TOTP: '1' }).testTotp).toBe(false);
    expect(readEnv({ ...base, APP_ENV: 'staging', ALLOW_TEST_TOTP: 'true' }).testTotp).toBe(true);
    expect(() => readEnv({ ...prod, ALLOW_TEST_TOTP: 'true' })).toThrow(/ALLOW_TEST_TOTP/);
    expect(() => readEnv({ ...base, APP_ENV: 'staging', NODE_ENV: 'production', ALLOW_TEST_TOTP: 'true' })).toThrow(/ALLOW_TEST_TOTP/);
    expect(readEnv({ ...base, APP_ENV: 'staging', NODE_ENV: 'production' }).testTotp).toBe(false);
  });

  it('development and ci: development keys and the demo switches', () => {
    const env = readEnv({
      APP_ENV: 'ci',
      DATABASE_URL: 'postgresql://x@db/postgres',
      SUPABASE_URL: 'http://kong:8000',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      DEMO_PASSWORD: 'Demo-2026!',
    });
    expect(env.demo).toBe(true);
    expect(env.demoPassword).toBe('Demo-2026!');
    // The bearer path of step 4 is gone (the web app uses the cookie): a leftover switch stops the start everywhere.
    for (const APP_ENV of ['development', 'ci', 'staging'])
      expect(() =>
        readEnv({
          APP_ENV,
          DATABASE_URL: 'x',
          SUPABASE_URL: 'x',
          SUPABASE_SERVICE_ROLE_KEY: 'k',
          AUTH_BEARER_COMPAT: '1',
        }),
      ).toThrow(/AUTH_BEARER_COMPAT/);
  });
});
