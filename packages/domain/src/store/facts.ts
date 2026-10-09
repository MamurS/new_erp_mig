/*
 * Narrow facts (docs/PRIVILEGED_AUDIT.md): what a person must learn about rows their row-level security does
 * not let them read — a count, a legal form, the anonymous figures of a client's claims, whether a slot is
 * taken — or a side effect they cause in another party's feed. Each method is one SQL function of schema `app`
 * in the API (SECURITY DEFINER, fixed search_path, it checks app.active() and the permission itself and returns
 * only the value: store/sql/facts.ts), and the same TypeScript over unrestricted repositories in the mock and
 * in the system repositories of the API (`genericFacts`). The services keep their logic: a fact returns the
 * minimal rows in storage order and the service picks, sorts and sums exactly as before.
 */
import type { AssistanceAssignment, AuditAction, AuditEntry, ClaimCategory, ClaimStatus, DealStage, LimitCategory, PolicyStatus, PriceListItem, ProgramCode, Quote, UUID } from '@mig/contracts';
import type { ClientPipeline, SignatoryOption } from '@mig/contracts/dto';
import type { LegalFormCode } from '../config/legalForms';
import type { InsuredRow } from './db';
import { LIMIT_OF_SERVICE } from '../assistance';
import { CLAIM_TO_LIMIT } from '../claims';
import type { LimitMode } from '../config/dmsParameters';
import { limitPoolOf } from '../family';
import { DAY, parseIso } from '../lib/time';
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
  /**
   * A card code shown at a clinic desk (the short code or the QR token): redeemed once — `used` when it was redeemed
   * before, `stale` when it is unknown or expired.
   */
  redeemCardToken(code: { shortCode: string } | { token: string }, nowMs: number): Promise<{ status: 'ok'; insuredId: UUID } | { status: 'used' | 'stale' }>;
  /** The active person of the policy with this number (any case) and PINFL, before a visit exists. */
  matchPolicyPinfl(policyNumber: string, pinfl: string): Promise<UUID | null>;
  /** The patient of a visit (also after it closed): only the name and the policy. */
  visitPatient(visitId: UUID): Promise<VisitPatient | null>;
  /** Term of the policy of a visit's patient (the registry line checks of the clinic). */
  visitPolicyPeriod(visitId: UUID): Promise<{ startDate: string; endDate: string } | null>;
  /** Which assistance company serves a policy from which date (routing), in storage order. */
  policyRouting(policyId: UUID): Promise<Routing[]>;
  /** Whether a file exists and whether it is a guarantee-letter attachment (403 or 404 for a hidden file). */
  fileKind(fileId: UUID): Promise<'guarantee' | 'other' | null>;
  /**
   * Used and reserved sums of a person's limits by category (claims of the limit pool, the transferred consumption,
   * registry lines accepted by an assistance, approved guarantee letters) and the program of the policy; an approved
   * letter of the pool past its validity is saved as expired on the way (the lazy clock). Only the sums.
   */
  limitSums(insuredId: UUID, mode: LimitMode, today: string): Promise<LimitSums | null>;
  /** The coverage facts of a person: the term and program of the policy, the person's own dates and status. */
  coverageBrief(insuredId: UUID): Promise<CoverageBrief | null>;
  /** Start times of the live appointments of a clinic (booked by anyone): a free slot is one not taken. */
  takenSlots(clinicId: UUID): Promise<string[]>;
  /** Where a client is in the sales pipeline: the open (or last) deal, its contract and the first unpaid invoice. */
  clientPipeline(clientId: UUID): Promise<ClientPipeline>;
  /** Certificates of a policy (one person's when `insuredId` is given): document data of active persons with a number. */
  certificateData(policyId: UUID, insuredId: UUID | null): Promise<CertificateData | null>;
  /** A MIG signatory of a contract as the documents show it (name, role, basis); null when not a signatory. */
  migSignatory(staffId: UUID): Promise<SignatoryOption | null>;
  /** The number of a deal (shown on its contract). */
  dealNumber(dealId: UUID): Promise<string | null>;
  /**
   * The quote of a contract of the deal as its card shows it (`quoteId`, otherwise the deal's latest) and whether the
   * quote `quoteId` allows a group below the minimum.
   */
  contractQuote(dealId: UUID, quoteId: UUID | null): Promise<{ quote: ContractQuote | null; belowMinException: boolean }>;
}

export interface CertificateData {
  contractNumber: string | null;
  clientName: string | null;
  clientLegalForm?: LegalFormCode;
  rows: { insuredId: UUID; fullName: string; certificateNumber: string; insuredFrom: string }[];
}

export type ContractQuote = Pick<Quote, 'id' | 'premiumEmployee' | 'premiumFamily' | 'total' | 'program'>;

export interface LimitSums {
  program: ProgramCode | null;
  used: Record<LimitCategory, number>;
  reserved: Record<LimitCategory, number>;
}

export interface CoverageBrief {
  person: { id: UUID; status: InsuredRow['status']; insuredFrom: string; excludedFrom?: string };
  policy: { id: UUID; number: string; program: ProgramCode; startDate: string; endDate: string; status: PolicyStatus } | null;
}

/** Claim statuses whose amount counts as used limit. */
export const PAID_LIKE_STATUSES = ['approved', 'to_pay', 'paid'] as const;

export interface VisitPatient {
  id: UUID;
  fullName: string;
  policyId: UUID;
}

/** An assignment as routing reads it. */
export type Routing = Pick<AssistanceAssignment, 'policyId' | 'assistanceId' | 'from' | 'to'>;

type Base = Omit<Repos, 'facts'>;

const zeroLimits = (): Record<LimitCategory, number> => ({ outpatient: 0, dental: 0, medicines: 0, inpatient: 0 });

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
    async redeemCardToken(code, nowMs) {
      const row = 'shortCode' in code ? await r.cardTokens.first({ where: { shortCode: code.shortCode } }) : await r.cardTokens.get(code.token);
      if (row?.usedAt) return { status: 'used' };
      if (!row || row.expiresAt < nowMs) return { status: 'stale' };
      await r.cardTokens.update(row.token, { usedAt: nowMs });
      return { status: 'ok', insuredId: row.insuredId };
    },
    async matchPolicyPinfl(policyNumber, pinfl) {
      const policy = (await r.policies.list()).find((p) => p.number.toUpperCase() === policyNumber.toUpperCase());
      const person = policy ? await r.insured.first({ where: { policyId: policy.id, pinfl, status: 'active' } }) : null;
      return person?.id ?? null;
    },
    async visitPatient(visitId) {
      const v = await r.visits.get(visitId);
      const i = v ? await r.insured.get(v.insuredId) : null;
      return i ? { id: i.id, fullName: i.fullName, policyId: i.policyId } : null;
    },
    async visitPolicyPeriod(visitId) {
      const v = await r.visits.get(visitId);
      const i = v ? await r.insured.get(v.insuredId) : null;
      const p = i ? await r.policies.get(i.policyId) : null;
      return p ? { startDate: p.startDate, endDate: p.endDate } : null;
    },
    async policyRouting(policyId) {
      return (await r.assignments.list({ where: { policyId } })).map((a) => ({ policyId: a.policyId, assistanceId: a.assistanceId, from: a.from, ...(a.to ? { to: a.to } : {}) }));
    },
    async fileKind(fileId) {
      const f = await r.files.get(fileId);
      return f ? (f.guaranteeId ? 'guarantee' : 'other') : null;
    },
    async takenSlots(clinicId) {
      return (await r.appointments.list({ where: { clinicId, status: { notIn: ['cancelled', 'declined'] } } })).map((a) => a.startsAt);
    },
    async limitSums(insuredId, mode, today) {
      const i = await r.insured.get(insuredId);
      if (!i) return null;
      const policy = await r.policies.get(i.policyId);
      const fromMs = policy ? parseIso(policy.startDate) : 0;
      const used = zeroLimits();
      const reserved = zeroLimits();
      const pool = new Set(mode === 'individual' ? [i.id] : limitPoolOf(i, await r.insured.list({ where: { policyId: i.policyId } }), mode));
      for (const c of await r.claims.list({ where: { insuredId: { in: [...pool] }, status: { in: [...PAID_LIKE_STATUSES] } } })) {
        if (parseIso(c.serviceDate) < fromMs - 7 * DAY) continue;
        used[CLAIM_TO_LIMIT[c.category]] += c.amountApproved ?? c.amountClaimed;
      }
      const prices = new Map<UUID, PriceListItem[]>();
      const categoryOf = async (clinicId: UUID, code: string): Promise<LimitCategory> => {
        let list = prices.get(clinicId);
        if (!list) prices.set(clinicId, (list = (await r.priceLists.get(clinicId))?.items ?? []));
        return LIMIT_OF_SERVICE[list.find((p) => p.code === code)?.category ?? 'outpatient'];
      };
      for (const person of await r.insured.list({ where: { id: { in: [...pool] } } })) {
        // Used before the transfer from the previous system (as of the migration date) counts too.
        for (const [cat, amount] of Object.entries(person.migratedUsed ?? {}) as [LimitCategory, number][]) used[cat] += amount;
        // Approved guarantee letters reserve the limit (one past its validity expires: the lazy clock saves it).
        for (const g of await r.guarantees.list({ where: { insuredId: person.id } })) {
          if (g.status === 'approved' && g.validUntil && g.validUntil < today) {
            g.status = 'expired';
            await r.guarantees.update(g.id, { status: g.status });
          }
          if (g.status !== 'approved') continue;
          reserved[await categoryOf(g.clinicId, g.serviceCode)] += g.approvedAmount ?? g.estimatedCost;
        }
        // Lines accepted by an assistance count as used until a claim of the line exists (ASSISTANCE_SPEC §13.6).
        const visits = new Set((await r.visits.list({ where: { insuredId: person.id } })).map((v) => v.id));
        if (!visits.size) continue;
        const claimed = new Set((await r.claims.list({ where: { insuredId: person.id, registryLineId: { isNull: false }, status: { in: [...PAID_LIKE_STATUSES] } } })).filter((c) => c.registryLineId).map((c) => c.registryLineId));
        for (const reg of await r.registries.list()) {
          for (const l of reg.lines) {
            if (!l.visitId || !visits.has(l.visitId) || l.status !== 'accepted' || (l.payer ?? 'mig') === 'mig' || claimed.has(l.id)) continue;
            if (parseIso(l.serviceDate) < fromMs - 7 * DAY) continue;
            used[await categoryOf(reg.clinicId, l.serviceCode)] += l.amount;
          }
        }
      }
      return { program: policy?.program ?? null, used, reserved };
    },
    async coverageBrief(insuredId) {
      const i = await r.insured.get(insuredId);
      if (!i) return null;
      const p = await r.policies.get(i.policyId);
      return {
        person: { id: i.id, status: i.status, insuredFrom: i.insuredFrom, ...(i.excludedFrom ? { excludedFrom: i.excludedFrom } : {}) },
        policy: p ? { id: p.id, number: p.number, program: p.program, startDate: p.startDate, endDate: p.endDate, status: p.status } : null,
      };
    },
    async clientPipeline(clientId) {
      const client = await r.clients.get(clientId);
      const hasPolicy = !!client?.activePolicyId || (await r.insured.exists({ clientId }));
      const hasHr = await r.hrUsers.exists({ companyId: clientId });
      const deals = await r.deals.list({ where: { clientId }, orderBy: [['updatedAt', 'desc']] });
      const deal = deals.find((x) => x.stage !== 'lost' && x.stage !== 'active') ?? deals[0];
      if (!deal) return { hasPolicy, hasHr };
      const c = (await r.contracts.list({ where: { dealId: deal.id } })).sort((a, b) => a.version - b.version).at(-1);
      const invoice = c ? await r.invoices.first({ where: { contractId: c.id, status: { ne: 'paid' } }, orderBy: [['dueDate', 'asc']] }) : null;
      return {
        hasPolicy,
        hasHr,
        dealId: deal.id,
        dealNumber: deal.number,
        stage: deal.stage,
        ...(c ? { contractId: c.id, contractNumber: c.number, contractStatus: c.status } : {}),
        ...(invoice ? { invoiceId: invoice.id, invoiceNumber: invoice.number } : {}),
      };
    },
    async certificateData(policyId, insuredId) {
      const p = await r.policies.get(policyId);
      if (!p) return null;
      const c = p.contractId ? await r.contracts.get(p.contractId) : null;
      const client = await r.clients.get(p.clientId);
      const rows = (await r.insured.list({ where: { policyId: p.id, status: 'active', ...(insuredId ? { id: insuredId } : {}) } }))
        .filter((i) => i.certificateNumber)
        .map((i) => ({ insuredId: i.id, fullName: i.fullName, certificateNumber: i.certificateNumber!, insuredFrom: i.insuredFrom }));
      return { contractNumber: c?.number ?? null, clientName: client?.name ?? null, ...(client?.legalForm ? { clientLegalForm: client.legalForm } : {}), rows };
    },
    async migSignatory(staffId) {
      const s = await r.staff.get(staffId);
      return s?.signatory?.canSign ? { id: s.id, fullName: s.fullName, role: s.role, basis: s.signatory.basis } : null;
    },
    async dealNumber(dealId) {
      return (await r.deals.get(dealId))?.number ?? null;
    },
    async contractQuote(dealId, quoteId) {
      const own = quoteId ? await r.quotes.get(quoteId) : null;
      const q = quoteId ? own : (await r.quotes.list({ where: { dealId } })).at(-1);
      return {
        quote: q ? { id: q.id, premiumEmployee: q.premiumEmployee, premiumFamily: q.premiumFamily, total: q.total, program: q.program } : null,
        belowMinException: !!own?.belowMinException,
      };
    },
  };
}
