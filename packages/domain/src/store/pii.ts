/*
 * Application-level protection of personal data in Postgres (BACKEND_SPEC §5): ciphertext with a key
 * version, a search HMAC under a separate key, and the mask the API writes next to them. The repositories
 * (postgres.ts) depend on this interface only.
 *
 * The implementation is AES-256-GCM with keys from the environment (store/piiAes.ts, Node only): the API reads
 * `PII_KEYS`/`PII_KEY_CURRENT`/`PII_HMAC_KEY`; development and CI use the published development key the
 * generated seed is sealed with. Key version 0 (plaintext of the old development seed) is refused in production.
 */
import { maskPhone, maskPinfl } from '../lib/mask';

export interface PiiCrypto {
  /** Ciphertext and key version of a value. */
  seal(plain: string): Promise<{ enc: Uint8Array; keyVer: number }>;
  /** The value of a ciphertext. */
  open(enc: Uint8Array, keyVer: number): Promise<string>;
  /** Search hash (equality lookups by PINFL and phone). */
  hmac(plain: string): Promise<Uint8Array>;
}

/** The mask stored next to an identity field (`<field>_mask`), the same as the seed and the services show. */
export function piiMask(field: string, plain: string): string {
  return field === 'phone' ? maskPhone(plain) : maskPinfl(plain);
}
