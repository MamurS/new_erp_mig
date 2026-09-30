/*
 * Webhook signatures (CLINIC_SPEC §6.4): `MIG-Signature: t={unix},v1={hex}`,
 * v1 = HMAC-SHA256(secret, "{t}.{raw_body}"). WebCrypto only — works in the browser, the mock and Node.
 */
const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

export const SIGNATURE_HEADER = 'MIG-Signature';
/** Receivers reject events older than this (replay protection). */
export const SIGNATURE_TOLERANCE_SEC = 5 * 60;

export async function signWebhook(secret: string, rawBody: string, unixTime: number): Promise<string> {
  const v1 = await hmacSha256Hex(secret, `${unixTime}.${rawBody}`);
  return `t=${unixTime},v1=${v1}`;
}

export function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k = '', ...v] = p.trim().split('=');
      return [k, v.join('=')];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return null;
  return { t, v1: parts.v1! };
}

/** Constant-time comparison of two hex strings of equal length. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhook(secret: string, header: string, rawBody: string, nowUnix: number, toleranceSec = SIGNATURE_TOLERANCE_SEC): Promise<boolean> {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(nowUnix - parsed.t) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${parsed.t}.${rawBody}`);
  return safeEqual(expected, parsed.v1);
}
