/*
 * Application-level protection of personal data in Postgres (BACKEND_SPEC §5): ciphertext with a key
 * version, a search HMAC under a separate key, and the mask the API writes next to them. The repositories
 * (postgres.ts) depend on this interface only.
 *
 * Step 4, part 1 ships the development implementation (`devPiiCrypto`), which matches what
 * `supabase/seed.sql` writes: plaintext bytes with key version 0 and HMAC-SHA-256 under DEV_HMAC_KEY.
 * Part 2 replaces it with AES-256-GCM and keys from the environment (key version ≥ 1); key version 0 must
 * not exist in a real environment.
 */
import { maskPhone, maskPinfl } from '../lib/mask';
import { DEV_HMAC_KEY } from './sql/seed';

export interface PiiCrypto {
  /** Ciphertext and key version of a value. */
  seal(plain: string): Promise<{ enc: Uint8Array; keyVer: number }>;
  /** The value of a ciphertext. */
  open(enc: Uint8Array, keyVer: number): Promise<string>;
  /** Search hash (equality lookups by PINFL and phone). */
  hmac(plain: string): Promise<Uint8Array>;
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

/** HMAC-SHA-256 with WebCrypto (Node 20 and browsers alike). */
export function hmacSha256(key: string): (plain: string) => Promise<Uint8Array> {
  let k: ReturnType<typeof crypto.subtle.importKey> | null = null;
  return async (plain) => {
    k ??= crypto.subtle.importKey('raw', utf8.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', await k, utf8.encode(plain)));
  };
}

/**
 * DEV/CI ONLY: «encryption» with key version 0 (plaintext bytes) and the development HMAC key, exactly as
 * the generated seed stores identity data. Refuses ciphertexts of other key versions.
 */
export function devPiiCrypto(hmacKey: string = DEV_HMAC_KEY): PiiCrypto {
  const hmac = hmacSha256(hmacKey);
  return {
    async seal(plain) {
      return { enc: utf8.encode(plain), keyVer: 0 };
    },
    async open(enc, keyVer) {
      if (keyVer !== 0) throw new Error(`No key for personal data key version ${keyVer}`);
      return fromUtf8.decode(enc);
    },
    hmac,
  };
}

/** The mask stored next to an identity field (`<field>_mask`), the same as the seed and the services show. */
export function piiMask(field: string, plain: string): string {
  return field === 'phone' ? maskPhone(plain) : maskPinfl(plain);
}
