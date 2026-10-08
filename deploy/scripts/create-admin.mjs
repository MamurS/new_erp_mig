#!/usr/bin/env node
/*
 * The first administrator of a production deployment (no demo accounts there), and the emergency reset of an
 * administrator's password or second factor. Runs inside the API image (its DATABASE_URL, SUPABASE_URL and
 * service role key; `pg` from the image):
 *
 *   docker compose run --rm -T api node deploy/scripts/create-admin.mjs --email it-admin@mig.uz --name "Familiya Ism"
 *   docker compose run --rm -T api node deploy/scripts/create-admin.mjs --email … --reset-password
 *   docker compose run --rm -T api node deploy/scripts/create-admin.mjs --email … --reset-mfa
 *
 * Creating: the Supabase Auth user first (id = id of the `staff` row, e-mail confirmed, a one-time password,
 * app_metadata.role = admin), then the `staff` row and an audit record in one transaction — so the identity worker
 * finds the user and only syncs it (no invitation e-mail is needed). The password is printed ONCE: hand it over in
 * person; at the first sign-in the administrator connects the TOTP factor (QR on the code screen). Further
 * accounts are created by this administrator in the portal («Администрирование → Пользователи»): invitations.
 * --reset-password prints a new one-time password (any account with an e-mail: staff, HR, clinic, assistance — the
 * way to hand out access until the invitation screen exists, deploy/README.md §5); --reset-mfa removes the TOTP
 * factors (a new one is connected at the next sign-in). Both are written to the audit log.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = opt('--email')?.trim().toLowerCase();
const name = opt('--name')?.trim();
const resetPassword = args.includes('--reset-password');
const resetMfa = args.includes('--reset-mfa');

function fail(message) {
  process.stderr.write(`create-admin: ${message}\n`);
  process.exit(1);
}
if (!email || !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) fail('--email <address> is required');
if (!resetPassword && !resetMfa && (!name || name.length < 3 || name.length > 200))
  fail('--name "<full name>" (3–200 characters) is required');
for (const k of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
  if (!process.env[k]) fail(`${k} is not set (run inside the api service)`);

const AUTH = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function auth(method, path, body) {
  const r = await fetch(`${AUTH}${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) fail(`Supabase Auth ${method} ${path.split('?')[0]}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

/** A one-time password that satisfies GOTRUE_PASSWORD_MIN_LENGTH and the required character classes. */
function oneTimePassword() {
  const base = randomBytes(18).toString('base64').replace(/[+/=]/g, '');
  return `${base.slice(0, 8)}-${base.slice(8, 16)}-Aa7`;
}

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  application_name: 'mig-create-admin',
});
await db.connect();
// The record names the account itself as the actor (there is no signed-in person); the reason says who did it.
const audit = (id, label, reason) =>
  db.query(`select app.audit('role_change', 'user', $1::text, $2, $3, null, $2, $1::uuid, 'admin')`, [
    id,
    label,
    reason,
  ]);

async function resetAccount(existing) {
  if (resetPassword) {
    const password = oneTimePassword();
    await auth('PUT', `/admin/users/${existing.id}`, { password, email_confirm: true, ban_duration: 'none' });
    await audit(
      existing.id,
      existing.full_name,
      'Пароль сброшен администратором сервера (deploy/scripts/create-admin.mjs)',
    );
    process.stdout.write(`One-time password of ${email}: ${password}\n`);
  }
  if (resetMfa) {
    const { factors = [] } = await auth('GET', `/admin/users/${existing.id}/factors`).catch(() => ({
      factors: [],
    }));
    const list = Array.isArray(factors) ? factors : [];
    for (const f of list) await auth('DELETE', `/admin/users/${existing.id}/factors/${f.id}`);
    await audit(
      existing.id,
      existing.full_name,
      'Второй фактор сброшен администратором сервера (deploy/scripts/create-admin.mjs)',
    );
    process.stdout.write(
      `TOTP factors removed for ${email}: ${list.length}; a new one is connected at the next sign-in\n`,
    );
  }
}

try {
  const existing = (await db.query('select id, full_name, role from public.staff where email = $1', [email]))
    .rows[0];

  if (resetPassword || resetMfa) {
    // Any account with an e-mail (staff, HR, clinic, assistance): its Supabase Auth user has the id of the account.
    const account =
      existing ??
      (
        await db.query(
          `select id::text as id, 'account' as full_name from auth.users where lower(email) = $1`,
          [email],
        )
      ).rows[0];
    if (!account) fail(`no account with e-mail ${email}`);
    await resetAccount(account);
  } else {
    if (existing) fail(`${email} already has a staff account (role ${existing.role}); use --reset-password`);
    const id = randomUUID();
    const password = oneTimePassword();
    await auth('POST', '/admin/users', {
      id,
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'admin' },
    });
    await db.query('begin');
    await db.query(
      `insert into public.staff (id, full_name, email, role, active, authority) values ($1, $2, $3, 'admin', true, '{}'::jsonb)`,
      [id, name, email],
    );
    await audit(id, name, 'Первый администратор создан при развёртывании (deploy/scripts/create-admin.mjs)');
    await db.query('commit');
    process.stdout.write(
      `Administrator ${email} created.\nOne-time password (shown once): ${password}\nSign in at the portal and connect the authenticator app (TOTP).\n`,
    );
  }
} catch (e) {
  await db.query('rollback').catch(() => undefined);
  fail(e instanceof Error ? e.message : String(e));
} finally {
  await db.end();
}
