/*
 * DEV/CI/STAGING ONLY: Supabase Auth (GoTrue) users of every demo account of the seed (BACKEND_SPEC §7), appended
 * to `supabase/seed.sql` (so `supabase db reset` and CI provision them) and run by `npm run provision:demo -w
 * @mig/api` on staging.
 *
 * - the user id is the account id of our tables (`sub` of the JWT = staff.id, hr_users.id, insured.user_id…);
 * - roles and bindings in `raw_app_meta_data` (never `raw_user_meta_data`);
 * - e-mail accounts: the demo password (bcrypt by pgcrypto, computed once per load) and a verified TOTP factor
 *   with the derived development secret (auth/devMfa.ts: the test MFA mode turns `000000` into its code);
 * - phone accounts (the insured): a confirmed phone, signed in with a one-time code; the demo phones get the
 *   fixed code `000000` through `[auth.sms.test_otp]` of supabase/config.toml.
 *
 * Runs only where the Supabase Auth schema exists (skipped by a plain Postgres).
 */
import { DEMO_PASSWORD } from '../../auth/demo';
import { devFactorId, devTotpSecret } from '../../auth/devMfa';
import { identitiesOfDb, type IdentitySpec } from '../../auth/identity';
import type { Db } from '../db';
import { lit } from './physical';

const INSTANCE = '00000000-0000-0000-0000-000000000000';
const CHUNK = 300;

function userRow(i: IdentitySpec): string {
  const provider = i.email ? 'email' : 'phone';
  const meta = JSON.stringify({ provider, providers: [provider], ...i.appMetadata });
  return `(${[
    lit(INSTANCE),
    lit(i.userId),
    `'authenticated'`,
    `'authenticated'`,
    i.email ? lit(i.email) : 'null',
    i.email ? 'v_pw' : 'null',
    i.email ? 'v_now' : 'null',
    i.phone ? lit(i.phone) : 'null',
    i.phone ? 'v_now' : 'null',
    `${lit(meta)}::jsonb`,
    `'{}'::jsonb`,
    i.active ? 'null' : `'2999-01-01T00:00:00Z'::timestamptz`,
    'v_now',
    'v_now',
  ].join(', ')}, '', '', '', '', '', '', '', '')`;
}

function identityRow(i: IdentitySpec): string {
  const provider = i.email ? 'email' : 'phone';
  const data = i.email
    ? { sub: i.userId, email: i.email, email_verified: true, phone_verified: false }
    : { sub: i.userId, phone: i.phone, email_verified: false, phone_verified: true };
  return `(${lit(i.userId)}, ${lit(i.userId)}, ${lit(JSON.stringify(data))}::jsonb, ${lit(provider)}, null, v_now, v_now)`;
}

function factorRow(i: IdentitySpec): string {
  return `(${lit(devFactorId(i.userId))}, ${lit(i.userId)}, 'MIG demo', 'totp', 'verified', v_now, v_now, ${lit(devTotpSecret(i.userId))})`;
}

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/** The provisioning block (one `do` statement): replaces the demo users of `db` in Supabase Auth. */
export function buildAuthSeedSql(db: Db): string {
  const ids = identitiesOfDb(db);
  const withLogin = ids.filter((i) => i.email || i.phone);
  const emails = withLogin.filter((i) => i.email);
  const userCols =
    'instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token';
  const body: string[] = [];
  // Demo users of an earlier load, and anyone holding a demo e-mail or phone, are replaced.
  for (const part of chunks(ids))
    body.push(
      `  delete from auth.users where id = any(array[${part.map((i) => lit(i.userId)).join(', ')}]::uuid[]);`,
    );
  for (const part of chunks(emails))
    body.push(
      `  delete from auth.users where email = any(array[${part.map((i) => lit(i.email!)).join(', ')}]);`,
    );
  for (const part of chunks(withLogin.filter((i) => i.phone)))
    body.push(
      `  delete from auth.users where phone = any(array[${part.map((i) => lit(i.phone!)).join(', ')}]);`,
    );
  for (const part of chunks(withLogin))
    body.push(`  insert into auth.users (${userCols}) values\n    ${part.map(userRow).join(',\n    ')};`);
  for (const part of chunks(withLogin))
    body.push(
      `  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values\n    ${part.map(identityRow).join(',\n    ')};`,
    );
  for (const part of chunks(emails))
    body.push(
      `  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values\n    ${part.map(factorRow).join(',\n    ')};`,
    );
  return `-- DEV/CI/STAGING ONLY: Supabase Auth users of the demo accounts (store/sql/authSeed.ts).
do $auth$
declare
  v_now timestamptz := now();
  v_pw text;
begin
  if to_regclass('auth.users') is null or to_regclass('auth.mfa_factors') is null then
    raise notice 'Supabase Auth schema not found: demo users are not provisioned';
    return;
  end if;
  v_pw := extensions.crypt(${lit(DEMO_PASSWORD)}, extensions.gen_salt('bf', 10));
${body.join('\n')}
end
$auth$;
`;
}
