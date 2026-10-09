/*
 * pgTAP tests of the privileged-access reduction (docs/PRIVILEGED_AUDIT.md): the narrow fact functions of
 * store/sql/facts.ts answer the roles that need them with exactly the value and refuse everyone else (another
 * company, another role), and the RLS policies added for it give what the services need and no more.
 * Written to supabase/tests/04_privileged_test.sql by scripts/gen-rls-tests.mjs.
 */
import type { Role } from '@mig/contracts';
import type { Db } from '../db';
import { lit } from './physical';
import { HELPERS, type Identity } from './rlsTests';

const VALUE_AS = `-- The value of one statement run as the user ('denied' on 42501, 'error: <state>' on another error); rolled back.
create or replace function tests.value_as(p_claims jsonb, p_sql text) returns text
  language plpgsql as $$
declare
  v text;
begin
  begin
    perform set_config('request.jwt.claims', p_claims::text, true);
    execute 'set local role authenticated';
    execute p_sql into v;
    raise exception using errcode = 'TSTRB';
  exception
    when sqlstate 'TSTRB' then null;
    when insufficient_privilege then v := 'denied';
    when others then v := 'error: ' || sqlstate;
  end;
  return v;
end $$;
`;

export function privilegedFile(db: Db, ids: Identity[]): { sql: string; count: number } {
  const who = (r: Role) => ids.find((i) => i.role === r)!;
  const c = (i: Identity) => `${lit(JSON.stringify(i.claims))}::jsonb`;
  const q = (sql: string) => lit(sql);
  const valueAs = (i: Identity, sql: string) => `tests.value_as(${c(i)}, ${q(sql)})`;
  const hr = who('hr');
  const hrCompany = String((hr.claims.app_metadata as Record<string, string>).company_id);
  const otherClient = db.clients.find((x) => x.id !== hrCompany && db.claims.some((k) => k.clientId === x.id) && db.invoices.some((k) => k.clientId === x.id) && x.activePolicyId)!;
  const policy = otherClient.activePolicyId!;
  const lines: string[] = [
    '-- app.fact_client_insured_count: whoever sees the client',
    `select is(${valueAs(who('underwriter'), `select app.fact_client_insured_count('${otherClient.id}')`)}, (select count(*)::text from public.insured where client_id = '${otherClient.id}' and status = 'active'), 'insured count: the underwriter of any client');`,
    `select is(${valueAs(hr, `select app.fact_client_insured_count('${hrCompany}')`)}, (select count(*)::text from public.insured where client_id = '${hrCompany}' and status = 'active'), 'insured count: HR of the own company');`,
    `select is(${valueAs(hr, `select app.fact_client_insured_count('${otherClient.id}')`)}, 'denied', 'insured count: HR of another company is refused');`,
    `select is(${valueAs(who('insured'), `select app.fact_client_insured_count('${hrCompany}')`)}, 'denied', 'insured count: the insured person is refused');`,
    `select is(${valueAs(who('doctor_expert'), `select app.fact_client_insured_count('${otherClient.id}')`)}, 'denied', 'insured count: a role without the client is refused');`,
    '-- app.fact_client_legal_form: MIG staff, HR of the own company',
    `select is(${valueAs(who('doctor_expert'), `select app.fact_client_legal_form('${otherClient.id}')`)}, ${lit(otherClient.legalForm)}, 'legal form: any MIG employee');`,
    `select is(${valueAs(hr, `select app.fact_client_legal_form('${hrCompany}')`)}, (select legal_form from public.clients where id = '${hrCompany}'), 'legal form: HR of the own company');`,
    `select is(${valueAs(hr, `select app.fact_client_legal_form('${otherClient.id}')`)}, 'denied', 'legal form: HR of another company is refused');`,
    `select is(${valueAs(who('clinic_admin'), `select app.fact_client_legal_form('${otherClient.id}')`)}, 'denied', 'legal form: a clinic is refused');`,
    '-- app.fact_client_claim_figures / invoice figures / policy brief / history: clients.read only, anonymous',
    `select is(${valueAs(who('underwriter'), `select jsonb_array_length(app.fact_client_claim_figures('${otherClient.id}'))`)}, (select count(*)::text from public.claims where client_id = '${otherClient.id}'), 'claim figures: every claim of the client for clients.read');`,
    `select is(${valueAs(who('underwriter'), `select bool_and(not (x ? 'number') and not (x ? 'insuredId') and not (x ? 'insuredName') and not (x ? 'providerName'))::text from jsonb_array_elements(app.fact_client_claim_figures('${otherClient.id}')) x`)}, 'true', 'claim figures: no number, person or provider');`,
    `select is(${valueAs(who('doctor_expert'), `select app.fact_client_claim_figures('${otherClient.id}')::text`)}, 'denied', 'claim figures: a role without clients.read is refused');`,
    `select is(${valueAs(hr, `select app.fact_client_claim_figures('${hrCompany}')::text`)}, 'denied', 'claim figures: HR (no clients.read) is refused for the own company too');`,
    `select is(${valueAs(who('admin'), `select jsonb_array_length(app.fact_client_invoice_figures('${otherClient.id}'))`)}, (select count(*)::text from public.invoices where client_id = '${otherClient.id}'), 'invoice figures: the admin (no invoice access) gets the numbers of the client card');`,
    `select is(${valueAs(who('claims_officer'), `select app.fact_client_invoice_figures('${otherClient.id}')::text`)}, 'denied', 'invoice figures: a role without clients.read is refused');`,
    `select is(${valueAs(who('admin'), `select app.fact_policy_brief('${policy}') ->> 'number'`)}, (select number from public.policies where id = '${policy}'), 'policy brief: the admin (no policy access) gets the number');`,
    `select is(${valueAs(hr, `select app.fact_policy_brief('${policy}')::text`)}, 'denied', 'policy brief: HR is refused');`,
    `select is(${valueAs(who('sales_manager'), `select count(*)::text from jsonb_array_elements(app.fact_client_history('${otherClient.id}', 50)) x where x ->> 'action' in ('reveal_pii', 'open_medical') or x ? 'reason'`)}, '0', 'client history: no openings of personal or medical data, no reasons');`,
    `select is(${valueAs(who('doctor_expert'), `select app.fact_client_history('${otherClient.id}', 50)::text`)}, 'denied', 'client history: a role without clients.read is refused');`,
    '-- app.fact_company_claim_count: HR of the own company only',
    `select is(${valueAs(hr, `select app.fact_company_claim_count('${hrCompany}', 0)`)}, (select count(*)::text from public.claims c join public.insured i on i.id = c.insured_id where i.client_id = '${hrCompany}' and i.status = 'active'), 'company claim count: HR of the own company');`,
    `select is(${valueAs(hr, `select app.fact_company_claim_count('${otherClient.id}', 0)`)}, 'denied', 'company claim count: HR of another company is refused');`,
    `select is(${valueAs(who('operator'), `select app.fact_company_claim_count('${hrCompany}', 0)`)}, 'denied', 'company claim count: MIG staff use their own access');`,
    `select is(tests.value_as('{}'::jsonb, 'select app.fact_client_legal_form(''${otherClient.id}'')'), 'denied', 'no claims: every fact is refused');`,
  ];
  const asserts = lines.filter((l) => /^select (is|ok|throws_ok)\(/.test(l));
  const body = lines.map((l) => (l.startsWith('--') ? `\n${l}` : l)).join('\n');
  return {
    sql: `-- Narrow facts and the policies that replaced privileged reads (docs/PRIVILEGED_AUDIT.md): generated by scripts/gen-rls-tests.mjs. Do not edit.
begin;
${HELPERS}
${VALUE_AS}
select plan(${asserts.length});
${body}
select * from finish();
rollback;
`,
    count: asserts.length,
  };
}
