/*
 * TEST HELPER: the e-mails Mailpit caught (docker-compose.test.yml). MAILPIT_URL is its HTTP API (ci:
 * http://127.0.0.1:8025); the SMTP is on port 1025 of the same host.
 */
export const MAILPIT_URL = process.env.MAILPIT_URL ?? '';
export const hasMailpit = MAILPIT_URL !== '';

/** The SMTP of Mailpit (no TLS, no auth). */
export function mailpitSmtp(): { host: string; port: number; tls: 'none'; from: string } {
  return { host: new URL(MAILPIT_URL).hostname, port: Number(process.env.MAILPIT_SMTP_PORT ?? 1025), tls: 'none', from: 'MIG DMS <noreply@mig.test>' };
}

interface Summary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

/** The texts of the e-mails to `to`, newest first. */
export async function mailsTo(to: string): Promise<{ subject: string; text: string }[]> {
  const r = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`);
  if (!r.ok) throw new Error(`Mailpit search: ${r.status}`);
  const { messages } = (await r.json()) as { messages: Summary[] };
  const out: { subject: string; text: string }[] = [];
  for (const m of messages.filter((x) => x.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()))) {
    const full = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${m.ID}`)).json()) as { Subject: string; Text: string };
    out.push({ subject: full.Subject, text: full.Text });
  }
  return out;
}

/** The token of the newest invitation e-mail to `to` (the fragment of its `/invite#…` link). */
export async function invitationToken(to: string): Promise<string> {
  const [m] = await mailsTo(to);
  const token = m && /\/invite#([A-Za-z0-9_-]+)/.exec(m.text)?.[1];
  if (!token) throw new Error(`no invitation e-mail to ${to}`);
  return token;
}
