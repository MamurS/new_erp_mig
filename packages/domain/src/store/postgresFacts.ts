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
  };
}
