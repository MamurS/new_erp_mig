/*
 * Verification of Supabase Auth access tokens (BACKEND_SPEC §7: the claims of a request come from the verified
 * token). Asymmetric keys (ES256, RS256) come from the JWKS of Supabase Auth (`/auth/v1/.well-known/jwks.json`),
 * cached by key id; HS256 tokens need the JWT secret (`SUPABASE_JWT_SECRET`, self-hosted stacks with a shared
 * secret). Node `crypto` only, no dependency.
 */
import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

export interface AccessClaims {
  sub: string;
  aal?: 'aal1' | 'aal2';
  exp: number;
  iat?: number;
  aud?: string | string[];
  role?: string;
  session_id?: string;
  app_metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

export class InvalidToken extends Error {
  constructor(why: string) {
    super(`Invalid access token: ${why}`);
    this.name = 'InvalidToken';
  }
}

const b64 = (s: string) => Buffer.from(s, 'base64url');

/** The payload of a JWT without verifying it (only to read what the caller will verify anyway). */
export function peekJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64(parts[1]!).toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface JwtVerifierOptions {
  /** `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` */
  jwksUrl: string;
  /** HS256 secret (optional). */
  secret?: string;
  /** Expected audience. */
  audience?: string;
  fetch?: typeof fetch;
  /** Real time (seconds) — token expiry is not moved by the services' test clock. */
  nowSec?: () => number;
}

export class JwtVerifier {
  private keys = new Map<string, KeyObject>();
  private lastFetch = 0;

  constructor(private readonly o: JwtVerifierOptions) {}

  private async key(kid: string | undefined, alg: string): Promise<KeyObject> {
    const cached = kid ? this.keys.get(kid) : undefined;
    if (cached) return cached;
    // Unknown key id: the keys may have rotated; fetch at most once in 30 s.
    if (Date.now() - this.lastFetch > 30_000 || this.keys.size === 0) {
      this.lastFetch = Date.now();
      const r = await (this.o.fetch ?? fetch)(this.o.jwksUrl);
      if (!r.ok) throw new InvalidToken(`JWKS ${r.status}`);
      const { keys } = (await r.json()) as { keys: (JsonWebKey & { kid?: string; alg?: string })[] };
      for (const k of keys) if (k.kid) this.keys.set(k.kid, createPublicKey({ key: k, format: 'jwk' }));
    }
    const k = kid ? this.keys.get(kid) : [...this.keys.values()][0];
    if (!k) throw new InvalidToken(`no key ${kid ?? ''} for ${alg}`);
    return k;
  }

  async verify(token: string): Promise<AccessClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new InvalidToken('format');
    let header: { alg?: string; kid?: string };
    let claims: AccessClaims;
    try {
      header = JSON.parse(b64(parts[0]!).toString('utf8')) as typeof header;
      claims = JSON.parse(b64(parts[1]!).toString('utf8')) as AccessClaims;
    } catch {
      throw new InvalidToken('encoding');
    }
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const sig = b64(parts[2]!);
    if (header.alg === 'HS256') {
      if (!this.o.secret) throw new InvalidToken('HS256 without SUPABASE_JWT_SECRET');
      const expected = createHmac('sha256', this.o.secret).update(data).digest();
      if (expected.length !== sig.length || !timingSafeEqual(expected, sig))
        throw new InvalidToken('signature');
    } else if (header.alg === 'ES256' || header.alg === 'RS256') {
      const key = await this.key(header.kid, header.alg);
      const ok =
        header.alg === 'ES256'
          ? verifySignature('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig)
          : verifySignature('sha256', data, key, sig);
      if (!ok) throw new InvalidToken('signature');
    } else {
      throw new InvalidToken(`algorithm ${String(header.alg)}`);
    }
    const now = this.o.nowSec?.() ?? Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= now) throw new InvalidToken('expired');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new InvalidToken('subject');
    const aud = this.o.audience ?? 'authenticated';
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) throw new InvalidToken('audience');
    return claims;
  }
}
