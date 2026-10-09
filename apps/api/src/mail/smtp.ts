/*
 * The SMTP of MIG for invitation e-mails (stage 1.5). Plain-text messages only (nothing in them is interpreted); file
 * and URL access of nodemailer is off. SMTP_TLS: `starttls` (default, port 587), `tls` (implicit, 465) or `none`
 * (only outside production: Mailpit of ci and local development). Without SMTP_HOST outside production the e-mails
 * are only counted in the log (development; DEMO_PASSWORD accounts sign in without them).
 */
import nodemailer from 'nodemailer';
import type { Mailer } from '@mig/domain/services/system/invitations';

export interface SmtpConfig {
  host: string;
  port: number;
  tls: 'starttls' | 'tls' | 'none';
  user?: string;
  pass?: string;
  /** `MIG DMS <noreply@mig.uz>` */
  from: string;
}

export function smtpMailer(c: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.tls === 'tls',
    requireTLS: c.tls === 'starttls',
    ignoreTLS: c.tls === 'none',
    ...(c.user ? { auth: { user: c.user, pass: c.pass ?? '' } } : {}),
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(m) {
      await transport.sendMail({ from: c.from, to: m.to, subject: m.subject, text: m.text });
    },
  };
}

/** Development without SMTP: nothing leaves, the job only counts (the link is a secret: never logged). */
export function logMailer(log: (msg: string) => void): Mailer {
  return {
    async send() {
      log('invitation e-mail not sent: SMTP_HOST is not set (development)');
    },
  };
}

/** The mailer of the deployment: the SMTP of MIG, or (development without SMTP_HOST) the log. */
export function mailerOf(smtp: SmtpConfig | undefined, log: (msg: string) => void): Mailer {
  return smtp ? smtpMailer(smtp) : logMailer(log);
}

/** Where invitation links lead: INVITE_REDIRECT_URL (the portal of the deployment), the Vite dev server otherwise. */
export const inviteBaseUrl = (inviteRedirectTo: string | undefined): string => inviteRedirectTo ?? 'http://localhost:5173/';
