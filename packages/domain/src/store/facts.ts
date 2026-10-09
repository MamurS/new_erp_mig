/*
 * Narrow facts (docs/PRIVILEGED_AUDIT.md): what a person must learn about rows their row-level security does
 * not let them read — a count, a legal form, the anonymous figures of a client's claims, whether a slot is
 * taken — or a side effect they cause in another party's feed. Each method is one SQL function of schema `app`
 * in the API (SECURITY DEFINER, fixed search_path, it checks app.active() and the permission itself and returns
 * only the value: store/sql/facts.ts), and the same TypeScript over unrestricted repositories in the mock and
 * in the system repositories of the API (`genericFacts`). The services keep their logic: a fact returns the
 * minimal rows in storage order and the service picks, sorts and sums exactly as before.
 */
import type { AuditAction, AuditEntry, ClaimCategory, ClaimStatus, DealStage, UUID } from '@mig/contracts';
import type { LegalFormCode } from '../config/legalForms';
import { parseIso } from '../lib/time';
import type { Repos } from './repo';

/** Anonymous figures of one claim (no number, person, provider or diagnosis). */
export interface ClaimFigure {
  category: ClaimCategory;
  serviceDate: string;
  createdAt: string;
  status: ClaimStatus;
  amountClaimed: number;
  amountApproved?: number;
}

export interface InvoiceFigure {
  number: string;
  amount: number;
  issuedAt: string;
}

export interface PolicyBrief {
  number: string;
  startDate: string;
}

export interface Facts {
  /** Active insured persons of a client (the counter of the client card). */
  clientInsuredCount(clientId: UUID): Promise<number>;
  /** Legal form shown next to a client's name. */
  clientLegalForm(clientId: UUID): Promise<LegalFormCode | undefined>;
  /** Figures of every claim of a client, in storage order (loss statistics, the client card). */
  clientClaimFigures(clientId: UUID): Promise<ClaimFigure[]>;
  /** Number, amount and date of every invoice of a client, in storage order (the last invoice of the client card). */
  clientInvoiceFigures(clientId: UUID): Promise<InvoiceFigure[]>;
  /** Number and start of a policy of a client the person reads (the client card). */
  policyBrief(policyId: UUID): Promise<PolicyBrief | null>;
  /**
   * Audit entries about a client, its policies, claims and offers, without openings of personal and medical data
   * and without the reason, newest first as stored, at most `limit`.
   */
  clientHistory(clientId: UUID, limit: number): Promise<AuditEntry[]>;
  /** Claims of the active employees (and their families) of a company created since `sinceMs` (HR statistics). */
  companyClaimCount(clientId: UUID, sinceMs: number): Promise<number>;
  /** Openings of a person's personal and medical data (the access log of the card), as stored. */
  personAccessLog(insuredId: UUID): Promise<AuditEntry[]>;
  /** The actor's own audit entries of the given actions, as stored (at most `limit`). */
  ownAuditEntries(actorId: UUID, actions: readonly AuditAction[], limit?: number): Promise<AuditEntry[]>;
  /**
   * Moves a deal forward along `order` (never back, never out of `lost`); true when the deal exists and the step is
   * not backwards (the caller then writes the event).
   */
  advanceDeal(dealId: UUID, stage: DealStage, order: readonly DealStage[], at: string): Promise<boolean>;
  /** An event in the feed of a clinic cabinet (newest first, the newest 500 kept). */
  pushClinicEvent(row: { id: UUID; clinicId: UUID; at: string; text: string }): Promise<void>;
  /** A line at the top of a client's activity log (a request acted on). */
  appendClientLog(clientId: UUID, entry: { at: string; text: string }): Promise<void>;
}

type Base = Omit<Repos, 'facts'>;

/** Events a clinic cabinet keeps (the mock kept its arrays short). */
export const CLINIC_EVENTS_KEPT = 500;


/** The facts over repositories without row-level security (the mock, the API's system repositories). */
export function genericFacts(r: Base): Facts {
  return {
    async clientInsuredCount(clientId) {
      return r.insured.count({ clientId, status: 'active' });
    },
    async clientLegalForm(clientId) {
      return (await r.clients.get(clientId))?.legalForm;
    },
    async clientClaimFigures(clientId) {
      return (await r.claims.list({ where: { clientId } })).map((c) => ({
        category: c.category,
        serviceDate: c.serviceDate,
        createdAt: c.createdAt,
        status: c.status,
        amountClaimed: c.amountClaimed,
        ...(c.amountApproved !== undefined && c.amountApproved !== null ? { amountApproved: c.amountApproved } : {}),
      }));
    },
    async clientInvoiceFigures(clientId) {
      return (await r.invoices.list({ where: { clientId } })).map((i) => ({ number: i.number, amount: i.amount, issuedAt: i.issuedAt }));
    },
    async policyBrief(policyId) {
      const p = await r.policies.get(policyId);
      return p ? { number: p.number, startDate: p.startDate } : null;
    },
    async clientHistory(clientId, limit) {
      const ids = [
        clientId,
        ...(await r.policies.list({ where: { clientId } })).map((p) => p.id),
        ...(await r.claims.list({ where: { clientId } })).map((x) => x.id),
        ...(await r.kp.list({ where: { clientId } })).map((x) => x.id),
      ];
      const list = await r.audit.list({ where: { targetId: { in: ids }, action: { notIn: ['reveal_pii', 'open_medical'] } }, limit });
      return list.map(({ reason: _r, ...e }) => e);
    },
    async companyClaimCount(clientId, sinceMs) {
      const ids = (await r.insured.list({ where: { clientId, status: 'active' } })).map((e) => e.id);
      return (await r.claims.list({ where: { insuredId: { in: ids } } })).filter((c) => parseIso(c.createdAt) >= sinceMs).length;
    },
    async personAccessLog(insuredId) {
      return r.audit.list({ where: { targetId: insuredId, action: { in: ['reveal_pii', 'open_medical'] } } });
    },
    async ownAuditEntries(actorId, actions, limit) {
      return r.audit.list({ where: { actorId, action: { in: [...actions] } }, ...(limit !== undefined ? { limit } : {}) });
    },
    async advanceDeal(dealId, stage, order, at) {
      const deal = await r.deals.get(dealId);
      if (!deal || deal.stage === 'lost') return false;
      if (order.indexOf(stage) <= order.indexOf(deal.stage) && stage !== deal.stage) return false;
      if (stage !== deal.stage) await r.deals.update(deal.id, { stage, updatedAt: at });
      return true;
    },
    async pushClinicEvent(row) {
      await r.clinicEvents.insert(row, { at: 'start' });
      const extra = await r.clinicEvents.list({ offset: CLINIC_EVENTS_KEPT });
      if (extra.length) await r.clinicEvents.removeWhere({ id: { in: extra.map((x) => x.id) } });
    },
    async appendClientLog(clientId, entry) {
      const client = await r.clients.get(clientId);
      if (client) await r.clients.update(client.id, { log: [entry, ...(client.log ?? [])] });
    },
  };
}
