/* Central logger. Scrubs PII before anything reaches the console. */

const SENSITIVE_KEY = /pinfl|phone|email|birth|passport|card|diagnos|token|session|password/i;
const PINFL_RE = /\b\d{14}\b/g;
const PHONE_RE = /(?:\+?998[\s-]?)?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const REDACTED = '[redacted]';

export function redactString(s: string): string {
  return s.replace(PINFL_RE, REDACTED).replace(EMAIL_RE, REDACTED).replace(PHONE_RE, REDACTED);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, message: string, data?: unknown): void {
  if (level === 'info' && import.meta.env.PROD) return;
  const args: unknown[] = [`[mig] ${redactString(message)}`];
  if (data !== undefined) args.push(redact(data));
  console[level](...args);
}

export const logger = {
  info: (message: string, data?: unknown) => emit('info', message, data),
  warn: (message: string, data?: unknown) => emit('warn', message, data),
  error: (message: string, data?: unknown) => emit('error', message, data),
};
