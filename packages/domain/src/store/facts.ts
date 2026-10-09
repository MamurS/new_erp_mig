/*
 * Narrow facts (docs/PRIVILEGED_AUDIT.md): what a person must learn about rows their row-level security does
 * not let them read — a count, a legal form, the anonymous figures of a client's claims, whether a slot is
 * taken — or a side effect they cause in another party's feed. Each method is one SQL function of schema `app`
 * in the API (SECURITY DEFINER, fixed search_path, it checks app.active() and the permission itself and returns
 * only the value: store/sql/facts.ts), and the same TypeScript over unrestricted repositories in the mock and
 * in the system repositories of the API (`genericFacts`). The services keep their logic: a fact returns the
 * minimal rows in storage order and the service picks, sorts and sums exactly as before.
 */
import type { AuditEntry, ClaimCategory, ClaimStatus, UUID } from '@mig/contracts';
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
}

type Base = Omit<Repos, 'facts'>;


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
  };
}
