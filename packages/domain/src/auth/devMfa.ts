/*
 * DEV/CI/STAGING ONLY — the test MFA mode (BACKEND_SPEC §7, §12.3). The demo accounts get a verified TOTP
 * factor in Supabase Auth whose secret is derived from the account id with a published development key, so the
 * API can turn the demo code `000000` into the current TOTP code of that factor and verify it with Supabase
 * Auth like any other code. Production never derives secrets (no test mode there: apps/api/src/env.ts).
 *
 * Node only (the seed generator and the API).
 */
import { createHash, createHmac } from 'node:crypto';
import { DEV_TOTP_KEY } from '../store/devKeys';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** The TOTP secret (base32, 160 bits) of a demo account's factor. */
export function devTotpSecret(userId: string): string {
  return base32(createHmac('sha256', DEV_TOTP_KEY).update(`totp:${userId}`).digest().subarray(0, 20));
}

/** A stable UUID v4 for a demo account's factor (the seed is deterministic). */
export function devFactorId(userId: string): string {
  const h = createHash('sha256').update(`factor:${userId}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), as Supabase Auth verifies it. */
export function totpCode(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', Buffer.from(fromBase32(secretBase32)))
    .update(msg)
    .digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}
