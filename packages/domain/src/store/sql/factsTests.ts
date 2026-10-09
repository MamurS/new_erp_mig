/*
 * pgTAP tests of the privileged-access reduction (docs/PRIVILEGED_AUDIT.md): the narrow fact functions of
 * store/sql/facts.ts answer the roles that need them with exactly the value and refuse everyone else (another
 * company, another role), and the RLS policies added for it give what the services need and no more.
 * Written to supabase/tests/04_privileged_test.sql by scripts/gen-rls-tests.mjs.
 */
import type { Role } from '@mig/contracts';
import type { Db } from '../db';
import { devAesPiiCrypto } from '../piiAes';
import { lit } from './physical';
import { FIX as FIX_ID, HELPERS, type Identity } from './rlsTests';

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
  const me = db.insured.find((i) => i.id === String((who('insured').claims.app_metadata as Record<string, string>).insured_id))!;
  const clinicId = String((who('clinic_registrar').claims.app_metadata as Record<string, string>).clinic_id);
  const notPatient = db.insured.find((i) => !db.visits.some((v) => v.insuredId === i.id && v.clinicId === clinicId))!;
  const doctorId = String(who('doctor_expert').claims.sub);
  const ownDeal = db.deals.find((d) => d.clientId === hrCompany);
  const foreignDeal = db.deals.find((d) => d.clientId !== hrCompany && d.stage !== 'lost')!;
  const child = db.insured.find((i) => i.principalId === me.id && i.status !== 'excluded')!;
  const stranger = db.insured.find((i) => i.principalId !== me.id && i.id !== me.id && i.relation === 'employee')!;
  const asstAdmin = who('asst_admin');
  const assistanceId = String((asstAdmin.claims.app_metadata as Record<string, string>).assistance_id);
  const clinicAdmin = who('clinic_admin');
  const adminClinic = String((clinicAdmin.claims.app_metadata as Record<string, string>).clinic_id);
  const otherClinic = db.clinics.find((x) => x.id !== adminClinic)!;
  const reg = who('clinic_registrar');
  const regClinic = String((reg.claims.app_metadata as Record<string, string>).clinic_id);
  const regVisit = db.visits.find((v) => v.clinicId === regClinic)!;
  const foreignVisit = db.visits.find((v) => v.clinicId !== regClinic)!;
  const checkPolicy = db.policies.find((p) => p.id === me.policyId)!;
  const asstOp = who('asst_operator');
  const asstId = String((asstOp.claims.app_metadata as Record<string, string>).assistance_id);
  const servedPolicy = db.assignments.find((a) => a.assistanceId === asstId)!.policyId;
  const unservedPolicy = db.policies.find((p) => !db.assignments.some((a) => a.policyId === p.id && a.assistanceId === asstId))!;
  const unservedPerson = db.insured.find((i) => i.policyId === unservedPolicy.id && !db.visits.some((v) => v.insuredId === i.id && v.clinicId === regClinic))!;
  const anyFile = db.files.find((f) => !f.guaranteeId)!;
  const pinflHmacHex = Buffer.from(devAesPiiCrypto({ deterministic: true }).hmacSync(me.pinfl)).toString('hex');
  const anyContract = db.contracts.find((x) => x.quoteId) ?? db.contracts[0]!;
  const signatoryId = anyContract.params.migSignatoryId;
  const signatoryCanSign = !!db.staff.find((x) => x.id === signatoryId)?.signatory?.canSign;
  const otherAssistance = db.assistances.find((x) => x.id !== asstId)!.id;
  const formerPolicy = db.policies.find((p) => !db.assignments.some((x) => x.policyId === p.id && x.assistanceId === asstId) && db.insured.some((i) => i.policyId === p.id))!;
  const neverPolicy = db.policies.find((p) => p.id !== formerPolicy.id && !db.assignments.some((x) => x.policyId === p.id && x.assistanceId === asstId) && db.insured.some((i) => i.policyId === p.id))!;
  const servedPolicyToday = db.assignments.find((x) => x.assistanceId === asstId && !x.to)?.policyId ?? servedPolicy;
  const myClaim = db.claims.find((x) => x.insuredId === me.id)!;
  const strangerClaim = db.claims.find((x) => !db.insured.some((i) => i.id === x.insuredId && (i.id === me.id || i.principalId === me.id)))!;
  const MAPS = `${lit(JSON.stringify({ medicines: 'medicines', doctor_visit: 'outpatient', diagnostics: 'outpatient', dental: 'dental', inpatient: 'inpatient' }))}, ${lit(JSON.stringify({ outpatient: 'outpatient', diagnostics_advanced: 'outpatient', dental: 'dental', medicines: 'medicines', inpatient: 'inpatient' }))}`;
  const order = `array['lead', 'census', 'quote', 'kp_sent', 'kp_accepted', 'contract_draft', 'contract_review', 'contract_sent', 'signing', 'awaiting_payment', 'active']`;
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
    '-- app.fact_person_access_log: MIG card readers, persons they read',
    `select is(${valueAs(who('operator'), `select jsonb_array_length(app.fact_person_access_log('${me.id}'))`)}, (select count(*)::text from public.audit_log where target_id = '${me.id}' and action in ('reveal_pii', 'open_medical')), 'access log: the operator reads the openings of a person');`,
    `select is(${valueAs(who('accountant'), `select app.fact_person_access_log('${me.id}')::text`)}, 'denied', 'access log: the accountant (names only) is refused');`,
    `select is(${valueAs(hr, `select app.fact_person_access_log('${me.id}')::text`)}, 'denied', 'access log: HR is refused');`,
    `select is(${valueAs(who('clinic_registrar'), `select app.fact_person_access_log('${notPatient.id}')::text`)}, 'denied', 'access log: a clinic is refused');`,
    '-- app.fact_own_audit_entries: own openings only',
    `select is(${valueAs(who('doctor_expert'), `select jsonb_array_length(app.fact_own_audit_entries('${doctorId}', array['reveal_pii', 'open_medical'], null))`)}, (select count(*)::text from public.audit_log where actor_id = '${doctorId}' and action in ('reveal_pii', 'open_medical')), 'own entries: the doctor reads the own openings');`,
    `select is(${valueAs(who('doctor_expert'), `select app.fact_own_audit_entries('${String(who('operator').claims.sub)}', array['open_medical'], null)::text`)}, 'denied', 'own entries: another employee’s entries are refused');`,
    `select is(${valueAs(who('doctor_expert'), `select app.fact_own_audit_entries('${doctorId}', array['login'], null)::text`)}, 'denied', 'own entries: only openings of data');`,
    `select is(${valueAs(who('insured'), `select app.fact_own_audit_entries('${String(who('insured').claims.sub)}', array['open_medical'], null)::text`)}, 'denied', 'own entries: not for the insured person');`,
    '-- card_tokens: the insured person issues tokens of self and the active family under them, nobody else',
    `select is((tests.as_user(${c(who('insured'))}, 'insert into public.card_tokens (token, short_code, insured_id, expires_at) values (''t-child'', ''CCCC3333'', ''${child.id}'', 1)')).n, 1, 'card token: of a child of the family');`,
    `select is((tests.as_user(${c(who('insured'))}, 'insert into public.card_tokens (token, short_code, insured_id, expires_at) values (''t-stranger'', ''DDDD4444'', ''${stranger.id}'', 1)')).n, -1, 'card token: not of a person of another family');`,
    '-- deal_events: HR writes events of the own company’s deal only',
    ...(ownDeal
      ? [`select is((tests.as_user(${c(hr)}, 'insert into public.deal_events (id, deal_id, "at", actor_name, text) values (gen_random_uuid(), ''${ownDeal.id}'', now(), ''HR'', ''x'')')).n, 1, 'deal events: HR of the own company’s deal');`]
      : []),
    `select is((tests.as_user(${c(hr)}, 'insert into public.deal_events (id, deal_id, "at", actor_name, text) values (gen_random_uuid(), ''${foreignDeal.id}'', now(), ''HR'', ''x'')')).n, -1, 'deal events: not into another company’s deal');`,
    `select is((tests.as_user(${c(hr)}, 'select 1 from public.deal_events')).n, 0, 'deal events: HR still reads nothing');`,
    `select is((tests.as_user(${c(who('insured'))}, 'insert into public.deal_events (id, deal_id, "at", actor_name, text) values (gen_random_uuid(), ''${foreignDeal.id}'', now(), ''X'', ''x'')')).n, -1, 'deal events: the insured person writes nothing');`,
    '-- webhook_deliveries: the partner’s integration admin records a retry of its own deliveries',
    `insert into public.webhook_deliveries (id, endpoint_id, clinic_id, event, status, attempts, last_attempt_at, object_id, body, signature) select '${FIX_ID(2001)}', w.id, w.clinic_id, 'guarantee.decided', 'failed', 1, now(), gen_random_uuid(), '{}', '' from public.webhooks w where w.clinic_id = '${adminClinic}' limit 1;`,
    `insert into public.webhook_deliveries (id, endpoint_id, clinic_id, event, status, attempts, last_attempt_at, object_id, body, signature) select '${FIX_ID(2002)}', w.id, w.clinic_id, 'guarantee.decided', 'failed', 1, now(), gen_random_uuid(), '{}', '' from public.webhooks w where w.clinic_id <> '${adminClinic}' limit 1;`,
    `select ok((tests.as_user(${c(clinicAdmin)}, 'update public.webhook_deliveries set attempts = 2 where id = ''${FIX_ID(2001)}''')).n = (select count(*)::int from public.webhook_deliveries where id = '${FIX_ID(2001)}'), 'webhook deliveries: the clinic admin updates an own delivery');`,
    `select is((tests.as_user(${c(clinicAdmin)}, 'update public.webhook_deliveries set attempts = 2 where id = ''${FIX_ID(2002)}''')).n, 0, 'webhook deliveries: not another partner’s delivery');`,
    `select is((tests.as_user(${c(who('clinic_registrar'))}, 'update public.webhook_deliveries set attempts = 2')).n, 0, 'webhook deliveries: the registrar updates nothing');`,
    `select is((tests.as_user(${c(clinicAdmin)}, 'insert into public.webhook_deliveries (id, endpoint_id, clinic_id, event, status, attempts, last_attempt_at, object_id, body, signature) select gen_random_uuid(), endpoint_id, clinic_id, event, status, attempts, last_attempt_at, object_id, body, signature from public.webhook_deliveries limit 1')).n, -1, 'webhook deliveries: the outbox itself stays the system’s');`,
    '-- price_lists / clinic_contracts: every user of an assistance company, own contracts only',
    `select ok(tests.count_as(${c(asstAdmin)}, 'price_lists') = (select count(*) from public.price_lists), 'price lists: the assistance admin reads the network list');`,
    `select is(tests.count_as(${c(asstAdmin)}, 'clinic_contracts'), (select count(*) from public.clinic_contracts where payer = '${assistanceId}'), 'clinic contracts: the assistance admin reads only its own contracts');`,
    `select is(tests.count_as(${c(who('insured'))}, 'price_lists'), 0::bigint, 'price lists: the insured person reads none');`,
    '-- app.fact_advance_deal: forward only, HR of the own company',
    `select is(${valueAs(who('legal'), `select app.fact_advance_deal('${foreignDeal.id}', 'lead', ${order}, now())::text`)}, (select (stage = 'lead')::text from public.deals where id = '${foreignDeal.id}'), 'advance deal: never backwards');`,
    `select is(${valueAs(hr, `select app.fact_advance_deal('${foreignDeal.id}', 'active', ${order}, now())::text`)}, 'denied', 'advance deal: HR of another company is refused');`,
    `select is(${valueAs(who('insured'), `select app.fact_advance_deal('${foreignDeal.id}', 'active', ${order}, now())::text`)}, 'denied', 'advance deal: the insured person is refused');`,
    ...(ownDeal ? [`select is(${valueAs(hr, `select app.fact_advance_deal('${ownDeal.id}', 'active', ${order}, now())::text`)}, (select (stage <> 'lost')::text from public.deals where id = '${ownDeal.id}'), 'advance deal: HR of the own company');`] : []),
    '-- app.fact_push_clinic_event: anyone signed in, a clinic only into its own feed',
    `select is(${valueAs(who('insured'), `select app.fact_push_clinic_event(gen_random_uuid(), '${otherClinic.id}', now(), 'x')::text`)}, '', 'clinic event: written for a booking of the insured person');`,
    `select is(${valueAs(clinicAdmin, `select app.fact_push_clinic_event(gen_random_uuid(), '${otherClinic.id}', now(), 'x')::text`)}, 'denied', 'clinic event: a clinic cannot write into another clinic’s feed');`,
    `select is(${valueAs(who('insured'), `select app.fact_push_clinic_event(gen_random_uuid(), gen_random_uuid(), now(), 'x')::text`)}, 'denied', 'clinic event: only of an existing clinic');`,
    `select is((tests.as_user(${c(who('insured'))}, 'insert into public.clinic_events (id, clinic_id, "at", text) values (gen_random_uuid(), ''${otherClinic.id}'', now(), ''x'')')).n, -1, 'clinic event: no direct insert');`,
    '-- app.fact_append_client_log: MIG staff, HR of the own company',
    `select is(${valueAs(hr, `select app.fact_append_client_log('${hrCompany}', '{"at": "2026-01-01T00:00:00+05:00", "text": "x"}')::text`)}, '', 'client log: HR of the own company');`,
    `select is(${valueAs(hr, `select app.fact_append_client_log('${otherClient.id}', '{"at": "2026-01-01T00:00:00+05:00", "text": "x"}')::text`)}, 'denied', 'client log: HR of another company is refused');`,
    `select is(${valueAs(who('clinic_admin'), `select app.fact_append_client_log('${otherClient.id}', '{"at": "2026-01-01T00:00:00+05:00", "text": "x"}')::text`)}, 'denied', 'client log: a clinic is refused');`,
    '-- app.fact_redeem_card_token / app.fact_match_policy_pinfl: a clinic checking a patient, nobody else',
    `insert into public.card_tokens (token, short_code, insured_id, expires_at) values ('t-redeem', 'EEEE5555', '${me.id}', (extract(epoch from now()) * 1000)::bigint + 600000);`,
    `select is(${valueAs(reg, `select app.fact_redeem_card_token('EEEE5555', null, (extract(epoch from now()) * 1000)::bigint) ->> 'insuredId'`)}, '${me.id}', 'card code: the clinic gets only the person id');`,
    `update public.card_tokens set used_at = 1 where token = 't-redeem';`,
    `select is(${valueAs(reg, `select app.fact_redeem_card_token('EEEE5555', null, (extract(epoch from now()) * 1000)::bigint) ->> 'status'`)}, 'used', 'card code: a second use is refused');`,
    `select is(${valueAs(reg, `select app.fact_redeem_card_token(null, 'no-such-token-0000', (extract(epoch from now()) * 1000)::bigint) ->> 'status'`)}, 'stale', 'card code: an unknown code is stale');`,
    `select is(${valueAs(who('operator'), `select app.fact_redeem_card_token('EEEE5555', null, 0)::text`)}, 'denied', 'card code: MIG staff do not redeem codes');`,
    `select is(${valueAs(who('insured'), `select app.fact_redeem_card_token('EEEE5555', null, 0)::text`)}, 'denied', 'card code: the insured person does not redeem codes');`,
    `select is(${valueAs(reg, `select app.fact_match_policy_pinfl(${lit(checkPolicy.number.toLowerCase())}, '\\x${pinflHmacHex}')::text`)}, '${me.id}', 'policy and PINFL: the clinic gets the person id (any case of the number)');`,
    `select is(${valueAs(reg, `select app.fact_match_policy_pinfl(${lit(checkPolicy.number)}, '\\x00')::text`)}, null, 'policy and PINFL: a wrong PINFL matches nobody');`,
    `select is(${valueAs(hr, `select app.fact_match_policy_pinfl(${lit(checkPolicy.number)}, '\\x00')::text`)}, 'denied', 'policy and PINFL: HR is refused');`,
    '-- app.fact_visit_patient / app.fact_visit_policy_period: visits the caller sees',
    `select is(${valueAs(reg, `select app.fact_visit_patient('${regVisit.id}') ->> 'id'`)}, '${regVisit.insuredId}', 'visit patient: the clinic of the visit, also after it closed');`,
    `select is(${valueAs(reg, `select (app.fact_visit_patient('${regVisit.id}') ? 'pinfl')::text`)}, 'false', 'visit patient: only the name and the policy');`,
    `select is(${valueAs(reg, `select app.fact_visit_patient('${foreignVisit.id}')::text`)}, 'denied', 'visit patient: not a visit of another clinic');`,
    `select is(${valueAs(reg, `select app.fact_visit_policy_period('${regVisit.id}') ->> 'endDate'`)}, (select p.end_date::text from public.insured i join public.policies p on p.id = i.policy_id where i.id = '${regVisit.insuredId}'), 'visit policy period: the term of the patient’s policy');`,
    `select is(${valueAs(reg, `select app.fact_visit_policy_period('${foreignVisit.id}')::text`)}, 'denied', 'visit policy period: not of another clinic’s visit');`,
    `select is(${valueAs(who('insured'), `select app.fact_visit_patient('${regVisit.id}')::text`)}, 'denied', 'visit patient: the insured person is refused');`,
    '-- app.fact_policy_routing: whoever deals with the policy',
    `select is(${valueAs(who('insured'), `select jsonb_array_length(app.fact_policy_routing('${me.policyId}'))`)}, (select count(*)::text from public.assignments where policy_id = '${me.policyId}'), 'routing: the insured person of the own policy');`,
    `select is(${valueAs(who('insured'), `select app.fact_policy_routing('${unservedPolicy.id}')::text`)}, ${unservedPolicy.id === me.policyId ? `(select app.fact_policy_routing('${unservedPolicy.id}')::text)` : `'denied'`}, 'routing: not another policy of the insured person');`,
    `select is(${valueAs(asstOp, `select jsonb_array_length(app.fact_policy_routing('${servedPolicy}'))`)}, (select count(*)::text from public.assignments where policy_id = '${servedPolicy}'), 'routing: an assistance company of a policy it served (all companies of it)');`,
    `select is(${valueAs(asstOp, `select app.fact_policy_routing('${unservedPolicy.id}')::text`)}, 'denied', 'routing: not of a policy the company never served');`,
    `select is(${valueAs(asstOp, `select bool_and(not (x ? 'setById') and not (x ? 'setAt'))::text from jsonb_array_elements(app.fact_policy_routing('${servedPolicy}')) x`)}, 'true', 'routing: no author of the assignment');`,
    '-- app.fact_file_kind: whether a file exists, never the file',
    `select is(${valueAs(hr, `select app.fact_file_kind('${anyFile.id}')`)}, 'other', 'file kind: a hidden file answers only its kind');`,
    `select is(${valueAs(hr, `select app.fact_file_kind(gen_random_uuid())`)}, null, 'file kind: a missing file');`,
    '-- app.fact_limit_sums / app.fact_coverage_brief: whoever may check the person, sums only',
    `select is(${valueAs(who('insured'), `select (app.fact_limit_sums('${me.id}', 'individual', current_date, ${MAPS}) ? 'used')::text`)}, 'true', 'limit sums: the insured person of self');`,
    `select is(${valueAs(who('insured'), `select (select string_agg(k, ',' order by k) from jsonb_object_keys(app.fact_limit_sums('${me.id}', 'family_shared', current_date, ${MAPS})) k)`)}, 'program,reserved,used', 'limit sums: only the program and the sums');`,
    `select is(${valueAs(who('insured'), `select app.fact_limit_sums('${stranger.id}', 'individual', current_date, ${MAPS})::text`)}, 'denied', 'limit sums: not of a person of another family');`,
    `select is(${valueAs(reg, `select (app.fact_limit_sums('${regVisit.insuredId}', 'individual', current_date, ${MAPS}) ? 'used')::text`)}, 'true', 'limit sums: a clinic that had a visit of the person');`,
    `select is(${valueAs(reg, `select app.fact_limit_sums('${unservedPerson.id}', 'individual', current_date, ${MAPS})::text`)}, 'denied', 'limit sums: a clinic without a visit of the person is refused');`,
    `select is(${valueAs(hr, `select app.fact_limit_sums('${me.id}', 'individual', current_date, ${MAPS})::text`)}, 'denied', 'limit sums: HR never (no medical data), also of the own company');`,
    `select is(${valueAs(who('sales_manager'), `select app.fact_limit_sums('${me.id}', 'individual', current_date, ${MAPS})::text`)}, 'denied', 'limit sums: a MIG role without cards, claims or coverage is refused');`,
    `select is(${valueAs(asstOp, `select app.fact_coverage_brief('${unservedPerson.id}')::text`)}, 'denied', 'coverage brief: an assistance company that never served the policy is refused');`,
    `select is(${valueAs(who('operator'), `select app.fact_coverage_brief('${me.id}') -> 'policy' ->> 'number'`)}, ${lit(checkPolicy.number)}, 'coverage brief: the policy of the person');`,
    `select is(${valueAs(who('operator'), `select (app.fact_coverage_brief('${me.id}') -> 'person' ? 'fullName')::text`)}, 'false', 'coverage brief: no name or identity data');`,
    '-- app.fact_taken_slots: times of live appointments, no person',
    `select is(${valueAs(who('insured'), `select jsonb_array_length(app.fact_taken_slots('${regClinic}'))`)}, (select count(*)::text from public.appointments where clinic_id = '${regClinic}' and status not in ('cancelled', 'declined')), 'taken slots: the insured person sees every taken time of a clinic');`,
    `select is(${valueAs(who('insured'), `select coalesce(bool_and(jsonb_typeof(x) = 'string'), true)::text from jsonb_array_elements(app.fact_taken_slots('${regClinic}')) x`)}, 'true', 'taken slots: only the times');`,
    `select is(${valueAs(reg, `select app.fact_taken_slots('${otherClinic.id === regClinic ? adminClinic : otherClinic.id}')::text`)}, ${otherClinic.id === regClinic && adminClinic === regClinic ? `(select 'x')` : `'denied'`}, 'taken slots: a clinic only of its own');`,
    '-- app.fact_client_pipeline: clients.read',
    `select is(${valueAs(who('sales_manager'), `select (app.fact_client_pipeline('${otherClient.id}') ? 'hasHr')::text`)}, 'true', 'pipeline: the sales manager of any client');`,
    `select is(${valueAs(who('admin'), `select (app.fact_client_pipeline('${otherClient.id}') ->> 'hasPolicy')`)}, 'true', 'pipeline: the admin (no deals or contracts) gets the stage');`,
    `select is(${valueAs(who('doctor_expert'), `select app.fact_client_pipeline('${otherClient.id}')::text`)}, 'denied', 'pipeline: a role without clients.read is refused');`,
    `select is(${valueAs(hr, `select app.fact_client_pipeline('${hrCompany}')::text`)}, 'denied', 'pipeline: HR is refused');`,
    '-- app.fact_certificate_data: contract readers, HR of the own company, the insured person for the own card',
    `select is(${valueAs(who('insured'), `select jsonb_array_length(app.fact_certificate_data('${me.policyId}', '${me.id}') -> 'rows')`)}, (select count(*)::text from public.insured where id = '${me.id}' and status = 'active' and coalesce(certificate_number, '') <> ''), 'certificates: the insured person of the own card');`,
    `select is(${valueAs(who('insured'), `select app.fact_certificate_data('${me.policyId}', null)::text`)}, 'denied', 'certificates: the insured person not of the whole policy');`,
    `select is(${valueAs(who('insured'), `select app.fact_certificate_data('${stranger.policyId}', '${stranger.id}')::text`)}, ${stranger.policyId === me.policyId ? `'denied'` : `'denied'`}, 'certificates: not of a person of another family');`,
    `select is(${valueAs(hr, `select app.fact_certificate_data('${otherClient.activePolicyId}', null)::text`)}, 'denied', 'certificates: HR of another company is refused');`,
    `select is(${valueAs(who('legal'), `select (app.fact_certificate_data('${otherClient.activePolicyId}', null) ? 'rows')::text`)}, 'true', 'certificates: a contract reader of MIG');`,
    '-- app.fact_mig_signatory / app.fact_deal_number',
    `select is(${valueAs(hr, `select coalesce(app.fact_mig_signatory('${signatoryId}') ->> 'fullName', '')`)}, (select coalesce(case when (signatory ->> 'canSign')::boolean then full_name end, '') from public.staff where id = '${signatoryId}'), 'signatory: HR sees the MIG signatory of its contract');`,
    `select is(${valueAs(hr, `select (app.fact_mig_signatory('${signatoryId}') ? 'email')::text`)}, ${signatoryCanSign ? `'false'` : `null`}, 'signatory: no e-mail or authority');`,
    `select is(${valueAs(who('insured'), `select app.fact_mig_signatory('${signatoryId}')::text`)}, 'denied', 'signatory: the insured person is refused');`,
    ...(ownDeal ? [`select is(${valueAs(hr, `select app.fact_deal_number('${ownDeal.id}')`)}, ${lit(ownDeal.number)}, 'deal number: HR of the own company’s deal');`] : []),
    `select is(${valueAs(hr, `select app.fact_deal_number('${foreignDeal.id}')`)}, 'denied', 'deal number: not of another company’s deal');`,
    '-- app.fact_contract_quote: whoever reads the contract',
    `select is(${valueAs(who('operator'), `select (app.fact_contract_quote('${anyContract.dealId}', ${anyContract.quoteId ? `'${anyContract.quoteId}'` : 'null'}) ? 'quote')::text`)}, 'true', 'contract quote: the operator (no quotes) reads the summary of a contract');`,
    `select is(${valueAs(who('insured'), `select app.fact_contract_quote('${anyContract.dealId}', null)::text`)}, 'denied', 'contract quote: the insured person is refused');`,
    `select is(${valueAs(who('clinic_admin'), `select app.fact_contract_quote('${anyContract.dealId}', null)::text`)}, 'denied', 'contract quote: a clinic is refused');`,
    '-- contracts: HR reads and fills a draft of the own company only while MIG asks for its appendix 2',
    `create temp table sc_contract as select * from public.contracts where id = '${anyContract.id}';`,
    `update sc_contract set id = '${FIX_ID(2101)}', number = number || '#t', client_id = '${hrCompany}', status = 'draft';`,
    `insert into public.contracts select * from sc_contract;`,
    `select is((tests.as_user(${c(hr)}, 'select 1 from public.contracts where id = ''${FIX_ID(2101)}''')).n, 0, 'contracts: a draft is hidden from HR');`,
    `insert into public.tasks (id, action, to_role, subject_type, subject_id, client_id, client_name, title, comment, link, created_by_name, created_at, due_at, due_date, status, subject_label, subject_link, history, created_by_id, contract_id) values ('${FIX_ID(2102)}', 'insured_list', 'hr', 'contract', '${FIX_ID(2101)}', '${hrCompany}', 'C', 'srv.test', '', '/hr', 'T', now(), now() + interval '1 day', current_date + 1, 'open', 'C', '/hr', '[]'::jsonb, '${String(who('sales_manager').claims.sub)}', '${FIX_ID(2101)}');`,
    `select is((tests.as_user(${c(hr)}, 'select 1 from public.contracts where id = ''${FIX_ID(2101)}''')).n, 1, 'contracts: HR reads the draft while the request is open');`,
    `select is((tests.as_user(${c(hr)}, 'update public.contracts set insured_count = 1 where id = ''${FIX_ID(2101)}''')).n, 1, 'contracts: HR fills the asked draft');`,
    `update public.tasks set status = 'done' where id = '${FIX_ID(2102)}';`,
    `select is((tests.as_user(${c(hr)}, 'select 1 from public.contracts where id = ''${FIX_ID(2101)}''')).n, 0, 'contracts: hidden again once the request is done');`,
    `select is((tests.as_user(${c(hr)}, 'update public.contracts set insured_count = 1 where id = ''${FIX_ID(2101)}''')).n, 0, 'contracts: and no longer writable');`,
    `select is(tests.count_as(${c(who('operator'))}, 'payments'), (select count(*) from public.payments), 'payments: the operator reads the payments of the contract card');`,
    `select is(tests.count_as(${c(hr)}, 'payments'), 0::bigint, 'payments: HR reads none');`,
    '-- assistance aggregates: counts and sums of the own company (MIG staff: every company)',
    `select is(${valueAs(asstOp, `select (select string_agg(k, ',' order by k) from jsonb_object_keys(app.fact_assistance_kpi_figures('${asstId}', (extract(epoch from now()) * 1000)::bigint, current_date, 24)) k)`)}, 'agreed,answered,answeredMs,complaints,decided,losses,onTime,premium,reviewed,rosterSize', 'kpi figures: only counts and sums of the own company');`,
    `select is(${valueAs(asstOp, `select app.fact_assistance_kpi_figures('${otherAssistance}', 0, current_date, 24)::text`)}, 'denied', 'kpi figures: not of another company');`,
    `select is(${valueAs(who('sales_manager'), `select (app.fact_assistance_kpi_figures('${asstId}', 0, current_date, 24) ? 'premium')::text`)}, 'true', 'kpi figures: any MIG employee (the list of companies)');`,
    `select is(${valueAs(who('insured'), `select app.fact_assistance_kpi_figures('${asstId}', 0, current_date, 24)::text`)}, 'denied', 'kpi figures: the insured person is refused');`,
    `select is(${valueAs(who('asst_billing'), `select (app.fact_assistance_fee_figures('${asstId}', to_char(current_date, 'YYYY-MM'), date_trunc('month', current_date)::date, current_date, current_date) ? 'insuredCount')::text`)}, 'true', 'fee figures: the billing of the own company');`,
    `select is(${valueAs(who('asst_billing'), `select app.fact_assistance_fee_figures('${otherAssistance}', '2026-01', '2026-01-01', '2026-01-31', current_date)::text`)}, 'denied', 'fee figures: not of another company');`,
    `select is(${valueAs(who('legal'), `select (app.fact_assistance_list_figures('${asstId}', 0, current_date) ? 'clientsCount')::text`)}, 'true', 'list figures: a MIG employee');`,
    `select is(${valueAs(asstOp, `select app.fact_assistance_list_figures('${asstId}', 0, current_date)::text`)}, 'denied', 'list figures: not for an assistance company');`,
    `select is(${valueAs(who('underwriter'), `select jsonb_array_length(app.fact_assistance_report_figures(current_date))`)}, (select (count(*) + 1)::text from public.assistances), 'report figures: a row per company and MIG for reports.read');`,
    `select is(${valueAs(who('operator'), `select app.fact_assistance_report_figures(current_date)::text`)}, 'denied', 'report figures: a MIG role without reports.read is refused');`,
    `select is(${valueAs(asstAdmin, `select (app.fact_assist_desktop_counters('${assistanceId}', (extract(epoch from now()) * 1000)::bigint, current_date, 60) ? 'openCases')::text`)}, 'true', 'desktop counters: every user of the own company');`,
    `select is(${valueAs(asstAdmin, `select app.fact_assist_desktop_counters('${assistanceId === asstId ? otherAssistance : asstId}', 0, current_date, 60)::text`)}, 'denied', 'desktop counters: not of another company');`,
    `select is(${valueAs(who('operator'), `select app.fact_assist_desktop_counters('${asstId}', 0, current_date, 60)::text`)}, 'denied', 'desktop counters: MIG staff use their own screens');`,
    '-- a former assistance company reads the persons and requests of a policy for 12 months after (read-only)',
    `insert into public.assignments (policy_id, assistance_id, "from", "to", set_by_id, set_at) values ('${formerPolicy.id}', '${asstId}', current_date - 200, current_date - 30, '${String(who('underwriter').claims.sub)}', now());`,
    `select ok((tests.as_user(${c(asstOp)}, 'select 1 from public.insured where policy_id = ''${formerPolicy.id}''')).n > 0, 'former access: the persons of a policy served until a month ago');`,
    `select ok((tests.as_user(${c(asstOp)}, 'select 1 from public.policies where id = ''${formerPolicy.id}''')).n = 1, 'former access: the policy too');`,
    `select is((tests.as_user(${c(asstOp)}, 'select 1 from public.insured where policy_id = ''${neverPolicy.id}''')).n, 0, 'former access: never a policy the company did not serve');`,
    `update public.assignments set "from" = current_date - 600, "to" = current_date - 400 where policy_id = '${formerPolicy.id}' and assistance_id = '${asstId}' and "to" = current_date - 30;`,
    `select is((tests.as_user(${c(asstOp)}, 'select 1 from public.insured where policy_id = ''${formerPolicy.id}''')).n, 0, 'former access: ends 12 months after the assignment');`,
    '-- guarantees: an assistance company writes the referral letter of its own current client only',
    `create temp table sc_letter as select * from public.guarantees limit 1;`,
    `update sc_letter set id = '${FIX_ID(2201)}', number = number || '#r', assistance_id = '${asstId}', policy_id = '${servedPolicyToday}', created_at = now();`,
    `grant select on sc_letter to authenticated;`,
    `select is((tests.as_user(${c(asstOp)}, 'insert into public.guarantees select * from sc_letter')).n, 1, 'guarantees: a referral letter of a policy the company serves today');`,
    `update sc_letter set id = '${FIX_ID(2202)}', number = number || '#s', policy_id = '${neverPolicy.id}';`,
    `select is((tests.as_user(${c(asstOp)}, 'insert into public.guarantees select * from sc_letter')).n, -1, 'guarantees: not of a policy the company does not serve');`,
    `update sc_letter set id = '${FIX_ID(2203)}', number = number || '#u', policy_id = '${servedPolicyToday}', assistance_id = '${otherAssistance}';`,
    `select is((tests.as_user(${c(asstOp)}, 'insert into public.guarantees select * from sc_letter')).n, -1, 'guarantees: not on behalf of another company');`,
    `select is((tests.as_user(${c(who('asst_billing'))}, 'insert into public.guarantees select * from sc_letter')).n, -1, 'guarantees: the billing of a company writes no letters');`,
    '-- app.fact_receipt_twins: possible duplicates of a claim the caller sees, without the person',
    `select is(${valueAs(who('insured'), `select coalesce(bool_and(x ->> 'insuredId' in ('other', '${myClaim.insuredId}')), true)::text from jsonb_array_elements(app.fact_receipt_twins('${myClaim.id}')) x`)}, 'true', 'receipt twins: another person is only «other»');`,
    `select is(${valueAs(who('insured'), `select coalesce(bool_and(not (x ? 'insuredName') and not (x ? 'clientId')), true)::text from jsonb_array_elements(app.fact_receipt_twins('${myClaim.id}')) x`)}, 'true', 'receipt twins: no name or client');`,
    `select is(${valueAs(who('insured'), `select app.fact_receipt_twins('${strangerClaim.id}')::text`)}, 'denied', 'receipt twins: not of a claim the caller does not see');`,
    `select is(${valueAs(hr, `select app.fact_receipt_twins('${myClaim.id}')::text`)}, 'denied', 'receipt twins: HR is refused');`,
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
