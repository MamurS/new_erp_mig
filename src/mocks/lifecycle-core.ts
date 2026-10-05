/*
 * Server-side rules of the contract lifecycle (LIFECYCLE_SPEC): deal stages and events, signing of
 * contracts and endorsements, invoices, coming into force (policy, insured persons, certificates),
 * endorsement lines and their application, termination and expiry.
 */
import type {
  ChangeRequest,
  ClientDocument,
  Contract,
  Deal,
  DealStage,
  Endorsement,
  Invoice,
  KpDocument,
  Policy,
  Quote,
  Signing,
  StaffUser,
  UUID,
} from '@/shared/types';
import type { ContractSummary, DealView, EndorsementSummary, SignatoryOption } from '@/shared/types/dto';
import {
  activationDate,
  addDays,
  addSignature,
  certificateNumber,
  endorsementNumber,
  fullySignedAt,
  isFullySigned,
} from '@/shared/domain/contracts';
import { addLine, CHANGE_TYPE_LABEL, excludeLine, programChangeLine, REFUND_RULES } from '@/shared/domain/endorsements';
import { TARIFF_BASE_KEY } from '@/shared/config/dmsParameters';
import { ROLE_LABEL } from '@/shared/domain/labels';
import type { ChangeRequestRow, ClientRow, Db, InsuredRow } from './db';
import { createInsured, nextPolicyNumber, refreshPolicyTotals } from './policy-core';
import { notifyAssistance, syncAssistance } from './assistance-core';
import { dmsParam } from './params';
import { conflict, notFound } from './http';
import { randomId } from './rng';
import { isoDay, parseIso, tzIso } from './time';

export const todayIso = () => isoDay(Date.now());

export function staffName(d: Db, id: UUID | undefined): string | undefined {
  return id ? d.staff.find((s) => s.id === id)?.fullName : undefined;
}

export function dealOf(d: Db, id: UUID): Deal {
  const deal = d.deals.find((x) => x.id === id);
  if (!deal) throw notFound();
  return deal;
}

export function contractOf(d: Db, id: UUID): Contract {
  const c = d.contracts.find((x) => x.id === id);
  if (!c) throw notFound();
  return c;
}

export function clientRow(d: Db, id: UUID): ClientRow {
  const c = d.clients.find((x) => x.id === id);
  if (!c) throw notFound();
  return c;
}

export function dealEvent(d: Db, dealId: UUID, actorName: string, text: string): void {
  d.dealEvents.unshift({ id: randomId(), dealId, at: tzIso(Date.now()), actorName, text });
}

const STAGE_ORDER: DealStage[] = ['lead', 'census', 'quote', 'kp_sent', 'kp_accepted', 'contract_draft', 'contract_review', 'contract_sent', 'signing', 'awaiting_payment', 'active'];

/** Moves a deal forward (never back, never out of `lost`), with an event in its feed. */
export function moveDeal(d: Db, dealId: UUID | undefined, stage: DealStage, actorName: string, text?: string): void {
  const deal = dealId ? d.deals.find((x) => x.id === dealId) : undefined;
  if (!deal || deal.stage === 'lost') return;
  if (STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(deal.stage) && stage !== deal.stage) return;
  if (stage !== deal.stage) {
    deal.stage = stage;
    deal.updatedAt = tzIso(Date.now());
  }
  if (text) dealEvent(d, deal.id, actorName, text);
}

export const latestQuote = (d: Db, dealId: UUID): Quote | undefined => d.quotes.filter((q) => q.dealId === dealId).at(-1);
export const dealKp = (d: Db, dealId: UUID): KpDocument | undefined => d.kp.filter((k) => k.dealId === dealId && k.status !== 'revoked').at(-1);
export const dealContract = (d: Db, dealId: UUID): Contract | undefined => d.contracts.filter((c) => c.dealId === dealId).sort((a, b) => a.version - b.version).at(-1);

export function toContractSummary(c: Contract): ContractSummary {
  return { id: c.id, number: c.number, version: c.version, status: c.status, total: c.params.total, startDate: c.params.startDate, endDate: c.params.endDate };
}

export function toDealView(d: Db, deal: Deal): DealView {
  const q = latestQuote(d, deal.id);
  const kp = dealKp(d, deal.id);
  const c = dealContract(d, deal.id);
  const client = d.clients.find((x) => x.id === deal.clientId);
  return {
    ...deal,
    clientName: client ? `${client.legalForm} «${client.name}»` : '—',
    ownerName: staffName(d, deal.ownerId) ?? '—',
    underwriterName: staffName(d, deal.underwriterId),
    premium: c?.params.total ?? q?.total ?? kp?.totalPremium ?? null,
    quoteId: q?.id,
    quoteStatus: q?.status,
    kpId: kp?.id,
    kpStatus: kp?.status,
    contractId: c?.id,
    contractStatus: c?.status,
  };
}

export function signatoryOption(s: Pick<StaffUser, 'id' | 'fullName' | 'role' | 'signatory'>): SignatoryOption | null {
  return s.signatory?.canSign ? { id: s.id, fullName: s.fullName, role: s.role, basis: s.signatory.basis } : null;
}

export function signatories(d: Db): SignatoryOption[] {
  return d.staff.filter((s) => s.active).flatMap((s) => signatoryOption(s) ?? []);
}

export function positionOf(role: StaffUser['role']): string {
  return ROLE_LABEL[role].toLowerCase();
}

// ---------------------------------------------------------------- invoices and payments

export function nextInvoiceNumber(d: Db): string {
  const year = new Date().getFullYear();
  return `СЧ-${year}-${String(d.invoices.length + 2001).padStart(6, '0')}`;
}

/** Status of an invoice by its payments and due date. */
export function refreshInvoice(inv: Invoice): Invoice {
  const paid = inv.paid ?? 0;
  inv.status = paid >= inv.amount ? 'paid' : inv.dueDate < todayIso() ? 'overdue' : 'unpaid';
  return inv;
}

export function createContractInvoices(d: Db, c: Contract): void {
  if (d.invoices.some((i) => i.contractId === c.id && !i.endorsementId)) return;
  const issued = todayIso();
  c.params.paymentSchedule.forEach((p, k) => {
    d.invoices.unshift(
      refreshInvoice({
        id: randomId(),
        clientId: c.clientId,
        number: `${nextInvoiceNumber(d)}-${k + 1}`,
        amount: p.amount,
        issuedAt: issued,
        dueDate: p.dueDate,
        status: 'unpaid',
        contractId: c.id,
        paid: 0,
      }),
    );
  });
}

// ---------------------------------------------------------------- signing

/** After any signature: a fully signed document is finalised once. */
export async function afterSigning(d: Db, kind: 'contract' | 'endorsement', id: UUID, actorName: string): Promise<void> {
  if (kind === 'contract') {
    const c = contractOf(d, id);
    if (!isFullySigned(c.signing)) {
      if (c.status === 'sent' || c.status === 'approved') c.status = 'signing';
      moveDeal(d, c.dealId, 'signing', actorName);
      return;
    }
    if (c.status === 'signed' || c.status === 'active') return;
    c.status = 'signed';
    createContractInvoices(d, c);
    moveDeal(d, c.dealId, 'awaiting_payment', actorName, `Договор ${c.number} подписан обеими сторонами, выставлены счета`);
    await refreshContract(d, c);
    return;
  }
  const e = d.endorsements.find((x) => x.id === id);
  if (!e) throw notFound();
  if (!isFullySigned(e.signing)) {
    if (e.status === 'sent' || e.status === 'approved') e.status = 'signing';
    return;
  }
  if (e.status === 'signed') return;
  e.status = 'signed';
  await applyEndorsement(d, e, isoDay(parseIso(fullySignedAt(e.signing) ?? tzIso(Date.now()))));
}

/** Imitation of the EDO operator: the client «signs» 3 seconds after the document was sent. */
export function edoArrived(s: Signing, now = Date.now()): boolean {
  return !!s.edoPending && !s.client && now - parseIso(s.edoPending.sentAt) >= 3000;
}

export function edoClientSignature(s: Signing, signerName: string) {
  return {
    method: 'edo' as const,
    signedAt: tzIso(parseIso(s.edoPending!.sentAt) + 3000),
    signerName,
    edoProvider: s.edoPending!.provider,
    certificate: { serial: '7A3F0C21', owner: signerName, validTo: addDays(todayIso(), 365) },
  };
}

/**
 * Lazy server clock: EDO events, coming into force by the activation rule, expiry. Called on every read
 * of the contract and after payments, so the state is current without background jobs.
 */
export async function refreshContract(d: Db, c: Contract, now = Date.now()): Promise<void> {
  if (edoArrived(c.signing, now)) {
    c.signing = addSignature(c.signing, 'client', edoClientSignature(c.signing, c.params.clientSignatory.name));
    dealEvent(d, c.dealId, 'ЭДО', `Договор ${c.number} подписан клиентом в ЭДО (${c.signing.client?.edoProvider})`);
    await afterSigning(d, 'contract', c.id, 'ЭДО');
    return;
  }
  for (const e of d.endorsements.filter((x) => x.contractId === c.id && edoArrived(x.signing, now))) {
    e.signing = addSignature(e.signing, 'client', edoClientSignature(e.signing, c.params.clientSignatory.name));
    await afterSigning(d, 'endorsement', e.id, 'ЭДО');
  }
  const today = isoDay(now);
  if (c.status === 'signed') {
    const payments = d.payments.filter((p) => p.contractId === c.id);
    const on = activationDate(c.params.activationRule, c.params.startDate, c.params.paymentSchedule, payments);
    if (on && on <= today) await activateContract(d, c, on);
  }
  if (c.status === 'active' && c.params.endDate < today) {
    c.status = 'expired';
    const p = d.policies.find((x) => x.id === c.policyId);
    if (p && p.status === 'active') p.status = 'expired';
  }
}

/** Coming into force (LIFECYCLE_SPEC §9–10): policy, insured persons with certificates, SMS, assistance events. */
export async function activateContract(d: Db, c: Contract, on: string): Promise<Policy> {
  const client = clientRow(d, c.clientId);
  const year = Number(c.params.startDate.slice(0, 4));
  const policy: Policy = {
    id: randomId(),
    number: nextPolicyNumber(d, year),
    clientId: client.id,
    clientName: client.name,
    program: c.params.program,
    startDate: c.params.startDate,
    endDate: c.params.endDate,
    status: 'active',
    premium: c.params.total,
    insuredCount: 0,
    tariff: { employee: c.params.premiumEmployee, family: c.params.premiumFamily },
    familyCount: 0,
    assistanceId: c.params.assistanceId ?? null,
    contractId: c.id,
  };
  d.policies.unshift(policy);
  d.assignments.push({ policyId: policy.id, assistanceId: c.params.assistanceId ?? null, from: c.params.startDate, setById: c.params.migSignatoryId, setAt: tzIso(Date.now()) });
  syncAssistance(d);
  const list = d.contractInsured.find((x) => x.contractId === c.id)?.rows ?? [];
  list.forEach((r, k) => {
    const person = createInsured(d, client, policy, r, c.params.startDate, 'invited');
    person.certificateNumber = certificateNumber(c.number, k + 1);
    person.contractId = c.id;
    d.smsOutbox.unshift({ at: tzIso(Date.now()), insuredId: person.id, text: `Вы застрахованы по ДМС. Сертификат ${person.certificateNumber}. Скачайте приложение MIG ДМС.` });
  });
  for (const person of d.insured.filter((i) => i.policyId === policy.id)) await notifyAssistance(d, c.params.assistanceId, 'insured.added', person.id);
  await notifyAssistance(d, c.params.assistanceId, 'policy.assigned', policy.id);
  refreshPolicyTotals(d, policy);
  // The previous policy of a renewal ends on its own date; the client's current policy switches now.
  client.activePolicyId = policy.id;
  client.status = 'active';
  client.program = c.params.program;
  client.premium = c.params.total;
  client.renewalDate = c.params.endDate;
  client.assistanceId = c.params.assistanceId ?? null;
  c.status = 'active';
  c.policyId = policy.id;
  c.activatedAt = tzIso(Date.now());
  const docs: ClientDocument[] = [
    { id: randomId(), clientId: client.id, title: `Договор ДМС ${c.number}`, kind: 'contract', createdAt: on },
    { id: randomId(), clientId: client.id, title: `Полис ${policy.number}`, kind: 'policy', createdAt: on },
  ];
  d.documents.unshift(...docs);
  moveDeal(d, c.dealId, 'active', 'Система', `Договор вступил в силу ${on.split('-').reverse().join('.')}: полис ${policy.number}, сертификатов ${list.length}`);
  return policy;
}

// ---------------------------------------------------------------- endorsements

/** Annual premium of an insured person under the contract: employee plus family members. */
export function annualOf(c: Contract, i: Pick<InsuredRow, 'familyMembersCount'>): number {
  return c.params.premiumEmployee + c.params.premiumFamily * i.familyMembersCount;
}

export function claimsPaidFor(d: Db, insuredIds: readonly UUID[], from: string): number {
  return d.claims
    .filter((x) => insuredIds.includes(x.insuredId) && (x.status === 'paid' || x.status === 'to_pay' || x.status === 'approved') && x.serviceDate >= from)
    .reduce((s, x) => s + (x.amountApproved ?? x.amountClaimed), 0);
}

export const refundRule = () => REFUND_RULES[dmsParam('refundRule')] ?? 'pro_rata_minus_claims';

export function endorsementLines(d: Db, c: Contract, requests: readonly ChangeRequestRow[]): Endorsement['lines'] {
  return requests.map((r) => {
    const label = r.description ?? CHANGE_TYPE_LABEL[r.type];
    if (r.type === 'add_insured') {
      const family = Number(r.payload.familyMembers ?? r.newPerson?.familyMembers ?? 0);
      const calc = addLine(c.params.premiumEmployee + c.params.premiumFamily * family, r.effectiveDate, c.params.startDate, c.params.endDate);
      return { changeRequestId: r.id, description: label, ...calc };
    }
    if (r.type === 'exclude_insured') {
      const person = d.insured.find((i) => i.id === r.insuredId);
      const annual = person ? annualOf(c, person) : c.params.premiumEmployee;
      const calc = excludeLine(annual, r.effectiveDate, c.params.startDate, c.params.endDate, refundRule(), claimsPaidFor(d, r.insuredId ? [r.insuredId] : [], c.params.startDate));
      return { changeRequestId: r.id, description: label, ...calc };
    }
    if (r.type === 'change_program') {
      const from = String(r.payload.fromProgram ?? c.params.program) as keyof typeof TARIFF_BASE_KEY;
      const to = String(r.payload.program ?? c.params.program) as keyof typeof TARIFF_BASE_KEY;
      const newTotal = Math.round((c.params.total * dmsParam(TARIFF_BASE_KEY[to])) / dmsParam(TARIFF_BASE_KEY[from]));
      const calc = programChangeLine(c.params.total, newTotal, r.effectiveDate, c.params.startDate, c.params.endDate);
      return { changeRequestId: r.id, description: label, ...calc };
    }
    const amount = Number(r.payload.amount ?? 0);
    return { changeRequestId: r.id, description: label, days: 0, amount, formula: 'Сумма по согласованию (утверждает андеррайтер)' };
  });
}

export function endorsementSummary(e: Endorsement): EndorsementSummary {
  return { id: e.id, number: e.number, kind: e.kind ?? 'changes', status: e.status, total: e.total, createdAt: e.createdAt };
}

export function nextEndorsementNumber(d: Db, c: Contract): string {
  return endorsementNumber(d.endorsements.filter((e) => e.contractId === c.id).length + 1, c.number);
}

export function createEndorsement(d: Db, c: Contract, requests: ChangeRequestRow[], kind: 'changes' | 'termination', terminationDate?: string): Endorsement {
  if (c.status !== 'active') throw conflict('srv.endorsement.activeContractOnly');
  const lines =
    kind === 'termination'
      ? [
          (() => {
            const ids = d.insured.filter((i) => i.contractId === c.id || d.policies.some((p) => p.id === i.policyId && p.contractId === c.id)).map((i) => i.id);
            const calc = excludeLine(c.params.total, terminationDate!, c.params.startDate, c.params.endDate, refundRule(), claimsPaidFor(d, ids, c.params.startDate));
            return { changeRequestId: '', description: `Досрочное расторжение с ${terminationDate!.split('-').reverse().join('.')}`, ...calc };
          })(),
        ]
      : endorsementLines(d, c, requests);
  const e: Endorsement = {
    id: randomId(),
    number: nextEndorsementNumber(d, c),
    contractId: c.id,
    kind,
    terminationDate,
    changeRequestIds: requests.map((r) => r.id),
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
    clauseOverrides: [],
    status: 'draft',
    signing: { paperOriginal: { required: false } },
    createdAt: tzIso(Date.now()),
  };
  for (const r of requests) r.endorsementId = e.id;
  d.endorsements.unshift(e);
  return e;
}

/** A signed endorsement takes effect: invoice or refund, requests included, termination closes the policy. */
export async function applyEndorsement(d: Db, e: Endorsement, signedOn: string): Promise<void> {
  const c = contractOf(d, e.contractId);
  const policy = d.policies.find((p) => p.id === c.policyId);
  const client = clientRow(d, c.clientId);
  if (e.total > 0) {
    const inv = refreshInvoice({
      id: randomId(),
      clientId: c.clientId,
      number: nextInvoiceNumber(d),
      amount: e.total,
      issuedAt: signedOn,
      dueDate: addDays(signedOn, 10),
      status: 'unpaid',
      contractId: c.id,
      endorsementId: e.id,
      paid: 0,
    });
    d.invoices.unshift(inv);
    e.invoiceId = inv.id;
  } else if (e.total < 0) {
    e.refundDocument = `ВЗ-${e.number.replace(/\s.*$/, '')}-${c.number.slice(-6)}`;
  }
  d.documents.unshift({ id: randomId(), clientId: c.clientId, title: `Дополнительное соглашение ${e.number}`, kind: 'endorsement', createdAt: signedOn });
  for (const r of d.changeRequests.filter((x) => e.changeRequestIds.includes(x.id))) {
    r.status = 'included';
    if (r.type === 'add_insured' && r.newPerson && policy) {
      // Coverage from the signing of the endorsement (parameter coverageStartRule).
      const person = createInsured(d, client, policy, r.newPerson, signedOn, 'invited');
      person.contractId = c.id;
      person.certificateNumber = certificateNumber(c.number, d.insured.filter((i) => i.contractId === c.id).length);
      r.insuredId = person.id;
      await notifyAssistance(d, policy.assistanceId ?? null, 'insured.added', person.id);
    }
    if (r.type === 'change_program' && policy && typeof r.payload.program === 'string') policy.program = r.payload.program as Policy['program'];
  }
  if (policy) {
    policy.premium = Math.max(0, policy.premium + (e.kind === 'termination' ? 0 : e.total));
    refreshPolicyTotals(d, policy);
  }
  if (e.kind === 'termination' && policy && e.terminationDate) {
    const at = tzIso(Date.now());
    for (const i of d.insured.filter((x) => x.policyId === policy.id && x.status === 'active')) {
      i.status = 'excluded';
      i.excludedFrom = e.terminationDate;
      i.updatedAt = at;
      await notifyAssistance(d, policy.assistanceId ?? null, 'insured.excluded', i.id);
    }
    await notifyAssistance(d, policy.assistanceId ?? null, 'policy.unassigned', policy.id);
    policy.status = 'cancelled';
    policy.endDate = e.terminationDate;
    c.status = 'terminated';
    c.terminatedAt = e.terminationDate;
    if (client.activePolicyId === policy.id) client.status = 'expired';
    refreshPolicyTotals(d, policy);
  }
}

/** Change requests of a contract not yet in an endorsement. */
export const pendingRequests = (d: Db, contractId: UUID): ChangeRequestRow[] => d.changeRequests.filter((r) => r.contractId === contractId && r.status === 'pending' && !r.endorsementId);

export function toChangeRequest(r: ChangeRequestRow): ChangeRequest {
  const { newPerson: _n, policyChangeId: _p, ...out } = r;
  return out;
}
