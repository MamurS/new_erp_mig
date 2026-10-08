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
} from '@mig/contracts';
import type { ContractSummary, DealView, EndorsementSummary, SignatoryOption } from '@mig/contracts/dto';
import type { ChecklistInput } from '../nextStep';
import { activationDate, addDays, addSignature, certificateNumber, endorsementNumber, fullySignedAt, isFullySigned } from '../contracts';
import { addLine, CHANGE_TYPE_LABEL, excludeLine, programChangeLine, REFUND_RULES } from '../endorsements';
import { TARIFF_BASE_KEY } from '../config/dmsParameters';
import { ROLE_LABEL } from '../labels';
import { asPricingRule, contractPricing, personPremium, PricingError, type PricingRule } from '../pricing';
import { randomId } from '../lib/random';
import { isoDay, parseIso, tzIso } from '../lib/time';
import type { ChangeRequestRow, ClientRow, InsuredRow } from '../store/db';
import { conflict, errorOf, notFound, todayIso, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { createInsured, createListedInsured, nextPolicyNumber, refreshPolicyTotals } from './policy';
import { notifyAssistance, syncAssistance } from './assistance';


export async function staffName(ctx: BaseCtx, id: UUID | undefined): Promise<string | undefined> {
  return id ? (await ctx.repos.staff.get(id))?.fullName : undefined;
}

export async function dealOf(ctx: BaseCtx, id: UUID): Promise<Deal> {
  const deal = await ctx.repos.deals.get(id);
  if (!deal) throw notFound();
  return deal;
}

export async function contractOf(ctx: BaseCtx, id: UUID): Promise<Contract> {
  const c = await ctx.repos.contracts.get(id);
  if (!c) throw notFound();
  return c;
}

export async function clientRow(ctx: BaseCtx, id: UUID): Promise<ClientRow> {
  const c = await ctx.repos.clients.get(id);
  if (!c) throw notFound();
  return c;
}

export async function dealEvent(ctx: BaseCtx, dealId: UUID, actorName: string, text: string): Promise<void> {
  await ctx.repos.dealEvents.insert({ id: randomId(), dealId, at: tzIso(ctx.now()), actorName, text }, { at: 'start' });
}

const STAGE_ORDER: DealStage[] = ['lead', 'census', 'quote', 'kp_sent', 'kp_accepted', 'contract_draft', 'contract_review', 'contract_sent', 'signing', 'awaiting_payment', 'active'];

/** Moves a deal forward (never back, never out of `lost`), with an event in its feed. */
export async function moveDeal(ctx: BaseCtx, dealId: UUID | undefined, stage: DealStage, actorName: string, text?: string): Promise<void> {
  const deal = dealId ? await ctx.repos.deals.get(dealId) : null;
  if (!deal || deal.stage === 'lost') return;
  if (STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(deal.stage) && stage !== deal.stage) return;
  if (stage !== deal.stage) await ctx.repos.deals.update(deal.id, { stage, updatedAt: tzIso(ctx.now()) });
  if (text) await dealEvent(ctx, deal.id, actorName, text);
}

export async function latestQuote(ctx: BaseCtx, dealId: UUID): Promise<Quote | undefined> {
  return (await ctx.repos.quotes.list({ where: { dealId } })).at(-1);
}

export async function dealKp(ctx: BaseCtx, dealId: UUID): Promise<KpDocument | undefined> {
  return (await ctx.repos.kp.list({ where: { dealId, status: { ne: 'revoked' } } })).at(-1);
}

/** The deal's current contract: the latest version (the last stored one among equal versions). */
export async function dealContract(ctx: BaseCtx, dealId: UUID): Promise<Contract | undefined> {
  return (await ctx.repos.contracts.list({ where: { dealId } })).sort((a, b) => a.version - b.version).at(-1);
}

export function toContractSummary(c: Contract): ContractSummary {
  return { id: c.id, number: c.number, version: c.version, status: c.status, total: c.params.total, startDate: c.params.startDate, endDate: c.params.endDate };
}

export async function toDealView(ctx: BaseCtx, deal: Deal): Promise<DealView> {
  const q = await latestQuote(ctx, deal.id);
  const kp = await dealKp(ctx, deal.id);
  const c = await dealContract(ctx, deal.id);
  const client = await ctx.repos.clients.get(deal.clientId);
  return {
    ...deal,
    clientName: client?.name ?? '—',
    clientLegalForm: client?.legalForm,
    ownerName: (await staffName(ctx, deal.ownerId)) ?? '—',
    underwriterName: await staffName(ctx, deal.underwriterId),
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

export async function signatories(ctx: BaseCtx): Promise<SignatoryOption[]> {
  return (await ctx.repos.staff.list({ where: { active: true } })).flatMap((s) => signatoryOption(s) ?? []);
}

export function positionOf(role: StaffUser['role']): string {
  return ROLE_LABEL[role].toLowerCase();
}

// ---------------------------------------------------------------- invoices and payments

export async function nextInvoiceNumber(ctx: BaseCtx, P?: ParamsView): Promise<string> {
  const params = P ?? (await loadParams(ctx));
  const year = new Date(ctx.now()).getFullYear();
  return params.nextDocNumber('invoice', { year, n: (await ctx.repos.invoices.count()) + 2001 });
}

/** Status of an invoice by its payments and due date; changes `inv` in place (the caller saves it). */
export function refreshInvoice(inv: Invoice, today = isoDay(Date.now())): Invoice {
  const paid = inv.paid ?? 0;
  inv.status = paid >= inv.amount ? 'paid' : inv.dueDate < today ? 'overdue' : 'unpaid';
  return inv;
}

export async function createContractInvoices(ctx: BaseCtx, c: Contract): Promise<void> {
  if (await ctx.repos.invoices.exists({ contractId: c.id, endorsementId: { isNull: true } })) return;
  const P = await loadParams(ctx);
  const issued = todayIso(ctx);
  for (const [k, p] of c.params.paymentSchedule.entries()) {
    await ctx.repos.invoices.insert(
      refreshInvoice(
        {
          id: randomId(),
          clientId: c.clientId,
          number: `${await nextInvoiceNumber(ctx, P)}-${k + 1}`,
          amount: p.amount,
          issuedAt: issued,
          dueDate: p.dueDate,
          status: 'unpaid',
          contractId: c.id,
          paid: 0,
        },
        issued,
      ),
      { at: 'start' },
    );
  }
}

// ---------------------------------------------------------------- signing

/** After any signature: a fully signed document is finalised once. */
export async function afterSigning(ctx: BaseCtx, kind: 'contract' | 'endorsement', id: UUID, actorName: string): Promise<void> {
  if (kind === 'contract') {
    const c = await contractOf(ctx, id);
    if (!isFullySigned(c.signing)) {
      if (c.status === 'sent' || c.status === 'approved') {
        c.status = 'signing';
        await ctx.repos.contracts.update(c.id, { status: c.status });
      }
      await moveDeal(ctx, c.dealId, 'signing', actorName);
      return;
    }
    if (c.status === 'signed' || c.status === 'active') return;
    c.status = 'signed';
    await ctx.repos.contracts.update(c.id, { status: c.status });
    await createContractInvoices(ctx, c);
    await moveDeal(ctx, c.dealId, 'awaiting_payment', actorName, `Договор ${c.number} подписан обеими сторонами, выставлены счета`);
    await refreshContract(ctx, c);
    return;
  }
  const e = await ctx.repos.endorsements.get(id);
  if (!e) throw notFound();
  if (!isFullySigned(e.signing)) {
    if (e.status === 'sent' || e.status === 'approved') await ctx.repos.endorsements.update(e.id, { status: 'signing' });
    return;
  }
  if (e.status === 'signed') return;
  e.status = 'signed';
  await ctx.repos.endorsements.update(e.id, { status: e.status });
  await applyEndorsement(ctx, e, isoDay(parseIso(fullySignedAt(e.signing) ?? tzIso(ctx.now()))));
}

/** Imitation of the EDO operator: the client «signs» 3 seconds after the document was sent. */
export function edoArrived(s: Signing, now = Date.now()): boolean {
  return !!s.edoPending && !s.client && now - parseIso(s.edoPending.sentAt) >= 3000;
}

export function edoClientSignature(s: Signing, signerName: string, today = isoDay(Date.now())) {
  return {
    method: 'edo' as const,
    signedAt: tzIso(parseIso(s.edoPending!.sentAt) + 3000),
    signerName,
    edoProvider: s.edoPending!.provider,
    certificate: { serial: '7A3F0C21', owner: signerName, validTo: addDays(today, 365) },
  };
}

/** Copies the stored state of the contract into `c` (it changed in nested steps that read it anew). */
async function reload(ctx: BaseCtx, c: Contract): Promise<void> {
  Object.assign(c, await contractOf(ctx, c.id));
}

/**
 * Lazy server clock: EDO events, coming into force by the activation rule, expiry. Called on every read
 * of the contract and after payments, so the state is current without background jobs. `c` is saved and
 * holds the current state afterwards.
 */
export async function refreshContract(ctx: BaseCtx, c: Contract, now = ctx.now()): Promise<void> {
  const r = ctx.repos;
  if (edoArrived(c.signing, now)) {
    c.signing = addSignature(c.signing, 'client', edoClientSignature(c.signing, c.params.clientSignatory.name, todayIso(ctx)));
    await r.contracts.update(c.id, { signing: c.signing });
    await dealEvent(ctx, c.dealId, 'ЭДО', `Договор ${c.number} подписан клиентом в ЭДО (${c.signing.client?.edoProvider})`);
    await afterSigning(ctx, 'contract', c.id, 'ЭДО');
    await reload(ctx, c);
    return;
  }
  const arrived = (await r.endorsements.list({ where: { contractId: c.id } })).filter((x) => edoArrived(x.signing, now));
  for (const e of arrived) {
    e.signing = addSignature(e.signing, 'client', edoClientSignature(e.signing, c.params.clientSignatory.name, todayIso(ctx)));
    await r.endorsements.update(e.id, { signing: e.signing });
    await afterSigning(ctx, 'endorsement', e.id, 'ЭДО');
  }
  if (arrived.length) await reload(ctx, c);
  const today = isoDay(now);
  if (c.status === 'signed') {
    const payments = await r.payments.list({ where: { contractId: c.id } });
    const on = activationDate(c.params.activationRule, c.params.startDate, c.params.paymentSchedule, payments);
    if (on && on <= today) await activateContract(ctx, c, on);
  }
  if (c.status === 'active' && c.params.endDate < today) {
    c.status = 'expired';
    await r.contracts.update(c.id, { status: c.status });
    const p = c.policyId ? await r.policies.get(c.policyId) : null;
    if (p && p.status === 'active') await r.policies.update(p.id, { status: 'expired' });
  }
}

/** Coming into force (LIFECYCLE_SPEC §9–10): policy, insured persons with certificates, SMS, assistance events. */
export async function activateContract(ctx: BaseCtx, c: Contract, on: string): Promise<Policy> {
  const r = ctx.repos;
  const P = await loadParams(ctx);
  const client = await clientRow(ctx, c.clientId);
  const year = Number(c.params.startDate.slice(0, 4));
  const policy: Policy = {
    id: randomId(),
    number: await nextPolicyNumber(ctx, year, P),
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
  await r.policies.insert(policy, { at: 'start' });
  await r.assignments.insert({ policyId: policy.id, assistanceId: c.params.assistanceId ?? null, from: c.params.startDate, setById: c.params.migSignatoryId, setAt: tzIso(ctx.now()) });
  await syncAssistance(ctx);
  Object.assign(policy, await r.policies.get(policy.id));
  const list = (await r.contractInsured.get(c.id))?.rows ?? [];
  // A certificate for every person of appendix 2, family members included (FAMILY_SPEC).
  const people = await createListedInsured(ctx, client, policy, list, c.params.startDate, 'invited');
  for (const [k, person] of people.entries()) {
    person.certificateNumber = certificateNumber(c.number, k + 1, P.numbering());
    person.contractId = c.id;
    await r.insured.update(person.id, { certificateNumber: person.certificateNumber, contractId: person.contractId });
    if (person.phone) await r.smsOutbox.insert({ at: tzIso(ctx.now()), insuredId: person.id, text: `Вы застрахованы по ДМС. Сертификат ${person.certificateNumber}. Скачайте приложение MIG ДМС.` }, { at: 'start' });
  }
  for (const person of await r.insured.list({ where: { policyId: policy.id } })) await notifyAssistance(ctx, c.params.assistanceId, 'insured.added', person.id);
  await notifyAssistance(ctx, c.params.assistanceId, 'policy.assigned', policy.id);
  await refreshPolicyTotals(ctx, policy);
  // The previous policy of a renewal ends on its own date; the client's current policy switches now.
  await r.clients.update(client.id, {
    activePolicyId: policy.id,
    status: 'active',
    program: c.params.program,
    premium: c.params.total,
    renewalDate: c.params.endDate,
    assistanceId: c.params.assistanceId ?? null,
  });
  c.status = 'active';
  c.policyId = policy.id;
  c.activatedAt = tzIso(ctx.now());
  await r.contracts.update(c.id, { status: c.status, policyId: c.policyId, activatedAt: c.activatedAt });
  const docs: ClientDocument[] = [
    { id: randomId(), clientId: client.id, title: `Договор ДМС ${c.number}`, kind: 'contract', createdAt: on },
    { id: randomId(), clientId: client.id, title: `Полис ${policy.number}`, kind: 'policy', createdAt: on },
  ];
  await r.documents.insertMany(docs, { at: 'start' });
  await moveDeal(ctx, c.dealId, 'active', 'Система', `Договор вступил в силу ${on.split('-').reverse().join('.')}: полис ${policy.number}, сертификатов ${list.length}`);
  return policy;
}

// ---------------------------------------------------------------- endorsements

/**
 * Annual premium of an insured person under the contract and the rule that gave it: a transferred person's
 * own premium (from the files of the previous system, no rule), else by the contract's `pricingBasis` — by type
 * (premium_employee / premium_family) or by the age band on `on`. An `age_banded` contract without a usable
 * band table is a 422.
 */
export function premiumOf(c: Contract, i: Pick<InsuredRow, 'relation' | 'birthDate' | 'migratedPremium'>, on: string = c.params.startDate): { annual: number; rule?: PricingRule } {
  if (i.migratedPremium) return { annual: i.migratedPremium.amount };
  try {
    return personPremium(contractPricing(c.params), i, on);
  } catch (e) {
    if (e instanceof PricingError) throw errorOf(422, 'validation', e.problem);
    throw e;
  }
}

export function annualOf(c: Contract, i: Pick<InsuredRow, 'relation' | 'birthDate' | 'migratedPremium'>, on: string = c.params.startDate): number {
  return premiumOf(c, i, on).annual;
}

/** The date a person's premium was set on: the inclusion during the term, else the start of the contract. */
function pricedOn(c: Contract, i: Pick<InsuredRow, 'addedAt'>): string {
  const added = i.addedAt.slice(0, 10);
  return added > c.params.startDate ? added : c.params.startDate;
}

export async function claimsPaidFor(ctx: BaseCtx, insuredIds: readonly UUID[], from: string): Promise<number> {
  if (!insuredIds.length) return 0;
  return (await ctx.repos.claims.list({ where: { insuredId: { in: insuredIds }, status: { in: ['paid', 'to_pay', 'approved'] }, serviceDate: { gte: from } } })).reduce(
    (s, x) => s + (x.amountApproved ?? x.amountClaimed),
    0,
  );
}

export const refundRule = (P: ParamsView) => REFUND_RULES[P.dmsParam('refundRule')] ?? 'pro_rata_minus_claims';

export async function endorsementLines(ctx: BaseCtx, c: Contract, requests: readonly ChangeRequestRow[], P?: ParamsView): Promise<Endorsement['lines']> {
  const params = P ?? (await loadParams(ctx));
  const out: Endorsement['lines'] = [];
  for (const r of requests) {
    const label = r.description ?? CHANGE_TYPE_LABEL[r.type];
    if (r.type === 'add_insured') {
      // The person's annual premium and its rule fixed with the request (by the contract terms), else computed now.
      const person = r.insuredId ? ((await ctx.repos.insured.get(r.insuredId)) ?? undefined) : undefined;
      const fallback = person ?? (r.newPerson ? { relation: r.newPerson.relation, birthDate: r.newPerson.birthDate } : { relation: 'employee' as const, birthDate: '' });
      const fixed = typeof r.payload.annual === 'number' ? { annual: r.payload.annual, rule: asPricingRule(r.payload.rule) } : premiumOf(c, fallback, r.effectiveDate);
      const calc = addLine(fixed.annual, r.effectiveDate, c.params.startDate, c.params.endDate, fixed.rule);
      out.push({ changeRequestId: r.id, description: label, ...calc });
      continue;
    }
    if (r.type === 'exclude_insured') {
      const person = r.insuredId ? await ctx.repos.insured.get(r.insuredId) : null;
      // The premium the person was priced at: the band of the inclusion date (or the contract start), not of the exclusion.
      const annual = person ? annualOf(c, person, pricedOn(c, person)) : c.params.premiumEmployee;
      const calc = excludeLine(annual, r.effectiveDate, c.params.startDate, c.params.endDate, refundRule(params), await claimsPaidFor(ctx, r.insuredId ? [r.insuredId] : [], c.params.startDate));
      out.push({ changeRequestId: r.id, description: label, ...calc });
      continue;
    }
    if (r.type === 'change_program') {
      const from = String(r.payload.fromProgram ?? c.params.program) as keyof typeof TARIFF_BASE_KEY;
      const to = String(r.payload.program ?? c.params.program) as keyof typeof TARIFF_BASE_KEY;
      const newTotal = Math.round((c.params.total * params.dmsParam(TARIFF_BASE_KEY[to])) / params.dmsParam(TARIFF_BASE_KEY[from]));
      const calc = programChangeLine(c.params.total, newTotal, r.effectiveDate, c.params.startDate, c.params.endDate);
      out.push({ changeRequestId: r.id, description: label, ...calc });
      continue;
    }
    const amount = Number(r.payload.amount ?? 0);
    out.push({ changeRequestId: r.id, description: label, days: 0, amount, formula: 'Сумма по согласованию (утверждает андеррайтер)' });
  }
  return out;
}

export function endorsementSummary(e: Endorsement): EndorsementSummary {
  return { id: e.id, number: e.number, kind: e.kind ?? 'changes', status: e.status, total: e.total, createdAt: e.createdAt };
}

export async function nextEndorsementNumber(ctx: BaseCtx, c: Contract, P?: ParamsView): Promise<string> {
  const params = P ?? (await loadParams(ctx));
  return endorsementNumber((await ctx.repos.endorsements.count({ contractId: c.id })) + 1, c.number, params.numbering());
}

/** A draft endorsement of the contract; its requests point to it (saved). */
export async function createEndorsement(ctx: BaseCtx, c: Contract, requests: ChangeRequestRow[], kind: 'changes' | 'termination', terminationDate?: string): Promise<Endorsement> {
  if (c.status !== 'active') throw conflict('srv.endorsement.activeContractOnly');
  const P = await loadParams(ctx);
  let lines: Endorsement['lines'];
  if (kind === 'termination') {
    const policies = new Set((await ctx.repos.policies.list({ where: { contractId: c.id } })).map((p) => p.id));
    const ids = (await ctx.repos.insured.list()).filter((i) => i.contractId === c.id || policies.has(i.policyId)).map((i) => i.id);
    const calc = excludeLine(c.params.total, terminationDate!, c.params.startDate, c.params.endDate, refundRule(P), await claimsPaidFor(ctx, ids, c.params.startDate));
    lines = [{ changeRequestId: '', description: `Досрочное расторжение с ${terminationDate!.split('-').reverse().join('.')}`, ...calc }];
  } else {
    lines = await endorsementLines(ctx, c, requests, P);
  }
  const e: Endorsement = {
    id: randomId(),
    number: await nextEndorsementNumber(ctx, c, P),
    contractId: c.id,
    kind,
    terminationDate,
    changeRequestIds: requests.map((r) => r.id),
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
    clauseOverrides: [],
    status: 'draft',
    signing: { paperOriginal: { required: false } },
    createdAt: tzIso(ctx.now()),
  };
  for (const r of requests) {
    r.endorsementId = e.id;
    await ctx.repos.changeRequests.update(r.id, { endorsementId: e.id });
  }
  await ctx.repos.endorsements.insert(e, { at: 'start' });
  return e;
}

/** A signed endorsement takes effect: invoice or refund, requests included, termination closes the policy. */
export async function applyEndorsement(ctx: BaseCtx, e: Endorsement, signedOn: string): Promise<void> {
  const r = ctx.repos;
  const P = await loadParams(ctx);
  const c = await contractOf(ctx, e.contractId);
  const policy = c.policyId ? await r.policies.get(c.policyId) : null;
  const client = await clientRow(ctx, c.clientId);
  if (e.total > 0) {
    const inv = refreshInvoice(
      {
        id: randomId(),
        clientId: c.clientId,
        number: await nextInvoiceNumber(ctx, P),
        amount: e.total,
        issuedAt: signedOn,
        dueDate: addDays(signedOn, 10),
        status: 'unpaid',
        contractId: c.id,
        endorsementId: e.id,
        paid: 0,
      },
      todayIso(ctx),
    );
    await r.invoices.insert(inv, { at: 'start' });
    e.invoiceId = inv.id;
    await r.endorsements.update(e.id, { invoiceId: e.invoiceId });
  } else if (e.total < 0) {
    e.refundDocument = P.nextDocNumber('refund', { ref: e.number, n: (await r.endorsements.list()).filter((x) => x.refundDocument).length + 1 });
    await r.endorsements.update(e.id, { refundDocument: e.refundDocument });
  }
  await r.documents.insert({ id: randomId(), clientId: c.clientId, title: `Дополнительное соглашение ${e.number}`, kind: 'endorsement', createdAt: signedOn }, { at: 'start' });
  for (const req of await r.changeRequests.list({ where: { id: { in: e.changeRequestIds } } })) {
    req.status = 'included';
    if (req.type === 'add_insured' && req.newPerson && policy) {
      // Coverage from the signing of the endorsement (parameter coverageStartRule).
      const person = await createInsured(ctx, client, policy, req.newPerson, signedOn, 'invited');
      person.contractId = c.id;
      await r.insured.update(person.id, { contractId: c.id });
      person.certificateNumber = certificateNumber(c.number, await r.insured.count({ contractId: c.id }), P.numbering());
      await r.insured.update(person.id, { certificateNumber: person.certificateNumber });
      req.insuredId = person.id;
      await r.changeRequests.update(req.id, { status: req.status, insuredId: req.insuredId });
      await notifyAssistance(ctx, policy.assistanceId ?? null, 'insured.added', person.id);
    } else {
      await r.changeRequests.update(req.id, { status: req.status });
    }
    if (req.type === 'change_program' && policy && typeof req.payload.program === 'string') {
      policy.program = req.payload.program as Policy['program'];
      await r.policies.update(policy.id, { program: policy.program });
    }
  }
  if (policy) {
    policy.premium = Math.max(0, policy.premium + (e.kind === 'termination' ? 0 : e.total));
    await r.policies.update(policy.id, { premium: policy.premium });
    await refreshPolicyTotals(ctx, policy);
  }
  if (e.kind === 'termination' && policy && e.terminationDate) {
    const at = tzIso(ctx.now());
    for (const i of await r.insured.list({ where: { policyId: policy.id, status: 'active' } })) {
      await r.insured.update(i.id, { status: 'excluded', excludedFrom: e.terminationDate, updatedAt: at });
      await notifyAssistance(ctx, policy.assistanceId ?? null, 'insured.excluded', i.id);
    }
    await notifyAssistance(ctx, policy.assistanceId ?? null, 'policy.unassigned', policy.id);
    policy.status = 'cancelled';
    policy.endDate = e.terminationDate;
    await r.policies.update(policy.id, { status: policy.status, endDate: policy.endDate });
    await r.contracts.update(c.id, { status: 'terminated', terminatedAt: e.terminationDate });
    if (client.activePolicyId === policy.id) await r.clients.update(client.id, { status: 'expired' });
    await refreshPolicyTotals(ctx, policy);
  }
}

/** Change requests of a contract not yet in an endorsement. */
export async function pendingRequests(ctx: BaseCtx, contractId: UUID): Promise<ChangeRequestRow[]> {
  return ctx.repos.changeRequests.list({ where: { contractId, status: 'pending', endorsementId: { isNull: true } } });
}

export function toChangeRequest(r: ChangeRequestRow): ChangeRequest {
  const { newPerson: _n, policyChangeId: _p, ...out } = r;
  return out;
}

/** What the checklist of the deal's stage is computed from (../nextStep.ts). */
export async function checklistInput(ctx: BaseCtx, deal: Deal): Promise<ChecklistInput> {
  const c = await dealContract(ctx, deal.id);
  const client = await ctx.repos.clients.get(deal.clientId);
  const kp = await dealKp(ctx, deal.id);
  const quote = await latestQuote(ctx, deal.id);
  return {
    stage: deal.stage,
    census: await ctx.repos.censuses.exists({ dealId: deal.id }),
    ...(quote ? { quote: { status: quote.status } } : {}),
    ...(kp ? { kp: { status: kp.status } } : {}),
    ...(c
      ? {
          contract: {
            status: c.status,
            insuredCount: c.insuredCount ?? 0,
            clientInn: client?.inn ?? '',
            clientSignatory: c.params.clientSignatory,
            migSignatoryId: c.params.migSignatoryId,
            clauseChanges: c.clauseOverrides.length,
            financeDiffers: !!c.financeDiffers,
            financeApproved: !!c.financeApprovedByName,
            signing: c.signing,
          },
        }
      : {}),
    invoicePaid: !!c && (await ctx.repos.invoices.exists({ contractId: c.id, status: 'paid' })),
  };
}
