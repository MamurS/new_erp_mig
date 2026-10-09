/*
 * The narrow facts (store/facts.ts) of a person in the API: each method calls its SQL function of schema `app`
 * (store/sql/facts.ts) as the person — the function checks the permission and returns only the value.
 */
import type { LegalFormCode } from '../config/legalForms';
import type { Facts } from './facts';
import type { PiiCrypto } from './pii';
import type { Sql } from './postgres';

export function pgFacts(sql: Sql, _crypto: PiiCrypto): Facts {
  const one = async <T>(text: string, params: readonly unknown[]): Promise<T> => (await sql.query(`select ${text} as v`, params)).rows[0]?.v as T;
  return {
    async clientInsuredCount(clientId) {
      return Number(await one('app.fact_client_insured_count($1::uuid)', [clientId]));
    },
    async clientLegalForm(clientId) {
      return (await one<LegalFormCode | null>('app.fact_client_legal_form($1::uuid)', [clientId])) ?? undefined;
    },
    async clientClaimFigures(clientId) {
      return one('app.fact_client_claim_figures($1::uuid)', [clientId]);
    },
    async clientInvoiceFigures(clientId) {
      return one('app.fact_client_invoice_figures($1::uuid)', [clientId]);
    },
    async policyBrief(policyId) {
      return (await one('app.fact_policy_brief($1::uuid)', [policyId])) ?? null;
    },
    async clientHistory(clientId, limit) {
      return one('app.fact_client_history($1::uuid, $2::integer)', [clientId, limit]);
    },
    async companyClaimCount(clientId, sinceMs) {
      return Number(await one('app.fact_company_claim_count($1::uuid, $2::bigint)', [clientId, Math.floor(sinceMs)]));
    },
    async personAccessLog(insuredId) {
      return one('app.fact_person_access_log($1::uuid)', [insuredId]);
    },
    async ownAuditEntries(actorId, actions, limit) {
      return one('app.fact_own_audit_entries($1::uuid, $2::text[], $3::integer)', [actorId, [...actions], limit ?? null]);
    },
    async advanceDeal(dealId, stage, order, at) {
      return !!(await one<boolean>('app.fact_advance_deal($1::uuid, $2::text, $3::text[], $4::timestamptz)', [dealId, stage, [...order], at]));
    },
    async pushClinicEvent(row) {
      await one('app.fact_push_clinic_event($1::uuid, $2::uuid, $3::timestamptz, $4::text)', [row.id, row.clinicId, row.at, row.text]);
    },
    async appendClientLog(clientId, entry) {
      await one('app.fact_append_client_log($1::uuid, $2::jsonb)', [clientId, JSON.stringify(entry)]);
    },
  };
}
