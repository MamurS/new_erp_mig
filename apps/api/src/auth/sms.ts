/*
 * SMS of one-time codes (BACKEND_SPEC §7): Supabase Auth generates the code and calls its «Send SMS» Auth Hook,
 * which is this API's endpoint `POST /api/hooks/send-sms`; the API checks the hook's signature (Standard
 * Webhooks, the secret `v1,whsec_…` shared with Supabase Auth) and hands the text to the SMS adapter.
 *
 * Stage 1 ships the `log` adapter: it writes to the development log that an SMS went out — with the code only
 * outside production. A real provider (stage 2) is one more `SmsSender`:
 *
 *   export const myProvider: SmsSender = { name: 'my-provider', async send(phone, text) { ...HTTP call... } };
 *
 * registered in `smsSender()` below under a name, selected with `SMS_PROVIDER=<name>`, its credentials read from
 * the environment there (README «API (бэкенд)»). Supabase Auth itself needs no provider settings for it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { translate } from '@mig/i18n';

export interface SmsSender {
  name: string;
  /** Sends `text` to `phone` (E.164 digits); throws when the provider refuses. */
  send(phone: string, text: string): Promise<void>;
}

export interface SmsLog {
  (msg: string, data: Record<string, unknown>): void;
}

/** DEV/CI: the development log; the code itself only outside production. */
export function logSms(o: {
  revealCodes: boolean;
  log: SmsLog;
}): SmsSender & { sent: { phone: string; text: string }[] } {
  const sent: { phone: string; text: string }[] = [];
  return {
    name: 'log',
    sent,
    async send(phone, text) {
      if (o.revealCodes) {
        sent.push({ phone, text });
        if (sent.length > 100) sent.shift();
      }
      // The phone is masked even in the development log (CLAUDE.md: no personal data in logs).
      o.log('sms', { to: `…${phone.slice(-2)}`, ...(o.revealCodes ? { text } : { length: text.length }) });
    },
  };
}

/** The adapter named by SMS_PROVIDER. */
export function smsSender(name: string, o: { revealCodes: boolean; log: SmsLog }): SmsSender {
  switch (name) {
    case 'log':
      return logSms(o);
    default:
      throw new Error(`SMS_PROVIDER: unknown adapter ${name} (available: log)`);
  }
}

export class HookSignatureError extends Error {}

/**
 * Verifies a Standard Webhooks signature: `webhook-signature: v1,<base64 HMAC-SHA256(id.timestamp.body)>`
 * with the key from `v1,whsec_<base64>`; the timestamp must be within 5 minutes.
 */
export function verifyHook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSec = Math.floor(Date.now() / 1000),
): void {
  const key = Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
  if (!headers.id || !headers.timestamp || !headers.signature)
    throw new HookSignatureError('missing headers');
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) throw new HookSignatureError('timestamp');
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  const ok = headers.signature.split(' ').some((part) => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new HookSignatureError('signature');
}

/** Signs a hook body like Supabase Auth does (tests). */
export function signHook(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

/** The text of the code SMS (Russian: the language of the sign-in screen's default). */
export const smsText = (code: string): string => translate('ru', 'srv.auth.smsCode', { code });

/** Handles one call of the Send SMS hook: the body is `{ user: { phone }, sms: { otp, phone? } }`. */
export async function handleSendSmsHook(sender: SmsSender, body: unknown): Promise<void> {
  const b = body as { user?: { phone?: string }; sms?: { otp?: string; phone?: string } };
  const phone = String(b.sms?.phone || b.user?.phone || '').replace(/\D/g, '');
  const code = String(b.sms?.otp ?? '');
  if (!/^\d{9,15}$/.test(phone) || !/^\d{4,10}$/.test(code))
    throw new Error('send-sms hook: no phone or code');
  await sender.send(phone, smsText(code));
}
