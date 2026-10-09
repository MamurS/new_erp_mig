/*
 * The mock's mail: invitation e-mails land here instead of an SMTP server (the API sends them through the SMTP of
 * MIG, Mailpit in ci). In memory only, the newest 50; the demo route `GET /__demo/outbox` shows them (e2e, demos).
 */
import type { Mailer, MailMessage } from '@mig/domain/services/system/invitations';

export const outbox: MailMessage[] = [];

export const mockMailer: Mailer = {
  async send(m) {
    outbox.push(m);
    if (outbox.length > 50) outbox.shift();
  },
};

/** Where the links of the e-mails lead: the page's own origin (the tests: a fixed one). */
export const mailBaseUrl = (): string => (typeof location !== 'undefined' ? location.origin : 'http://localhost');
