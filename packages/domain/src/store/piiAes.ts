/*
 * AES-256-GCM protection of personal data (BACKEND_SPEC §5) with Node's `crypto`: the API and the seed
 * generator (scripts, tests) only — the browser never imports this module.
 *
 * - A ciphertext is `iv (12 bytes) ‖ ciphertext ‖ tag (16 bytes)`; the key version is stored next to it
 *   (`*_key_ver`), so rotation is a new version in `PII_KEYS` and `PII_KEY_CURRENT`: new values are sealed with
 *   the current key, old ones stay readable while their key is configured.
 * - The search hash is HMAC-SHA-256 under a separate key (`*_hmac`).
 * - Key version 0 is the plaintext of the old development seed: readable only when `allowPlaintextV0` is set
 *   (development), never in production.
 * - `deterministic`: the IV is derived from the value (HMAC of the key over the context and the plaintext). Only
 *   the generated development seed uses it, so `supabase/seed.sql` is stable; the API always uses random IVs.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { PiiCrypto } from './pii';
import { DEV_HMAC_KEY } from './devKeys';

const IV = 12;
const TAG = 16;

export interface AesPiiOptions {
  /** Key version → 32-byte key. */
  keys: ReadonlyMap<number, Uint8Array>;
  /** The version new values are sealed with. */
  current: number;
  /** The HMAC key of the search hashes. */
  hmacKey: Uint8Array | string;
  /** DEV ONLY: read key version 0 as plaintext (databases loaded from the old plaintext seed). */
  allowPlaintextV0?: boolean;
  /** SEED ONLY: IVs derived from the value, so the generated seed is byte-for-byte stable. */
  deterministic?: boolean;
}

/** A PiiCrypto with synchronous variants (the seed generator builds SQL text synchronously). */
export interface AesPiiCrypto extends PiiCrypto {
  sealSync(plain: string, context?: string): { enc: Uint8Array; keyVer: number };
  openSync(enc: Uint8Array, keyVer: number): string;
  hmacSync(plain: string): Uint8Array;
}

/**
 * DEV/CI ONLY: the published development key (version 1) of the generated seed and of local and CI
 * deployments without `PII_KEYS`. Production refuses to start with it (apps/api/src/env.ts).
 */
export const DEV_PII_KEY_VERSION = 1;
export const DEV_PII_KEY: Uint8Array = new Uint8Array(
  createHash('sha256').update('mig-dms dev-only personal data key v1 (not a secret)').digest(),
);

export function aesPiiCrypto(o: AesPiiOptions): AesPiiCrypto {
  const current = o.keys.get(o.current);
  if (!current || current.length !== 32)
    throw new Error(`PII key version ${o.current} is missing or not 32 bytes`);
  for (const [v, k] of o.keys) {
    if (!Number.isInteger(v) || v < 1 || v > 32767) throw new Error(`PII key version ${v}: must be 1…32767`);
    if (k.length !== 32) throw new Error(`PII key version ${v} is not 32 bytes`);
  }
  const hmacKey = typeof o.hmacKey === 'string' ? Buffer.from(o.hmacKey, 'utf8') : Buffer.from(o.hmacKey);

  const sealSync = (plain: string, context = ''): { enc: Uint8Array; keyVer: number } => {
    const iv = o.deterministic
      ? createHmac('sha256', current).update(`${context}\u0000${plain}`, 'utf8').digest().subarray(0, IV)
      : randomBytes(IV);
    const cipher = createCipheriv('aes-256-gcm', current, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { enc: new Uint8Array(Buffer.concat([iv, body, cipher.getAuthTag()])), keyVer: o.current };
  };

  const openSync = (enc: Uint8Array, keyVer: number): string => {
    if (keyVer === 0) {
      if (!o.allowPlaintextV0)
        throw new Error('Personal data stored without encryption (key version 0) is refused here');
      return Buffer.from(enc).toString('utf8');
    }
    const key = o.keys.get(keyVer);
    if (!key) throw new Error(`No key for personal data key version ${keyVer}`);
    if (enc.length < IV + TAG) throw new Error('Ciphertext too short');
    const b = Buffer.from(enc);
    const decipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, IV));
    decipher.setAuthTag(b.subarray(b.length - TAG));
    return Buffer.concat([decipher.update(b.subarray(IV, b.length - TAG)), decipher.final()]).toString(
      'utf8',
    );
  };

  const hmacSync = (plain: string): Uint8Array =>
    new Uint8Array(createHmac('sha256', hmacKey).update(plain, 'utf8').digest());

  return {
    sealSync,
    openSync,
    hmacSync,
    seal: async (plain) => sealSync(plain),
    open: async (enc, keyVer) => openSync(enc, keyVer),
    hmac: async (plain) => hmacSync(plain),
  };
}

/** DEV/CI ONLY: the development keys (the generated seed is sealed with them). */
export function devAesPiiCrypto(
  o: { deterministic?: boolean; allowPlaintextV0?: boolean } = {},
): AesPiiCrypto {
  return aesPiiCrypto({
    keys: new Map([[DEV_PII_KEY_VERSION, DEV_PII_KEY]]),
    current: DEV_PII_KEY_VERSION,
    hmacKey: DEV_HMAC_KEY,
    ...o,
  });
}

/**
 * `PII_KEYS=1:<base64>,2:<base64>` → version → key. Every key must be 32 bytes (AES-256).
 */
export function parsePiiKeys(spec: string): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (const part of spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = /^(\d{1,5}):([A-Za-z0-9+/=_-]+)$/.exec(part);
    if (!m) throw new Error('PII_KEYS: expected «<version>:<base64 of 32 bytes>», comma-separated');
    const ver = Number(m[1]);
    if (out.has(ver)) throw new Error(`PII_KEYS: version ${ver} twice`);
    const key = new Uint8Array(Buffer.from(m[2]!, 'base64'));
    if (key.length !== 32) throw new Error(`PII_KEYS: version ${ver} is not 32 bytes`);
    out.set(ver, key);
  }
  return out;
}

/** Constant-time equality of two keys (production refuses the published development keys). */
export function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
