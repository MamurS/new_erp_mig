/*
 * pgTAP tests of supabase/tests/ (BACKEND_SPEC §6, §9, §12): generated from the same access rules and
 * permissions matrix as the policies, plus fixed scenarios (HR isolation, clinic via a visit, assistance by
 * date, family by consent, aal2, masking, the append-only audit chain). `scripts/gen-rls-tests.mjs`
 * writes them; `npx supabase test db` runs them against the migrated and seeded database.
 *
 * Matrix tests: for every role and table, as a real user of the seed (claims set with
 * `set local role authenticated` + `request.jwt.claims`):
 *   select — the user sees exactly the rows of the role's predicate (0 when the role has no access);
 *   insert / update / delete — on an «own» row (inside the predicate) succeeds iff the matrix allows it,
 *   on a «foreign» row (outside it) never does. Every attempt is rolled back.
 */
import type { Role } from '@mig/contracts';
import type { Db } from '../db';
import { snake } from '../columns';
import { TABLES, type TableSpec } from '../schema';
import { keyColumn, lit, physicalColumns } from './physical';
import { ALL_ROLES, OPS, cached, grantExpression, groupOf, roleAllowed, rolePredicate, type Op } from './rls';
import type { SqlFile } from './migrations';

interface Identity {
  role: Role;
  label: string;
  claims: Record<string, unknown>;
}

const FIX = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A user of every role, taken from the seed. */
export function identities(db: Db): Identity[] {
  const out: Identity[] = [];
  const claims = (sub: string, role: Role, meta: Record<string, string>, aal: 'aal1' | 'aal2') => ({ sub, role: 'authenticated', aal, app_metadata: { role, ...meta } });
  for (const role of ALL_ROLES) {
    const g = groupOf(role);
    if (g === 'staff') {
      const s = db.staff.find((x) => x.role === role);
      if (!s) throw new Error(`No staff user with role ${role} in the seed`);
      out.push({ role, label: role, claims: claims(s.id, role, {}, 'aal2') });
    } else if (g === 'hr') {
      const h = db.hrUsers[0]!;
      out.push({ role, label: 'hr', claims: claims(h.id, role, { company_id: h.companyId }, 'aal1') });
    } else if (g === 'insured') {
      const e = familyEmployee(db);
      out.push({ role, label: 'insured', claims: claims(e.userId, role, { insured_id: e.id }, 'aal1') });
    } else if (g === 'clinic') {
      const u = db.clinicUsers.find((x) => x.role === role);
      if (!u) throw new Error(`No clinic user with role ${role}`);
      out.push({ role, label: role, claims: claims(u.id, role, { clinic_id: u.clinicId }, 'aal2') });
    } else {
      const u = db.assistUsers.find((x) => x.role === role);
      if (!u) throw new Error(`No assistance user with role ${role}`);
      out.push({ role, label: role, claims: claims(u.id, role, { assistance_id: u.assistanceId }, 'aal2') });
    }
  }
  return out;
}

/** An employee of the seed with a child, an adult family member and claims: the insured identity. */
export function familyEmployee(db: Db) {
  const e = db.insured.find(
    (i) =>
      i.relation === 'employee' &&
      db.insured.some((c) => c.principalId === i.id && c.relation === 'child') &&
      db.insured.some((c) => c.principalId === i.id && c.relation !== 'child') &&
      db.claims.some((c) => c.insuredId === i.id) &&
      db.chat.some((c) => c.insuredId === i.id),
  );
  if (!e) throw new Error('No employee with a family, claims and chat in the seed');
  return e;
}

const HELPERS = `-- Helpers (created inside the test transaction, rolled back with it).
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

-- Runs p_sql as the user of p_claims; returns the affected row count, -1 when denied (42501),
-- -2 on another error. Everything it did is rolled back.
create or replace function tests.as_user(p_claims jsonb, p_sql text, out n integer, out err text)
  language plpgsql as $$
begin
  n := 0;
  begin
    perform set_config('request.jwt.claims', p_claims::text, true);
    execute 'set local role authenticated';
    execute p_sql;
    get diagnostics n = row_count;
    raise exception using errcode = 'TSTRB';
  exception
    when sqlstate 'TSTRB' then null;
    when insufficient_privilege then n := -1; err := sqlerrm;
    when others then n := -2; err := sqlstate || ' ' || sqlerrm;
  end;
end $$;

-- Rows of a table the user sees.
create or replace function tests.count_as(p_claims jsonb, p_table text) returns bigint
  language plpgsql as $$
declare
  v bigint;
begin
  begin
    perform set_config('request.jwt.claims', p_claims::text, true);
    execute 'set local role authenticated';
    execute format('select count(*) from public.%I', p_table) into v;
    raise exception using errcode = 'TSTRB';
  exception
    when sqlstate 'TSTRB' then null;
    when insufficient_privilege then v := -1;
  end;
  return v;
end $$;

-- Rows of a table matching a predicate evaluated with the user's claims (as the owner, without RLS).
create or replace function tests.count_scope(p_claims jsonb, p_table text, p_pred text) returns bigint
  language plpgsql as $$
declare
  v bigint;
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  execute format('select count(*) from public.%I where coalesce((%s), false)', p_table, p_pred) into v;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- One write attempt on an own (p_own) or foreign row of the predicate: 'ok' when the outcome is the
-- expected one (or there is no such row in the data), else what happened. An insert copies the row with a
-- new key (p_sets), or — when the key is the scope itself (p_sets = '') — deletes it first and inserts it
-- again. Everything is rolled back.
create or replace function tests.check(p_claims jsonb, p_op text, p_table text, p_key text, p_pred text, p_own boolean, p_expect boolean, p_sets text)
  returns text language plpgsql as $$
declare
  v_id text;
  r record;
  v_sql text;
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  execute format('select %I::text from public.%I where coalesce((%s), false) = %L order by _pos limit 1', p_key, p_table, p_pred, p_own) into v_id;
  perform set_config('request.jwt.claims', '', true);
  if v_id is null then
    return 'ok';
  end if;
  begin
    if p_op = 'insert' then
      v_sql := format('insert into public.%I select * from pg_temp.tests_src', p_table);
      execute format('create temp table tests_src as select * from public.%I where %I::text = %L', p_table, p_key, v_id);
      if p_sets = '' then
        execute format('delete from public.%I where %I::text = %L', p_table, p_key, v_id);
      else
        execute format('update pg_temp.tests_src set %s', p_sets);
      end if;
      execute 'grant select on pg_temp.tests_src to authenticated';
    elsif p_op = 'update' then
      v_sql := format('update public.%I set _updated_at = now() where %I::text = %L', p_table, p_key, v_id);
    else
      v_sql := format('delete from public.%I where %I::text = %L', p_table, p_key, v_id);
    end if;
    r := tests.as_user(p_claims, v_sql);
    raise exception using errcode = 'TSTRB';
  exception
    when sqlstate 'TSTRB' then null;
  end;
  if (p_expect and r.n = 1) or (not p_expect and r.n <= 0 and r.n <> -2) then
    return 'ok';
  end if;
  return format('%s %s row %s: %s rows (%s)', p_op, case when p_own then 'own' else 'foreign' end, v_id, r.n, coalesce(r.err, ''));
end $$;
`;

/** Rows for the tables the seed leaves empty, so the own/foreign checks have something to touch. */
function fixtures(db: Db, ids: Identity[]): string {
  const e = familyEmployee(db);
  const adult = db.insured.find((c) => c.principalId === e.id && c.relation !== 'child')!;
  const other = db.insured.find((i) => i.relation === 'employee' && i.clientId !== e.clientId)!;
  const otherAdult = db.insured.find((c) => c.principalId === other.id && c.relation !== 'child') ?? other;
  const hr = db.hrUsers[0]!;
  const otherClient = db.clients.find((c) => c.id !== hr.companyId && db.insured.some((i) => i.clientId === c.id))!;
  const staff = db.staff[0]!;
  const clinic = db.clinicUsers[0]!;
  const otherClinic = db.clinics.find((c) => c.id !== clinic.clinicId)!;
  const ic = db.integrationClients[0]!;
  const invoice = db.invoices[0]!;
  const now = 'now()';
  const ms = `(extract(epoch from now()) * 1000)::bigint`;
  const sub = (i: Identity) => String(i.claims.sub);
  const notif = [...ids.map((i, n) => `(${lit(FIX(100 + n))}, 'srv.test', null, null, ${now}, false, ${lit(sub(i))})`), `(${lit(FIX(199))}, 'srv.test', null, null, ${now}, false, ${lit(FIX(9999))})`];
  const task = (n: number, toRole: string, clientId: string, createdBy: string) =>
    `(${lit(FIX(n))}, 'other', ${lit(toRole)}, 'client', ${lit(clientId)}, ${lit(clientId)}, 'Client', 'srv.test', '', '/staff', 'Test', ${now}, ${now} + interval '2 days', current_date + 2, 'open', 'Client', '/staff', '[]'::jsonb, ${lit(createdBy)})`;
  const hq = (n: number, asker: string) => `(${lit(FIX(n))}, ${now}, 'operator', 'ru', 'Question', 'answered', '{}'::text[], ${lit(asker)})`;
  return `-- Fixtures: rows for the tables the seed leaves empty.
insert into public.notifications (id, text, detail, link, created_at, read, user_id) values
  ${notif.join(',\n  ')};
insert into public.tasks (id, action, to_role, subject_type, subject_id, client_id, client_name, title, comment, link, created_by_name, created_at, due_at, due_date, status, subject_label, subject_link, history, created_by_id) values
  ${task(201, 'underwriter', hr.companyId, staff.id)},
  ${task(202, 'hr', hr.companyId, staff.id)},
  ${task(203, 'hr', otherClient.id, staff.id)};
insert into public.family_consents (id, owner_id, viewer_id, granted_at) values
  (${lit(FIX(301))}, ${lit(adult.id)}, ${lit(e.id)}, ${now}),
  (${lit(FIX(302))}, ${lit(otherAdult.id)}, ${lit(other.id)}, ${now});
insert into public.family_requests (id, employee_id, client_id, full_name, birth_date, pinfl_enc, pinfl_key_ver, pinfl_hmac, pinfl_mask, relation, consent_at, status, created_at) values
  (${lit(FIX(401))}, ${lit(e.id)}, ${lit(e.clientId)}, 'Test Child', '2020-01-01', convert_to('12345678901234', 'UTF8'), 0, '\\x00', '••••••••••1234', 'child', ${now}, 'pending', ${now}),
  (${lit(FIX(402))}, ${lit(other.id)}, ${lit(other.clientId)}, 'Test Child', '2020-01-01', convert_to('12345678901234', 'UTF8'), 0, '\\x00', '••••••••••1234', 'child', ${now}, 'pending', ${now});
insert into public.card_tokens (token, short_code, insured_id, expires_at) values
  ('tok-own', 'AAAA1111', ${lit(e.id)}, ${ms} + 600000),
  ('tok-foreign', 'BBBB2222', ${lit(other.id)}, ${ms} + 600000);
insert into public.insured_documents (id, insured_id, title, created_at) values
  (${lit(FIX(501))}, ${lit(e.id)}, 'Doc', current_date),
  (${lit(FIX(502))}, ${lit(other.id)}, 'Doc', current_date);
insert into public.mis_slots (clinic_id, specialty, starts_at, duration_min) values
  (${lit(clinic.clinicId)}, 'therapist', ${now} + interval '1 day', 30),
  (${lit(otherClinic.id)}, 'therapist', ${now} + interval '1 day', 30);
insert into public.help_questions (id, at, role, locale, question, status, sources, asker_id) values
  ${ids.map((i, n) => hq(600 + n, sub(i))).join(',\n  ')},
  ${hq(699, FIX(9999))};
insert into public.payments (id, invoice_id, amount, paid_at, payer_inn, purpose, source, recorded_by_name) values
  (${lit(FIX(701))}, ${lit(invoice.id)}, 1000, current_date, '123456789', 'Test', 'manual', 'Test');
insert into public.sms_outbox ("at", insured_id, text) values (${now}, ${lit(e.id)}, 'Test');
insert into public.sessions (id, user_id, role, created_at, last_activity) values ('s-1', ${lit(staff.id)}, 'operator', ${ms}, ${ms});
insert into public.challenges (id, user_id, kind, expires_at, attempts) values ('c-1', ${lit(staff.id)}, 'staff', ${ms} + 60000, 0);
insert into public.grants (id, user_id, insured_id, expires_at) values ('g-1', ${lit(staff.id)}, ${lit(e.id)}, ${ms} + 60000);
insert into public.login_failures (key, "at") values ('k-1', ${ms});
insert into public.lockouts (key, until) values ('k-1', ${ms} + 60000);
insert into public.check_attempts (user_id, "at", ok) values (${lit(clinic.id)}, ${ms}, true);
insert into public.check_locks (user_id, until) values (${lit(clinic.id)}, ${ms} + 60000);
insert into public.access_tokens (token_hash, client_row_id, scopes, expires_at) values ('h-1', ${lit(ic.id)}, '{}', ${ms} + 60000);
insert into public.idempotency (key, status, body, "at") values ('i-1', 200, '{}', ${ms});
insert into public.api_calls (client_row_id, "at") values (${lit(ic.id)}, ${ms});
insert into public.migration_batches (id, seq, kind, status, migration_date, created_at, created_by_id, created_by_name, files_enc, files_key_ver, steps) values
  (${lit(FIX(801))}, 1, 'csv', 'draft', current_date, ${now}, ${lit(staff.id)}, 'Test', convert_to('{}', 'UTF8'), 0, '{}'::jsonb);
insert into public.ai_logs (id, "at", scenario, prompt_version, provider, model, input_hash, input_redacted, output, confidence, latency_ms, user_id, user_role, suspicious) values
  ${ids.map((i, n) => `(${lit(FIX(900 + n))}, ${now}, 'help', 'v1', 'mock', 'mock', 'h', 'x', '{}'::jsonb, 0.9, 10, ${lit(sub(i))}, ${lit(i.role)}, false)`).join(',\n  ')},
  (${lit(FIX(999))}, ${now}, 'help', 'v1', 'mock', 'mock', 'h', 'x', '{}'::jsonb, 0.9, 10, ${lit(FIX(9999))}, 'operator', false);
`;
}

/** SET clause making a copied row insertable (a new key, unique values changed). */
function copySets(t: TableSpec): string {
  const key = keyColumn(t);
  // The key is the scope (a price list of a clinic, appendix 2 of a contract): re-insert the same row.
  if (t.key !== null && t.columns[t.key]!.ref) return '';
  const keyKind = t.key === null ? 'uuid' : t.columns[t.key]!.kind;
  const sets = [keyKind === 'uuid' ? `${key} = gen_random_uuid()` : keyKind === 'int' ? `${key} = ${key} + 1000` : `${key} = ${key} || '#t'`];
  for (const c of physicalColumns(t)) if (c.unique && c.name !== key) sets.push(`${c.name} = ${c.name} || '#t'`);
  return sets.join(', ');
}

function matrixFile(db: Db, ids: Identity[], id: Identity): { sql: string; count: number } {
  const lines: string[] = [];
  const claims = `${lit(JSON.stringify(id.claims))}::jsonb`;
  for (const t of TABLES) {
    const selPred = cached(rolePredicate(id.role, t.access.select));
    // No SELECT privilege at all (system tables): the query is refused (-1) instead of returning nothing.
    const expected = grantExpression(t.access.select) === null ? '-1::bigint' : `tests.count_scope(${claims}, ${lit(t.table)}, ${lit(selPred)})`;
    lines.push(`select is(tests.count_as(${claims}, ${lit(t.table)}), ${expected}, ${lit(`${id.label}: select ${t.table} sees exactly its rows`)});`);
    for (const op of OPS.filter((o): o is Exclude<Op, 'select'> => o !== 'select')) {
      const g = t.access[op];
      const allowed = roleAllowed(id.role, g);
      const pred = allowed ? cached(rolePredicate(id.role, g)) : selPred === 'false' ? 'true' : selPred;
      const key = keyColumn(t);
      const check = (own: boolean, expect: boolean) =>
        `select is(tests.check(${claims}, ${lit(op)}, ${lit(t.table)}, ${lit(key)}, ${lit(pred)}, ${own}, ${expect}, ${lit(copySets(t))}), 'ok', ${lit(`${id.label}: ${op} ${t.table} ${own ? 'own' : 'foreign'} row ${expect ? 'allowed' : 'denied'}`)});`;
      lines.push(check(true, allowed));
      if (allowed && pred !== 'true') lines.push(check(false, false));
    }
  }
  const sql = `-- RLS matrix of role ${id.role}: generated by scripts/gen-rls-tests.mjs from schema.ts and PERMISSIONS. Do not edit.
begin;
${HELPERS}
${fixtures(db, ids)}
select plan(${lines.length});
${lines.join('\n')}
select * from finish();
rollback;
`;
  return { sql, count: lines.length };
}

function rlsEnabledFile(): { sql: string; count: number } {
  const lines = [
    `select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0::bigint, 'every table in public has row level security');`,
    `select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')), ${TABLES.length}::bigint, 'public holds exactly the tables of schema.ts');`,
    `select is((select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'), 0::bigint, 'anon has no privilege on public');`,
    ...TABLES.map((t) => `select ok((select relrowsecurity from pg_class where oid = 'public.${t.table}'::regclass), ${lit(`${t.table} has row level security`)});`),
    ...TABLES.flatMap((t) =>
      physicalColumns(t)
        .filter((c) => c.secret)
        .map((c) => `select ok(not has_column_privilege('authenticated', 'public.${t.table}', ${lit(c.name)}, 'select'), ${lit(`authenticated cannot read ${t.table}.${c.name}`)});`),
    ),
  ];
  return {
    sql: `-- RLS is enabled everywhere and secrets are not readable: generated by scripts/gen-rls-tests.mjs. Do not edit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(${lines.length});
${lines.join('\n')}
select * from finish();
rollback;
`,
    count: lines.length,
  };
}

/** Fixed scenarios of BACKEND_SPEC §6 (the data is looked up in the seed at run time). */
function scenariosFile(db: Db, ids: Identity[]): { sql: string; count: number } {
  const byRole = (r: Role) => ids.find((i) => i.role === r)!;
  const c = (i: Identity) => `${lit(JSON.stringify(i.claims))}::jsonb`;
  const hr = byRole('hr');
  const op = byRole('operator');
  const uw = byRole('underwriter');
  const ins = byRole('insured');
  const reg = byRole('clinic_registrar');
  const asst = byRole('asst_operator');
  const e = familyEmployee(db);
  const adult = db.insured.find((x) => x.principalId === e.id && x.relation !== 'child')!;
  const child = db.insured.find((x) => x.principalId === e.id && x.relation === 'child')!;
  const hrCompany = String((hr.claims.app_metadata as Record<string, string>).company_id);
  const foreignInsured = db.insured.find((x) => x.clientId !== hrCompany)!;
  const foreignPolicy = db.policies.find((p) => p.clientId !== hrCompany)!;
  const clinicId = String((reg.claims.app_metadata as Record<string, string>).clinic_id);
  const assistanceId = String((asst.claims.app_metadata as Record<string, string>).assistance_id);
  const unassignedPolicy = db.policies.find((p) => !db.assignments.some((a) => a.policyId === p.id && a.assistanceId === assistanceId) && db.insured.some((i) => i.policyId === p.id))!;
  const unassignedPerson = db.insured.find((i) => i.policyId === unassignedPolicy.id)!;
  const anyClaim = db.claims[0]!;
  const notPatient = db.insured.find((i) => !db.visits.some((v) => v.insuredId === i.id && v.clinicId === clinicId))!;
  const opAal1 = { ...op.claims, aal: 'aal1' };
  const lines: string[] = [
    '-- HR isolation between companies',
    `select is((tests.as_user(${c(hr)}, 'select 1 from public.insured where client_id <> ''${hrCompany}''')).n, 0, 'hr: sees no insured of another company');`,
    `select is((tests.as_user(${c(hr)}, 'update public.insured set position = position where id = ''${foreignInsured.id}''')).n, 0, 'hr: cannot update an insured person of another company');`,
    `select is((tests.as_user(${c(hr)}, 'insert into public.policy_changes (id, client_id, client_name, policy_id, policy_number, kind, full_name, position, relation, effective_date, premium_delta, status, requested_at, requested_by_name, requested_by_id) values (gen_random_uuid(), ''${foreignPolicy.clientId}'', ''X'', ''${foreignPolicy.id}'', ''N'', ''add'', ''X'', ''X'', ''employee'', current_date, 0, ''pending'', now(), ''X'', ''${String(hr.claims.sub)}'')')).n, -1, 'hr: cannot request a change for another company');`,
    `select is((tests.as_user(${c(hr)}, 'insert into public.policy_changes (id, client_id, client_name, policy_id, policy_number, kind, full_name, position, relation, effective_date, premium_delta, status, requested_at, requested_by_name, requested_by_id) select gen_random_uuid(), client_id, ''X'', id, number, ''add'', ''X'', ''X'', ''employee'', current_date, 0, ''pending'', now(), ''X'', ''${String(hr.claims.sub)}'' from public.policies limit 1')).n, 1, 'hr: requests a change for the own company');`,
    `select is((tests.as_user(${c(hr)}, 'select 1 from public.claims')).n, 0, 'hr: sees no claims (medical data)');`,
    '-- Clinic only through an open visit',
    `select is((tests.as_user(${c(reg)}, 'select 1 from public.insured where id = ''${notPatient.id}''')).n, 0, 'clinic: a person without a visit is invisible');`,
    `insert into public.visits (id, clinic_id, insured_id, opened_by_id, method, opened_at, expires_at) values ('${FIX(1001)}', '${clinicId}', '${notPatient.id}', '${String(reg.claims.sub)}', 'policy', now(), now() + interval '1 hour');`,
    `select is((tests.as_user(${c(reg)}, 'select 1 from public.insured where id = ''${notPatient.id}''')).n, 1, 'clinic: an open visit gives access to the patient');`,
    `update public.visits set expires_at = now() - interval '1 minute' where id = '${FIX(1001)}';`,
    `select is((tests.as_user(${c(reg)}, 'select 1 from public.insured where id = ''${notPatient.id}''')).n, 0, 'clinic: access ends with the visit');`,
    `select is((tests.as_user(${c(reg)}, 'select 1 from public.guarantees where clinic_id <> ''${clinicId}''')).n, 0, 'clinic: no guarantee letters of other clinics');`,
    '-- Assistance company by the date of the event',
    `insert into public.assignments (policy_id, assistance_id, "from", set_by_id, set_at) values ('${unassignedPolicy.id}', '${assistanceId}', current_date - 10, '${String(uw.claims.sub)}', now());`,
    `create temp table sc_claims as select * from public.claims where id = '${anyClaim.id}';`,
    `update sc_claims set id = '${FIX(1101)}', number = 'T-1', insured_id = '${unassignedPerson.id}', client_id = '${unassignedPolicy.clientId}', service_date = current_date - 20;`,
    `insert into public.claims select * from sc_claims;`,
    `update sc_claims set id = '${FIX(1102)}', number = 'T-2', service_date = current_date - 5;`,
    `insert into public.claims select * from sc_claims;`,
    `select is((tests.as_user(${c(asst)}, 'select 1 from public.claims where id = ''${FIX(1101)}''')).n, 0, 'assistance: an event before the assignment is not its own');`,
    `select is((tests.as_user(${c(asst)}, 'select 1 from public.claims where id = ''${FIX(1102)}''')).n, 1, 'assistance: an event within the assignment is its own');`,
    `select is((tests.as_user(${c(asst)}, 'select 1 from public.insured where id = ''${unassignedPerson.id}''')).n, 1, 'assistance: persons of a policy assigned today');`,
    '-- Family: children always, adults only with consent',
    `create temp table fam_claims as select * from public.claims where id = '${anyClaim.id}';`,
    `update fam_claims set id = '${FIX(1201)}', number = 'T-3', insured_id = '${adult.id}', client_id = '${adult.clientId}';`,
    `insert into public.claims select * from fam_claims;`,
    `update fam_claims set id = '${FIX(1202)}', number = 'T-4', insured_id = '${child.id}', client_id = '${child.clientId}';`,
    `insert into public.claims select * from fam_claims;`,
    `select is((tests.as_user(${c(ins)}, 'select 1 from public.claims where id = ''${FIX(1201)}''')).n, 0, 'insured: an adult family member’s claim is hidden without consent');`,
    `select is((tests.as_user(${c(ins)}, 'select 1 from public.claims where id = ''${FIX(1202)}''')).n, 1, 'insured: a child’s claim is visible');`,
    `insert into public.family_consents (id, owner_id, viewer_id, granted_at) values ('${FIX(1203)}', '${adult.id}', '${e.id}', now());`,
    `select is((tests.as_user(${c(ins)}, 'select 1 from public.claims where id = ''${FIX(1201)}''')).n, 1, 'insured: visible after the adult’s consent');`,
    `update public.family_consents set revoked_at = now() where id = '${FIX(1203)}';`,
    `select is((tests.as_user(${c(ins)}, 'select 1 from public.claims where id = ''${FIX(1201)}''')).n, 0, 'insured: hidden again after the consent is revoked');`,
    `select is((tests.as_user(${c(ins)}, 'insert into public.family_consents (id, owner_id, viewer_id, granted_at) values (gen_random_uuid(), ''${adult.id}'', ''${e.id}'', now())')).n, -1, 'insured: cannot give a consent on behalf of a family member');`,
    `select is((tests.as_user(${c(ins)}, 'select 1 from public.insured where id <> all(app.my_family_ids())')).n, 0, 'insured: sees only the own family');`,
    '-- aal2 for MIG staff, clinics and assistance companies',
    `select is(tests.count_as(${lit(JSON.stringify(opAal1))}::jsonb, 'claims'), 0::bigint, 'operator without the second factor sees nothing');`,
    `select ok(tests.count_as(${c(op)}, 'claims') > 0, 'operator with aal2 sees claims');`,
    `select is(tests.count_as(${lit(JSON.stringify({ ...reg.claims, aal: 'aal1' }))}::jsonb, 'visits'), 0::bigint, 'clinic without the second factor sees nothing');`,
    `select is(tests.count_as(${lit(JSON.stringify({ ...asst.claims, aal: 'aal1' }))}::jsonb, 'cases'), 0::bigint, 'assistance without the second factor sees nothing');`,
    `select ok(tests.count_as(${c(hr)}, 'insured') > 0, 'hr works with aal1');`,
    `select is(tests.count_as('{}'::jsonb, 'clinics'), 0::bigint, 'no claims: nothing');`,
    '-- Masking: ciphertexts of identity data only through app.reveal()',
    `select is((tests.as_user(${c(op)}, 'select pinfl_enc from public.insured limit 1')).n, -1, 'operator cannot select the PINFL ciphertext');`,
    `select ok((tests.as_user(${c(op)}, 'select pinfl_mask, phone_mask, birth_date_masked, email_masked from public.insured_masked limit 1')).n = 1, 'the masked view is readable');`,
    `select is((tests.as_user(${c(op)}, 'select app.reveal(''insured'', ''${e.id}'', ''pinfl'', ''Call of the insured person'')')).n, 1, 'operator reveals a PINFL with a reason');`,
    `select is((tests.as_user(${c(uw)}, 'select app.reveal(''insured'', ''${e.id}'', ''pinfl'', ''reason'')')).n, -2, 'underwriter (masked) cannot reveal');`,
    `select is((tests.as_user(${c(op)}, 'select app.reveal(''insured'', ''${e.id}'', ''pinfl'', '''')')).n, -2, 'reveal needs a reason');`,
    `select is((tests.as_user(${c(ins)}, 'select app.reveal(''insured'', ''${e.id}'', ''phone'', ''me'')')).n, 1, 'the insured reveals the own phone');`,
    `select is((tests.as_user(${c(ins)}, 'select app.reveal(''insured'', ''${foreignInsured.id}'', ''phone'', ''me'')')).n, -2, 'the insured cannot reveal another person');`,
    `select is((select count(*) from public.audit_log where action = 'reveal_pii' and target_id = '${e.id}' and actor_id = '${String(op.claims.sub)}' and _created_at = now()), 0::bigint, 'reveal attempts were rolled back with the helper');`,
    '-- anon',
    `select is(has_table_privilege('anon', 'public.clients', 'select'), false, 'anon cannot read public tables');`,
  ];
  // The helper lines starting with '--' or plain statements are not assertions.
  const asserts = lines.filter((l) => l.startsWith('select is(') || l.startsWith('select ok(') || l.startsWith('select throws_ok('));
  const body = lines.map((l) => (l.startsWith('--') ? `\n${l}` : l)).join('\n');
  return {
    sql: `-- Scenarios of BACKEND_SPEC §6: generated by scripts/gen-rls-tests.mjs. Do not edit.
begin;
${HELPERS}
select plan(${asserts.length});
${body}
select * from finish();
rollback;
`,
    count: asserts.length,
  };
}

function auditFile(db: Db, ids: Identity[]): { sql: string; count: number } {
  const op = ids.find((i) => i.role === 'operator')!;
  const admin = ids.find((i) => i.role === 'admin')!;
  const c = (i: Identity) => `${lit(JSON.stringify(i.claims))}::jsonb`;
  const victim = db.audit[10]!;
  const lines = [
    `select ok((select ok from app.verify_audit_chain()), 'the seeded audit chain verifies');`,
    `select is((select checked from app.verify_audit_chain()), (select count(*) from public.audit_log), 'every entry is checked');`,
    `select is((tests.as_user(${c(op)}, 'insert into public.audit_log (id, "at", actor_id, actor_name, actor_role, action, target_type) values (gen_random_uuid(), now(), gen_random_uuid(), ''x'', ''admin'', ''login'', ''session'')')).n, -1, 'authenticated cannot insert into audit_log directly');`,
    `select is((tests.as_user(${c(op)}, 'update public.audit_log set reason = ''x''')).n, -1, 'authenticated cannot update audit_log');`,
    `select is((tests.as_user(${c(op)}, 'delete from public.audit_log')).n, -1, 'authenticated cannot delete from audit_log');`,
    `select is((tests.as_user(${c(admin)}, 'select app.audit(''export'', ''export'', null, null, ''test'', null, ''Admin'', gen_random_uuid(), ''operator'')')).n, 1, 'app.audit writes for a signed-in user');`,
    `select app.audit('export', 'export', null, 'test-entry', 'test', null, 'Admin', '${FIX(1)}', 'operator');`,
    `select is((select count(*) from public.audit_log where target_label = 'test-entry'), 1::bigint, 'the system writes through app.audit');`,
    `select ok((select ok from app.verify_audit_chain()), 'the chain still verifies after new entries');`,
    `select throws_ok($$ update public.audit_log set reason = 'x' where id = '${victim.id}' $$, '42501', 'audit_log is append-only', 'even the owner cannot update an entry');`,
    `select throws_ok($$ delete from public.audit_log where id = '${victim.id}' $$, '42501', 'audit_log is append-only', 'even the owner cannot delete an entry');`,
    `select throws_ok($$ truncate public.audit_log $$, '42501', 'audit_log is append-only', 'even the owner cannot truncate');`,
    `select is((tests.as_user(${c(admin)}, 'select app.verify_audit_chain()')).n, -1, 'users cannot call the verification directly');`,
    `alter table public.audit_log disable trigger audit_log_no_update;`,
    `update public.audit_log set reason = 'tampered' where id = '${victim.id}';`,
    `alter table public.audit_log enable trigger audit_log_no_update;`,
    `select is((select ok from app.verify_audit_chain()), false, 'a changed entry breaks the chain');`,
    `select is((select first_broken from app.verify_audit_chain()), '${victim.id}'::uuid, 'the first broken entry is reported');`,
    `select is(app.job_verify_audit_chain(), false, 'the daily job detects the break');`,
    `select ok((select count(*) from public.notifications n join public.staff s on s.id = n.user_id where n.text = 'srv.auditChainBroken' and s.role = 'admin') > 0, 'every admin is notified');`,
    `select ok(app.job_cleanup_expired() ? 'sessions', 'the cleanup job runs');`,
    `select ok(not exists (select 1 from app.job_catalog where runner = 'db' and name not in (select replace(jobname, 'mig:', '') from cron.job)), 'db jobs are scheduled in pg_cron');`,
    `select is((select count(*) from cron.job where jobname like 'mig:%'), (select count(*) from app.job_catalog), 'every job of jobs.ts is scheduled');`,
  ];
  const asserts = lines.filter((l) => l.startsWith('select is(') || l.startsWith('select ok(') || l.startsWith('select throws_ok('));
  return {
    sql: `-- Audit log (BACKEND_SPEC §9) and background jobs (§10): generated by scripts/gen-rls-tests.mjs. Do not edit.
begin;
${HELPERS}
select plan(${asserts.length});
${lines.join('\n')}
select * from finish();
rollback;
`,
    count: asserts.length,
  };
}

export const TESTS_DIR = 'supabase/tests';

export function buildRlsTests(db: Db): (SqlFile & { count: number })[] {
  const ids = identities(db);
  const files: (SqlFile & { count: number })[] = [];
  const add = (name: string, f: { sql: string; count: number }) => files.push({ name, sql: f.sql, count: f.count });
  add('00_rls_enabled_test.sql', rlsEnabledFile());
  add('01_scenarios_test.sql', scenariosFile(db, ids));
  add('02_audit_jobs_test.sql', auditFile(db, ids));
  for (const id of ids) add(`10_rls_${snake(id.role)}_test.sql`, matrixFile(db, ids, id));
  return files;
}
