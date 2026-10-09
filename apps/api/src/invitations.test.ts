/*
 * Invitations end to end against the local stack (stage 1.5): an account created in the portal gets an e-mail through
 * SMTP (Mailpit of docker-compose.test.yml), the link sets the password in Supabase Auth once, the first sign-in
 * enrols a TOTP authenticator, a resend revokes the old link, an expired link is refused.
 *
 * Needs DATABASE_URL, the Supabase stack and MAILPIT_URL (CI job `api`); skipped otherwise.
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpCode } from '@mig/domain/auth/devMfa';
import { sha256Hex } from '@mig/domain/lib/webhook';
import { devAesPiiCrypto } from '@mig/domain/store/piiAes';
import { DEMO_PASSWORD } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { buildApp } from './app';
import { gotrueCredentials } from './auth/credentials';
import { SESSION_COOKIE } from './auth/cookies';
import { createWorker, type Worker } from './jobs/worker';
import { smtpMailer } from './mail/smtp';
import { hasMailpit, invitationToken, mailpitSmtp, mailsTo } from './test/mailpit';
import { hasSupabase, testBff, testStack, type TestStack } from './test/supabase';
import { cookieOf, fastifyClient, hasDb, loadSeed, signIn, testDeps, testPool, type Client } from './test/support';

const PASSWORD = 'Novyi-parol-2026';
const unique = () => `invite.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@demo.mig.uz`;

describe.skipIf(!hasDb || !hasSupabase || !hasMailpit)('invitations by e-mail', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let api: Client;
  let stack: TestStack;
  let worker: Worker;
  let admin: string;
  const crypto = devAesPiiCrypto();

  beforeAll(async () => {
    pool = testPool();
    await loadSeed(pool, createSeed({ now: Date.now() }));
    stack = testStack(pool, crypto);
    app = await buildApp({
      pool,
      crypto,
      deps: testDeps(),
      auth: testBff(pool, crypto, stack),
      storage: stack.storage,
      credentials: gotrueCredentials(stack.gotrue, stack.identity),
    });
    api = fastifyClient(app, { cookie: SESSION_COOKIE });
    worker = createWorker({ pool, crypto, identity: stack.identity, mail: { mailer: smtpMailer(mailpitSmtp()), baseUrl: 'https://dms.example/' } });
    admin = await signIn(api, { email: 'admin@demo.mig.uz' }, SESSION_COOKIE);
  });

  afterAll(async () => {
    await worker?.stop();
    await app?.close();
    await pool?.end();
  });

  async function invite(email: string): Promise<string> {
    const r = await api.call('POST', '/admin/users', { session: admin, body: { fullName: 'Karimov Aziz Bahodirovich', email, role: 'operator' } });
    expect(r.status).toBe(201);
    expect((r.body as { invitation?: { status: string } }).invitation?.status).toBe('pending');
    return (r.body as { id: string }).id;
  }
  const accept = (token: string, password = PASSWORD) => api.call('POST', '/auth/invitation/accept', { body: { token, password, confirm: password } });

  it('the e-mail leaves once through SMTP; the link sets the password; the first sign-in enrols TOTP', async () => {
    const email = unique();
    const id = await invite(email);
    const pass = await worker.tick();
    expect(pass.invitations).toEqual({ sent: 1, failed: 0 });
    expect((await worker.tick()).invitations).toEqual({ sent: 0, failed: 0 });
    const mails = await mailsTo(email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toContain('Mosaic Insurance Group');
    const token = await invitationToken(email);
    expect(mails[0]!.text).toContain(`https://dms.example/invite#${token}`);
    // At rest: the hash only; the sealed token is gone once the e-mail left.
    const { rows } = await pool.query(`select token_hash, token_enc, sent_at from app.invitations where user_id = $1::uuid`, [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token_hash: await sha256Hex(token), token_enc: null });
    expect(rows[0].sent_at).not.toBeNull();

    const check = await api.call('POST', '/auth/invitation', { body: { token } });
    expect(check.status).toBe(200);
    expect((check.body as { email: string }).email).not.toContain(email.split('@')[0]);
    expect((await accept(token, 'short1')).status).toBe(422);
    expect((await accept(token)).status).toBe(200);
    expect((await accept(token)).status).toBe(409);

    // The demo password and the demo factor are gone: the new password, then a real authenticator.
    expect((await api.call('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } })).status).toBe(401);
    const login = await api.call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(login.status).toBe(200);
    const { challengeId, totpEnrollment } = login.body as { challengeId: string; totpEnrollment?: { secret: string; uri: string } };
    expect(totpEnrollment?.uri).toMatch(/^otpauth:\/\/totp\//);
    expect((await api.call('POST', '/auth/otp', { body: { challengeId, code: '000000' } })).status).toBe(401);
    const done = await api.call('POST', '/auth/otp', { body: { challengeId, code: totpCode(totpEnrollment!.secret) } });
    expect(done.status).toBe(200);
    const sid = cookieOf(done, SESSION_COOKIE)!;
    expect((await api.call('GET', '/auth/me', { session: sid })).body).toMatchObject({ id, role: 'operator' });

    const audit = await pool.query(`select action from public.audit_log where target_id = $1 order by at`, [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['invitation_sent', 'invitation_accepted']));
    const users = (await api.call('GET', '/admin/users', { session: admin })).body as { id: string; invitation?: unknown }[];
    expect(users.find((u) => u.id === id)?.invitation).toBeUndefined();
  });

  it('«Отправить повторно»: a new e-mail, the old link stops working', async () => {
    const email = unique();
    const id = await invite(email);
    await worker.tick();
    const first = await invitationToken(email);
    const again = await api.call('POST', `/invitations/${id}/resend`, { session: admin });
    expect(again.status).toBe(200);
    expect((await worker.tick()).invitations?.sent).toBe(1);
    const second = await invitationToken(email);
    expect(second).not.toBe(first);
    expect((await api.call('POST', '/auth/invitation', { body: { token: first } })).status).toBe(404);
    expect((await api.call('POST', '/auth/invitation', { body: { token: second } })).status).toBe(200);
    const list = (await api.call('GET', '/invitations', { session: admin })).body as { userId: string; portal: string }[];
    expect(list.find((x) => x.userId === id)).toMatchObject({ portal: 'staff' });
    const operator = await signIn(api, { email: 'operator@demo.mig.uz' }, SESSION_COOKIE);
    expect((await api.call('GET', '/invitations', { session: operator })).status).toBe(404);
    expect((await api.call('POST', `/invitations/${id}/resend`, { session: operator })).status).toBe(404);
  });

  it('an expired link is refused and its e-mail is not sent any more', async () => {
    const email = unique();
    const id = await invite(email);
    await pool.query(`update app.invitations set created_at = now() - interval '4 days', expires_at = now() - interval '1 second' where user_id = $1::uuid`, [id]);
    expect((await worker.tick()).invitations?.sent).toBe(0);
    expect(await mailsTo(email)).toHaveLength(0);
    const users = (await api.call('GET', '/admin/users', { session: admin })).body as { id: string; invitation?: { status: string } }[];
    expect(users.find((u) => u.id === id)?.invitation?.status).toBe('expired');
    // A resend gives a working link again.
    expect((await api.call('POST', `/invitations/${id}/resend`, { session: admin })).status).toBe(200);
    await worker.tick();
    const token = await invitationToken(email);
    const expired = await pool.query(`select count(*)::int as n from app.invitations where user_id = $1::uuid and revoked_at is not null`, [id]);
    expect(expired.rows[0].n).toBe(1);
    expect((await accept(token)).status).toBe(200);
  });
});
