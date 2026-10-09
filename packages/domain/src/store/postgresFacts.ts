/*
 * The narrow facts (store/facts.ts) of a person in the API: each method calls its SQL function of schema `app`
 * (store/sql/facts.ts) as the person — the function checks the permission and returns only the value.
 */
import type { LimitCategory, ProgramCode } from '@mig/contracts';
import { LIMIT_OF_SERVICE } from '../assistance';
import { CLAIM_TO_LIMIT } from '../claims';
import type { LegalFormCode } from '../config/legalForms';
import type { Facts } from './facts';
import type { PiiCrypto } from './pii';
import type { Sql } from './postgres';

export function pgFacts(sql: Sql, crypto: PiiCrypto): Facts {
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
    async redeemCardToken(code, nowMs) {
      const out = await one<{ status: 'ok' | 'used' | 'stale'; insuredId?: string }>('app.fact_redeem_card_token($1::text, $2::text, $3::bigint)', [
        'shortCode' in code ? code.shortCode : null,
        'token' in code ? code.token : null,
        nowMs,
      ]);
      return out.status === 'ok' ? { status: 'ok', insuredId: out.insuredId! } : { status: out.status };
    },
    async matchPolicyPinfl(policyNumber, pinfl) {
      return (await one<string | null>('app.fact_match_policy_pinfl($1::text, $2::bytea)', [policyNumber, await crypto.hmac(pinfl)])) ?? null;
    },
    async visitPatient(visitId) {
      return (await one('app.fact_visit_patient($1::uuid)', [visitId])) ?? null;
    },
    async visitPolicyPeriod(visitId) {
      return (await one('app.fact_visit_policy_period($1::uuid)', [visitId])) ?? null;
    },
    async policyRouting(policyId) {
      return one('app.fact_policy_routing($1::uuid)', [policyId]);
    },
    async fileKind(fileId) {
      return (await one<'guarantee' | 'other' | null>('app.fact_file_kind($1::uuid)', [fileId])) ?? null;
    },
    async takenSlots(clinicId) {
      return one('app.fact_taken_slots($1::uuid)', [clinicId]);
    },
    async limitSums(insuredId, mode, today) {
      const out = await one<{ program: ProgramCode | null; used: Partial<Record<LimitCategory, number | string>>; reserved: Partial<Record<LimitCategory, number | string>> } | null>(
        'app.fact_limit_sums($1::uuid, $2::text, $3::date, $4::jsonb, $5::jsonb)',
        [insuredId, mode, today, JSON.stringify(CLAIM_TO_LIMIT), JSON.stringify(LIMIT_OF_SERVICE)],
      );
      if (!out) return null;
      const all = (x: Partial<Record<LimitCategory, number | string>>): Record<LimitCategory, number> => ({
        outpatient: Number(x.outpatient ?? 0),
        dental: Number(x.dental ?? 0),
        medicines: Number(x.medicines ?? 0),
        inpatient: Number(x.inpatient ?? 0),
      });
      return { program: out.program, used: all(out.used), reserved: all(out.reserved) };
    },
    async coverageBrief(insuredId) {
      return (await one('app.fact_coverage_brief($1::uuid)', [insuredId])) ?? null;
    },
    async clientPipeline(clientId) {
      return one('app.fact_client_pipeline($1::uuid)', [clientId]);
    },
    async certificateData(policyId, insuredId) {
      return (await one('app.fact_certificate_data($1::uuid, $2::uuid)', [policyId, insuredId])) ?? null;
    },
    async migSignatory(staffId) {
      return (await one('app.fact_mig_signatory($1::uuid)', [staffId])) ?? null;
    },
    async dealNumber(dealId) {
      return (await one<string | null>('app.fact_deal_number($1::uuid)', [dealId])) ?? null;
    },
    async contractQuote(dealId, quoteId) {
      return one('app.fact_contract_quote($1::uuid, $2::uuid)', [dealId, quoteId]);
    },
  };
}
