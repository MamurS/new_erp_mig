/*
 * Contracts and endorsements (LIFECYCLE_SPEC §7–11): drafting, legal review, signing (E-IMZO, paper, EDO,
 * verified scans, paper originals), appendix 2, termination; invoices, payments, the 1C bank statement and
 * the queue of manual allocation; certificates; change requests of a contract in force.
 */
import { msg, t, tm } from '@mig/i18n';
import { stripImageMetadata } from '../lib/imageMeta';
import Papa from 'papaparse';
import type { BankPayment, ClauseOverride, Contract, Endorsement, Invoice, Payment, SessionUser, Signing } from '@mig/contracts';
import type { BankPaymentView, CertificateView, ChangeRequestView, ContractView, EndorsementView, ImportPaymentsResult, InvoiceView } from '@mig/contracts/dto';
import {
  changeRequestCreateSchema,
  contractCreateSchema,
  contractPatchSchema,
  edoSendSchema,
  endorsementCreateSchema,
  endorsementPatchSchema,
  legalApproveSchema,
  legalReturnSchema,
  originalsSchema,
  paymentAllocationSchema,
  paymentSchema,
  scanVerifySchema,
  signSchema,
  terminateSchema,
} from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { addDays, addPendingScan, addSignature, buildPaymentSchedule, contractNumber, originalReminderDue, verifyScan as verifyScanSig, type Side } from '../contracts';
import { clausesOf, DOC_TEMPLATES } from '../documents/templates/index';
import { PERIODICITIES } from '../endorsements';
import { isStaffRole } from '../labels';
import { countsOf, groupSize } from '../minGroup';
import { dealChecklist, missingItems } from '../nextStep';
import { checkAllocation, matchPayment, remainingOf, statementLineKey, type OpenInvoice } from '../payments';
import { contractPricing, pricingProblem } from '../pricing';
import { detectMime } from '../lib/mime';
import { randomId } from '../lib/random';
import { tzIso } from '../lib/time';
import type { ChangeRequestRow } from '../store/db';
import { byLegalForm, byLegalName, filterLegalForm, q as searchTerm, sortBy } from './list';
import { asSystem, audit, conflict, DomainError, errorOf, forbidden, notFound, requirePermission, systemRepos, todayIso, validate, type AuthCtx, type BaseCtx } from './kernel';
import { loadParams } from './params';
import { saveInvoiceStatus } from './clocks';
import { assistanceName } from './assistance';
import { personFor } from './family';
import { afterSigning, checklistInput, clientRow, contractOf, createEndorsement, dealEvent, dealKp, dealOf, endorsementLines, endorsementSummary, latestQuote, moveDeal, pendingRequests, refreshContract, refreshInvoice, signatories, signatoryOption, toChangeRequest } from './lifecycle';
import { parsePolicyList, toListRow } from './policy';
import { completeTasks } from './tasks';
import { toClient } from './views';
import { sameJson } from '../lib/json';

const SCAN_MAX_BYTES = 20 * 1024 * 1024;
export type DocKind = 'contract' | 'endorsement';

/** Documents HR sees: from the moment they are sent to the client. */
const HR_VISIBLE = new Set(['sent', 'signing', 'signed', 'active', 'terminated', 'expired']);

/** A contract or an endorsement as the signing rules see it (a snapshot: read anew after changes). */
interface DocRef {
  kind: DocKind;
  id: string;
  number: string;
  clientId: string;
  dealId?: string;
  contract: Contract;
  status: string;
  signing: Signing;
  clauseOverrides: ClauseOverride[];
}

async function refOf(ctx: BaseCtx, kind: DocKind, id: string): Promise<DocRef> {
  if (kind === 'contract') {
    const c = await contractOf(ctx, id);
    return { kind, id: c.id, number: c.number, clientId: c.clientId, dealId: c.dealId, contract: c, status: c.status, signing: c.signing, clauseOverrides: c.clauseOverrides };
  }
  const e = await ctx.repos.endorsements.get(id);
  if (!e) throw notFound();
  const c = await contractOf(ctx, e.contractId);
  return { kind, id: e.id, number: e.number, clientId: c.clientId, dealId: c.dealId, contract: c, status: e.status, signing: e.signing, clauseOverrides: e.clauseOverrides };
}

async function setStatus(ctx: BaseCtx, ref: DocRef, status: string): Promise<void> {
  ref.status = status;
  if (ref.kind === 'contract') {
    ref.contract.status = status as Contract['status'];
    await ctx.repos.contracts.update(ref.id, { status: ref.contract.status });
  } else await ctx.repos.endorsements.update(ref.id, { status: status as Endorsement['status'] });
}

async function setSigning(ctx: BaseCtx, ref: DocRef, signing: Signing): Promise<void> {
  ref.signing = signing;
  if (ref.kind === 'contract') {
    ref.contract.signing = signing;
    await ctx.repos.contracts.update(ref.id, { signing });
  } else await ctx.repos.endorsements.update(ref.id, { signing });
}

/** Appends a line to the contract's version history (read anew: nested steps may have changed the row). */
async function addVersion(ctx: BaseCtx, contractId: string, v: Contract['versions'][number]): Promise<void> {
  const c = await contractOf(ctx, contractId);
  await ctx.repos.contracts.update(c.id, { versions: [...c.versions, v] });
}

/** Staff with contracts.read, or HR of the client's company once the document was sent; anyone else 404/403. */
/** Roles that never read contracts get 403 before the lookup (RLS would hide the row and answer 404). */
function readerRole(user: SessionUser): void {
  if (user.role !== 'hr' && (!isStaffRole(user.role) || !can(user, 'contracts.read'))) throw forbidden();
}

function readable(user: SessionUser, ref: DocRef): void {
  if (user.role === 'hr') {
    if (!can(user, 'contracts.read', { companyId: ref.clientId }) || !HR_VISIBLE.has(ref.status)) throw notFound();
    return;
  }
  if (!isStaffRole(user.role) || !can(user, 'contracts.read')) throw forbidden();
}

const signerForClient = (c: Contract) => c.params.clientSignatory.name;

/** The invoice's status by today; a changed status is saved (as a read of the invoice always did). */
async function freshInvoice(ctx: BaseCtx, inv: Invoice): Promise<Invoice> {
  const before = inv.status;
  refreshInvoice(inv, todayIso(ctx));
  if (inv.status !== before) await saveInvoiceStatus(ctx, inv.id, inv.status);
  return inv;
}

async function contractView(person: BaseCtx, c: Contract): Promise<ContractView> {
  // The card of a contract the person may read (checked by the caller): the deal, the quote, signatories,
  // invoices, payments and endorsements around it come from tables the reader's RLS may not cover.
  const ctx = asSystem(person, 'contract card for its reader: deal, quote, signatories, invoices, payments, endorsements');
  const r = ctx.repos;
  const P = await loadParams(ctx);
  const client = await clientRow(ctx, c.clientId);
  const q = c.quoteId ? await r.quotes.get(c.quoteId) : await latestQuote(ctx, c.dealId);
  const signatory = await r.staff.get(c.params.migSignatoryId);
  const invoices: Invoice[] = [];
  for (const i of await r.invoices.list({ where: { contractId: c.id } })) invoices.push(await freshInvoice(ctx, i));
  return {
    ...c,
    client: await toClient(ctx, client),
    dealNumber: (await r.deals.get(c.dealId))?.number ?? '—',
    migSignatory: signatory ? signatoryOption(signatory) : null,
    signatories: await signatories(ctx),
    insuredRows: ((await r.contractInsured.get(c.id))?.rows ?? []).map((x) => ({ fullName: x.fullName, position: x.position, relation: x.relation })),
    group: await contractGroup(ctx, c),
    invoices,
    payments: await r.payments.list({ where: { contractId: c.id } }),
    endorsements: (await r.endorsements.list({ where: { contractId: c.id } })).map(endorsementSummary),
    quote: q ? { id: q.id, premiumEmployee: q.premiumEmployee, premiumFamily: q.premiumFamily, total: q.total, program: q.program } : null,
    originalOverdue: originalReminderDue(c.signing, ctx.now(), P.dmsParam('paperOriginalReminderDays')),
    assistanceName: (await assistanceName(ctx, c.params.assistanceId ?? null)) ?? undefined,
  };
}

async function needsAmountApproval(ctx: BaseCtx, e: Endorsement): Promise<boolean> {
  return (await ctx.repos.changeRequests.exists({ id: { in: e.changeRequestIds }, type: 'other' })) && !e.amountsApprovedByName;
}

async function endorsementView(person: BaseCtx, e: Endorsement): Promise<EndorsementView> {
  const ctx = asSystem(person, 'endorsement card for its reader: the contract, the MIG signatory, change requests');
  const c = await contractOf(ctx, e.contractId);
  const client = await clientRow(ctx, c.clientId);
  const signatory = await ctx.repos.staff.get(c.params.migSignatoryId);
  return {
    ...e,
    contractNumber: c.number,
    clientId: client.id,
    clientName: client.name,
    clientLegalForm: client.legalForm,
    clientInn: client.inn,
    migSignatory: signatory ? signatoryOption(signatory) : null,
    clientSignatoryName: signerForClient(c),
    requests: (await ctx.repos.changeRequests.list({ where: { id: { in: e.changeRequestIds } } })).map(toChangeRequest),
    needsAmountApproval: await needsAmountApproval(ctx, e),
  };
}

async function endorsementViewOf(ctx: BaseCtx, id: string): Promise<EndorsementView> {
  const e = await ctx.repos.endorsements.get(id);
  if (!e) throw notFound();
  return endorsementView(ctx, e);
}

/** The client's HR sees the document and its signing, not MIG's internal kitchen. */
function forViewer<T extends ContractView | EndorsementView>(user: SessionUser, v: T): T {
  if (user.role !== 'hr') return v;
  if ('signatories' in v) return { ...v, signatories: [], quote: null, versions: [], legalComment: undefined, financeDiffers: undefined, financeApprovedByName: undefined, legalApprovedByName: undefined, payments: [] };
  return { ...v, needsAmountApproval: false, amountsApprovedByName: undefined };
}

/** The current state of the document for the viewer. */
async function viewOf(ctx: AuthCtx, kind: DocKind, id: string): Promise<ContractView | EndorsementView> {
  const v = kind === 'contract' ? await contractView(ctx, await contractOf(ctx, id)) : await endorsementViewOf(ctx, id);
  return forViewer(ctx.user, v);
}

function overridesFrom(kind: DocKind, input: { clauseId: string; text: string }[], previous: ClauseOverride[], user: SessionUser, now: number): ClauseOverride[] {
  const clauses = clausesOf(kind === 'contract' ? 'contract' : 'endorsement');
  return input.flatMap((o) => {
    const clause = clauses.find((c) => c.id === o.clauseId);
    if (!clause) throw new DomainError(422, 'validation', 'srv.contract.clauseNotFound', { params: { clause: o.clauseId } });
    if (o.text === clause.text) return [];
    const prev = previous.find((p) => p.clauseId === o.clauseId && p.text === o.text);
    return [prev ?? { clauseId: o.clauseId, original: clause.text, text: o.text, byId: user.id, byName: user.displayName, at: tzIso(now) }];
  });
}

/** The fields of a scan upload as the adapter read them; `null`: the form could not be read at all. */
export interface ScanForm {
  side: string | null;
  file: { size: number; bytes: Uint8Array } | null;
}

export interface Scan {
  side: Side;
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'application/pdf';
}

/** Checks an uploaded signature scan: the side, a PDF/JPEG/PNG file (by its bytes) of at most 20 MB. */
export function checkScan(form: ScanForm | null): Scan {
  if (!form) throw new DomainError(400, 'validation', 'srv.form.invalid');
  const { side, file } = form;
  if (side !== 'mig' && side !== 'client') throw new DomainError(422, 'validation', 'srv.signing.sideRequired', { fields: { side: msg('srv.signing.sideHint') } });
  if (!file) throw new DomainError(422, 'validation', 'srv.signing.addScan', { fields: { file: msg('srv.signing.addFile') } });
  if (file.size === 0 || file.size > SCAN_MAX_BYTES) throw new DomainError(422, 'validation', 'srv.file.tooLarge20mb', { fields: { file: msg('srv.file.tooLarge20mb') } });
  const mime = detectMime(file.bytes);
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'application/pdf') throw new DomainError(422, 'validation', 'srv.file.onlyPdfJpegPng', { fields: { file: msg('srv.file.unsupported') } });
  return { side, bytes: stripImageMetadata(file.bytes), mime };
}

/** An `age_banded` contract without a usable band table cannot go further (legal review, signing). */
function pricingGuard(c: Contract): void {
  const problem = pricingProblem(contractPricing(c.params));
  if (problem) throw errorOf(422, 'validation', problem, { 'params.pricingBasis': problem });
}

/**
 * Before signing: the group of appendix 2 (or of the contract terms while it is not uploaded) is at least the
 * minimal group size, or the quote carries an approved exception (DECISIONS «Минимальная численность»).
 */
export async function contractGroup(ctx: BaseCtx, c: Contract): Promise<{ size: number; min: number; below: boolean; exception: boolean }> {
  const rules = (await loadParams(ctx)).groupRules();
  const rows = (await ctx.repos.contractInsured.get(c.id))?.rows;
  const counts = rows?.length ? countsOf(rows) : { employees: c.params.employees, family: c.params.familyMembers };
  const size = groupSize(counts, rules);
  const exception = !!(c.quoteId ? await ctx.repos.quotes.get(c.quoteId) : null)?.belowMinException;
  return { size, min: rules.min, below: size < rules.min, exception };
}

async function groupGuard(ctx: BaseCtx, c: Contract): Promise<void> {
  // A transferred contract in force is not re-signed here; the rule is for new contracts.
  if (c.migration) return;
  const g = await contractGroup(ctx, c);
  if (g.below && !g.exception) throw conflict('srv.contract.belowMinGroup', { n: g.size, min: g.min });
}

const targetType = (kind: DocKind) => (kind === 'contract' ? 'contract' : 'endorsement');

// ---------------------------------------------------------------- signing (§8: the same rules for both documents)

async function loadDoc(ctx: AuthCtx, kind: DocKind, id: string): Promise<DocRef> {
  const ref = await refOf(ctx, kind, id);
  readable(ctx.user, ref);
  return ref;
}

async function signable(ctx: BaseCtx, ref: DocRef, side: Side): Promise<void> {
  if (ref.kind === 'contract') pricingGuard(ref.contract);
  if (ref.kind === 'contract') await groupGuard(ctx, ref.contract);
  const ok = side === 'mig' ? ['approved', 'sent', 'signing'] : ['sent', 'signing'];
  if (!ok.includes(ref.status)) throw conflict(side === 'client' ? 'srv.doc.notSentToClient' : 'srv.doc.notApproved');
  if (ref.signing[side]) throw conflict(side === 'mig' ? 'srv.doc.migSigned' : 'srv.doc.clientSigned');
}

async function signed(ctx: AuthCtx, ref: DocRef, side: Side, how: string): Promise<void> {
  const { user } = ctx;
  await audit(ctx, user, 'contract_signed', { targetType: targetType(ref.kind), targetId: ref.id, targetLabel: `${ref.number}: ${side === 'mig' ? 'МИГ' : 'клиент'}, ${how}` });
  if (ref.dealId && ref.kind === 'contract') await dealEvent(ctx, ref.dealId, user.displayName, `${ref.number}: подпись ${side === 'mig' ? 'МИГ' : 'клиента'} (${how})`);
  await afterSigning(ctx, ref.kind, ref.id, user.displayName);
}

export async function sign(ctx: AuthCtx, kind: DocKind, id: string, body: unknown): Promise<ContractView | EndorsementView> {
  const { user } = ctx;
  const ref = await loadDoc(ctx, kind, id);
  const input = validate(signSchema, body);
  if (input.side === 'mig') {
    // Only a MIG employee who is a signatory (StaffUser.signatory) signs for MIG.
    if (!can(user, 'contracts.sign_mig')) throw new DomainError(403, 'forbidden', 'srv.signing.signatoryOnly');
  } else if (!can(user, 'contracts.sign_client', { companyId: ref.clientId })) {
    throw user.role === 'hr' ? notFound() : new DomainError(403, 'forbidden', 'srv.signing.clientInPortal');
  }
  await signable(ctx, ref, input.side);
  const at = tzIso(ctx.now());
  const sig =
    input.method === 'eimzo'
      ? { method: 'eimzo' as const, signedAt: at, signerName: user.displayName, certificate: { serial: input.certificateSerial, owner: user.displayName, validTo: addDays(todayIso(ctx), 365) } }
      : { method: 'paper' as const, signedAt: at, signerName: user.displayName };
  await setSigning(ctx, ref, { ...addSignature(ref.signing, input.side, sig), ...(input.method === 'paper' ? { printedAt: at } : {}) });
  await signed(ctx, ref, input.side, input.method === 'eimzo' ? 'ЭЦП' : 'бумага');
  return viewOf(ctx, kind, ref.id);
}

export async function sendToEdo(ctx: AuthCtx, kind: DocKind, id: string, body: unknown): Promise<ContractView | EndorsementView> {
  const { user } = ctx;
  const ref = await loadDoc(ctx, kind, id);
  if (!can(user, 'contracts.sign_mig')) throw new DomainError(403, 'forbidden', 'srv.signing.edoSignatoryOnly');
  const { provider } = validate(edoSendSchema, body);
  if (kind === 'contract') await groupGuard(ctx, ref.contract);
  if (ref.signing.client) throw conflict('srv.doc.clientSigned');
  if (!['approved', 'sent', 'signing'].includes(ref.status)) throw conflict('srv.doc.notApproved');
  const at = tzIso(ctx.now());
  let s = ref.signing;
  if (!s.mig) s = addSignature(s, 'mig', { method: 'edo', signedAt: at, signerName: user.displayName, edoProvider: provider, certificate: { serial: 'C0FFEE01', owner: user.displayName, validTo: addDays(todayIso(ctx), 365) } });
  await setSigning(ctx, ref, { ...s, edoPending: { provider, sentAt: at } });
  if (ref.status === 'approved') await setStatus(ctx, ref, 'sent');
  await signed(ctx, ref, 'mig', `ЭДО ${provider}`);
  return viewOf(ctx, kind, ref.id);
}

/** A scan of a signed paper copy, waiting for verification. `form`: see ScanForm. */
export async function uploadScan(ctx: AuthCtx, kind: DocKind, id: string, form: ScanForm | null): Promise<ContractView | EndorsementView> {
  const { user } = ctx;
  const ref = await loadDoc(ctx, kind, id);
  const { side, bytes, mime } = checkScan(form);
  // HR uploads the client's scan in its cabinet; MIG staff who handle documents upload either side.
  if (user.role === 'hr') {
    if (side !== 'client' || !can(user, 'contracts.sign_client', { companyId: ref.clientId })) throw forbidden();
  } else if (!can(user, 'contracts.verify_scan') && !can(user, 'contracts.draft')) throw forbidden();
  await signable(ctx, ref, side);
  const fileId = randomId();
  await ctx.repos.files.insert({
    id: fileId,
    mime,
    bytes,
    clientId: ref.clientId,
    ...(kind === 'contract' ? { contractId: ref.id } : { endorsementId: ref.id }),
    fileName: `scan-${side}.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`,
  });
  await setSigning(ctx, ref, addPendingScan(ref.signing, side, fileId, tzIso(ctx.now()), user.displayName));
  if (ref.status === 'sent') await setStatus(ctx, ref, 'signing');
  await audit(ctx, user, 'contract_scan_uploaded', { targetType: targetType(kind), targetId: ref.id, targetLabel: `${ref.number}: скан ${side === 'mig' ? 'МИГ' : 'клиента'}` });
  if (ref.dealId && kind === 'contract') await dealEvent(ctx, ref.dealId, user.displayName, `${ref.number}: загружен скан подписи ${side === 'mig' ? 'МИГ' : 'клиента'}, ждёт проверки`);
  if (kind === 'contract') await moveDeal(ctx, ref.dealId, 'signing', user.displayName);
  return viewOf(ctx, kind, ref.id);
}

export async function verifyScan(ctx: AuthCtx, kind: DocKind, id: string, body: unknown): Promise<ContractView | EndorsementView> {
  const { user } = ctx;
  const ref = await loadDoc(ctx, kind, id);
  requirePermission(user, 'contracts.verify_scan');
  const { side } = validate(scanVerifySchema, body);
  if (!ref.signing.pendingScans?.some((p) => p.side === side)) throw conflict('srv.signing.noScanPending');
  const signer = side === 'client' ? signerForClient(ref.contract) : ((await ctx.repos.staff.get(ref.contract.params.migSignatoryId))?.fullName ?? user.displayName);
  await setSigning(ctx, ref, verifyScanSig(ref.signing, side, { id: user.id, name: user.displayName }, tzIso(ctx.now()), signer));
  await audit(ctx, user, 'contract_scan_verified', { targetType: targetType(kind), targetId: ref.id, targetLabel: `${ref.number}: скан ${side === 'mig' ? 'МИГ' : 'клиента'}` });
  await signed(ctx, ref, side, 'скан проверен');
  return viewOf(ctx, kind, ref.id);
}

export async function originals(ctx: AuthCtx, kind: DocKind, id: string, body: unknown): Promise<ContractView | EndorsementView> {
  const { user } = ctx;
  const ref = await loadDoc(ctx, kind, id);
  requirePermission(user, 'contracts.originals');
  const input = validate(originalsSchema, body);
  const s = ref.signing;
  const paper = { ...s.paperOriginal };
  if (input.migCopySentAt) {
    if (!s.mig) throw conflict('srv.signing.migFirst');
    paper.migCopySentAt = input.migCopySentAt;
  }
  let next: Signing = { ...s, paperOriginal: paper };
  if (input.clientOriginalReceivedAt) {
    paper.clientOriginalReceivedAt = input.clientOriginalReceivedAt;
    paper.receivedById = user.id;
    paper.receivedByName = user.displayName;
    paper.required = true;
    next = { ...s, paperOriginal: paper };
    // A received original signed by the client counts as the client's paper signature.
    if (!s.client) next = addSignature(next, 'client', { method: 'paper', signedAt: tzIso(ctx.now()), signerName: signerForClient(ref.contract) });
  }
  await setSigning(ctx, ref, next);
  await audit(ctx, user, 'contract_original', {
    targetType: targetType(kind),
    targetId: ref.id,
    targetLabel: `${ref.number}: ${input.clientOriginalReceivedAt ? 'оригинал клиента получен' : 'экземпляр МИГ отправлен клиенту'}`,
  });
  if (input.clientOriginalReceivedAt && !s.client) await signed(ctx, ref, 'client', 'бумага');
  return viewOf(ctx, kind, ref.id);
}

// ---- legal approval: needed only when a clause was changed ----

export async function submitLegal(ctx: AuthCtx, kind: DocKind, id: string): Promise<ContractView | EndorsementView> {
  const { user } = ctx;
  const ref = await loadDoc(ctx, kind, id);
  if (!can(user, kind === 'contract' ? 'contracts.draft' : 'endorsements.manage')) throw forbidden();
  if (ref.status !== 'draft') throw conflict('srv.doc.reviewDraftOnly');
  if (kind === 'contract' && ref.contract.financeDiffers && !ref.contract.financeApprovedByName) throw conflict('srv.contract.financeNeedsApproval');
  if (kind === 'contract') pricingGuard(ref.contract);
  if (kind === 'contract') {
    // «Что нужно для следующего этапа»: the required items of the contract stage (the UI shows the same list).
    const deal = ref.dealId ? await ctx.repos.deals.get(ref.dealId) : null;
    const missing = deal ? missingItems(dealChecklist({ ...(await checklistInput(ctx, deal)), stage: 'contract_draft' })) : [];
    if (missing.length) throw conflict('srv.next.missing', { items: missing.map((m) => tm(m.label)).join(', ') });
  }
  if (kind === 'endorsement') {
    const e = (await ctx.repos.endorsements.get(ref.id))!;
    if (await needsAmountApproval(ctx, e)) throw conflict('srv.endorsement.amountNeedsApproval');
  }
  const changed = ref.clauseOverrides.length > 0;
  await setStatus(ctx, ref, changed ? 'legal_review' : 'approved');
  await audit(ctx, user, 'contract_legal_submitted', {
    targetType: targetType(kind),
    targetId: ref.id,
    targetLabel: `${ref.number}: ${changed ? `изменено пунктов ${ref.clauseOverrides.length}` : 'без изменений пунктов'}`,
  });
  if (kind === 'contract') {
    await moveDeal(
      ctx,
      ref.dealId,
      'contract_review',
      user.displayName,
      changed ? `Договор ${ref.number} у юриста: изменено пунктов ${ref.clauseOverrides.length}` : `Договор ${ref.number} без изменённых пунктов — согласование юриста не требуется`,
    );
    await addVersion(ctx, ref.id, { version: ref.contract.version, at: tzIso(ctx.now()), byName: user.displayName, changes: changed ? 'Отправлен юристу' : 'Согласован без юриста (пункты не менялись)' });
  }
  return viewOf(ctx, kind, ref.id);
}

export async function legalApprove(ctx: AuthCtx, kind: DocKind, id: string, body: unknown): Promise<ContractView | EndorsementView> {
  const { user } = ctx;
  const ref = await loadDoc(ctx, kind, id);
  requirePermission(user, 'contracts.legal_approve');
  if (ref.status !== 'legal_review') throw conflict('srv.doc.notInReview');
  const { comment } = validate(legalApproveSchema, body);
  await setStatus(ctx, ref, 'approved');
  if (kind === 'contract') {
    await completeTasks(ctx, 'legal_review', { contractId: ref.id, dealId: ref.dealId, clientId: ref.contract.clientId }, user.displayName);
    await ctx.repos.contracts.update(ref.id, { legalApprovedByName: user.displayName, legalComment: undefined });
    await addVersion(ctx, ref.id, { version: ref.contract.version, at: tzIso(ctx.now()), byName: user.displayName, changes: `Юрист согласовал${comment ? `: ${comment}` : ''}` });
    if (ref.dealId) await dealEvent(ctx, ref.dealId, user.displayName, `Юрист согласовал договор ${ref.number}`);
  }
  await audit(ctx, user, 'contract_legal_approved', { targetType: targetType(kind), targetId: ref.id, targetLabel: ref.number, reason: comment });
  return viewOf(ctx, kind, ref.id);
}

export async function legalReturn(ctx: AuthCtx, kind: DocKind, id: string, body: unknown): Promise<ContractView | EndorsementView> {
  const { user } = ctx;
  const ref = await loadDoc(ctx, kind, id);
  requirePermission(user, 'contracts.legal_approve');
  if (ref.status !== 'legal_review') throw conflict('srv.doc.notInReview');
  const { comment } = validate(legalReturnSchema, body);
  await setStatus(ctx, ref, 'draft');
  if (kind === 'contract') {
    await ctx.repos.contracts.update(ref.id, { legalComment: comment });
    await addVersion(ctx, ref.id, { version: ref.contract.version, at: tzIso(ctx.now()), byName: user.displayName, changes: `Юрист вернул: ${comment}` });
    if (ref.dealId) await dealEvent(ctx, ref.dealId, user.displayName, `Юрист вернул договор ${ref.number}: ${comment}`);
  }
  await audit(ctx, user, 'contract_legal_returned', { targetType: targetType(kind), targetId: ref.id, targetLabel: ref.number, reason: comment });
  return viewOf(ctx, kind, ref.id);
}

export async function sendToClient(ctx: AuthCtx, kind: DocKind, id: string): Promise<ContractView | EndorsementView> {
  const { user } = ctx;
  const ref = await loadDoc(ctx, kind, id);
  if (!can(user, kind === 'contract' ? 'contracts.draft' : 'endorsements.manage')) throw forbidden();
  if (ref.status !== 'approved') throw conflict('srv.doc.sendApprovedOnly');
  await setStatus(ctx, ref, ref.signing.mig || ref.signing.client ? 'signing' : 'sent');
  await audit(ctx, user, 'contract_sent', { targetType: targetType(kind), targetId: ref.id, targetLabel: ref.number });
  if (kind === 'contract') {
    await moveDeal(ctx, ref.dealId, 'contract_sent', user.displayName, `Договор ${ref.number} отправлен клиенту`);
    await addVersion(ctx, ref.id, { version: ref.contract.version, at: tzIso(ctx.now()), byName: user.displayName, changes: 'Отправлен клиенту' });
  }
  return viewOf(ctx, kind, ref.id);
}

// ---------------------------------------------------------------- invoices and payments (§9)

async function invoiceView(ctx: BaseCtx, i: Invoice): Promise<InvoiceView> {
  const client = await ctx.repos.clients.get(i.clientId);
  return {
    ...i,
    clientName: client?.name ?? '—',
    clientLegalForm: client?.legalForm,
    clientInn: client?.inn,
    contractNumber: i.contractId ? (await ctx.repos.contracts.get(i.contractId))?.number : undefined,
    endorsementNumber: i.endorsementId ? (await ctx.repos.endorsements.get(i.endorsementId))?.number : undefined,
  };
}

async function recordPayment(
  ctx: BaseCtx,
  user: SessionUser,
  invoiceId: string,
  amount: number,
  paidAt: string,
  payerInn: string,
  purpose: string,
  source: Payment['source'],
  extra: Pick<Payment, 'matchedBy' | 'bankPaymentId' | 'docNumber' | 'comment'> = {},
): Promise<Payment> {
  const inv = await ctx.repos.invoices.get(invoiceId);
  if (!inv) throw notFound();
  const p: Payment = { id: randomId(), invoiceId: inv.id, contractId: inv.contractId, amount, paidAt, payerInn, purpose, source, recordedByName: user.displayName, ...extra };
  await ctx.repos.payments.insert(p, { at: 'start' });
  inv.paid = (inv.paid ?? 0) + amount;
  refreshInvoice(inv, todayIso(ctx));
  await ctx.repos.invoices.update(inv.id, { paid: inv.paid, status: inv.status });
  const c = inv.contractId ? await ctx.repos.contracts.get(inv.contractId) : null;
  if (c) {
    if (c.dealId) await dealEvent(ctx, c.dealId, user.displayName, `Оплата ${amount} по счёту ${inv.number}${inv.status === 'paid' ? ' (оплачен)' : ' (частично)'}`);
    await refreshContract(ctx, c);
  }
  return p;
}

/** Contract invoices with the client's INN, as the matching rules see them. */
async function openInvoices(ctx: BaseCtx): Promise<OpenInvoice[]> {
  const inns = new Map((await ctx.repos.clients.list()).map((c) => [c.id, c.inn]));
  return (await ctx.repos.invoices.list({ where: { contractId: { isNull: false } } })).map((i) => ({
    id: i.id,
    number: i.number,
    clientId: i.clientId,
    clientInn: inns.get(i.clientId) ?? '',
    amount: i.amount,
    paid: i.paid ?? 0,
    dueDate: i.dueDate,
  }));
}

/** A queued payment with fresh candidates for what is left of it. */
async function bankPaymentView(ctx: BaseCtx, b: BankPayment): Promise<BankPaymentView> {
  const remaining = b.amount - b.allocated;
  const all = await openInvoices(ctx);
  const m = b.status === 'pending' ? matchPayment({ amount: remaining, payerInn: b.payerInn, purpose: b.purpose }, all) : undefined;
  // A queued payment is never allocated automatically: an exact match found later is offered as a candidate.
  const cands = !m ? [] : m.kind === 'manual' ? m.candidates : [{ invoiceId: m.invoiceId, why: m.by }];
  // The payer as known by its INN (a client), else as written in the statement.
  const payer = await ctx.repos.clients.first({ where: { inn: b.payerInn } });
  const candidates: BankPaymentView['candidates'] = [];
  for (const c of cands) {
    const inv = all.find((i) => i.id === c.invoiceId);
    const row = await ctx.repos.invoices.get(c.invoiceId);
    if (!inv || !row) continue;
    const view = await invoiceView(ctx, row);
    candidates.push({
      invoiceId: inv.id,
      number: inv.number,
      clientName: view.clientName,
      clientLegalForm: view.clientLegalForm,
      clientInn: inv.clientInn,
      contractNumber: view.endorsementNumber ?? view.contractNumber,
      remaining: remainingOf(inv),
      dueDate: inv.dueDate,
      why: c.why,
    });
  }
  return {
    ...b,
    ...(payer ? { payerName: payer.name, payerLegalForm: payer.legalForm } : {}),
    remaining,
    candidates,
  };
}

async function certificates(ctx: BaseCtx, policyId: string): Promise<CertificateView[]> {
  // Document data of the certificates (the caller decided who may read which).
  const r = systemRepos(ctx, 'certificates of a policy: client, contract number, assistance and persons (document data)');
  const p = await r.policies.get(policyId);
  if (!p) throw notFound();
  const c = p.contractId ? await r.contracts.get(p.contractId) : null;
  const a = p.assistanceId ? await r.assistances.get(p.assistanceId) : null;
  const client = await r.clients.get(p.clientId);
  return (await r.insured.list({ where: { policyId: p.id, status: 'active' } }))
    .filter((i) => i.certificateNumber)
    .map((i) => ({
      insuredId: i.id,
      fullName: i.fullName,
      certificateNumber: i.certificateNumber!,
      insuredFrom: i.insuredFrom,
      policyNumber: p.number,
      policyEndDate: p.endDate,
      program: p.program,
      clientName: client?.name ?? p.clientName,
      clientLegalForm: client?.legalForm,
      contractNumber: c?.number ?? '—',
      assistanceName: a?.name ?? 'MIG',
      assistanceLegalForm: a?.legalForm,
      assistancePhone: a?.phone24x7 ?? '+998 71 200 00 00',
    }));
}

async function changeRequestView(ctx: BaseCtx, r: ChangeRequestRow): Promise<ChangeRequestView> {
  const c = (await ctx.repos.contracts.get(r.contractId))!;
  const client = await ctx.repos.clients.get(c.clientId);
  return {
    ...toChangeRequest(r),
    contractNumber: c.number,
    clientName: client?.name ?? '—',
    clientLegalForm: client?.legalForm,
    endorsementNumber: r.endorsementId ? (await ctx.repos.endorsements.get(r.endorsementId))?.number : undefined,
  };
}

/** Runs the lazy server clock over every contract (EDO events, coming into force, expiry). */
async function refreshAllContracts(ctx: BaseCtx): Promise<void> {
  for (const c of await ctx.repos.contracts.list()) await refreshContract(ctx, c);
}

// ---------------------------------------------------------------- contracts

export async function listContracts(ctx: AuthCtx, qs: URLSearchParams): Promise<ContractView[]> {
  const { user } = ctx;
  await refreshAllContracts(ctx);
  let list = await ctx.repos.contracts.list();
  if (user.role === 'hr') {
    if (!user.companyId) throw forbidden();
    list = list.filter((c) => c.clientId === user.companyId && HR_VISIBLE.has(c.status));
  } else if (!isStaffRole(user.role) || !can(user, 'contracts.read')) throw forbidden();
  const status = qs.get('status');
  if (status) list = list.filter((c) => status.split(',').includes(c.status));
  const clientId = qs.get('clientId');
  if (clientId) list = list.filter((c) => c.clientId === clientId);
  // `?q=`: the new number, the number in the previous system (transferred contracts) or the client.
  const term = searchTerm(qs);
  if (term) list = list.filter((c) => c.number.toLowerCase().includes(term) || (c.externalNumber ?? '').toLowerCase().includes(term) || c.clientName.toLowerCase().includes(term));
  const all: ContractView[] = [];
  for (const c of list) all.push(forViewer(user, await contractView(ctx, c)));
  const views = filterLegalForm(all, qs, (c) => c.client.legalForm);
  return sortBy(views, qs, {
    number: (c) => c.number,
    clientName: byLegalName((c) => c.client.name),
    legalForm: byLegalForm((c) => c.client.legalForm),
    status: (c) => c.status,
    startDate: (c) => c.params.startDate,
    total: (c) => c.params.total,
  });
}

export async function getContract(ctx: AuthCtx, id: string): Promise<ContractView> {
  readerRole(ctx.user);
  const ref = await refOf(ctx, 'contract', id);
  readable(ctx.user, ref);
  await refreshContract(ctx, ref.contract);
  return forViewer(ctx.user, await contractView(ctx, ref.contract));
}

export async function createContract(ctx: AuthCtx, body: unknown): Promise<ContractView> {
  const { user } = ctx;
  const r = ctx.repos;
  requirePermission(user, 'contracts.draft');
  const { dealId } = validate(contractCreateSchema, body);
  const deal = await dealOf(ctx, dealId);
  const kp = await dealKp(ctx, deal.id);
  if (!kp || kp.status !== 'accepted') throw conflict('srv.contract.needsAcceptedKp');
  if (await r.contracts.exists({ dealId: deal.id })) throw conflict('srv.contract.alreadyExists');
  const client = await clientRow(ctx, deal.clientId);
  const q = kp.quoteId ? ((await r.quotes.get(kp.quoteId)) ?? undefined) : await latestQuote(ctx, deal.id);
  const signatory = (await r.staff.list({ where: { active: true } })).find((s) => s.signatory?.canSign);
  if (!signatory) throw conflict('srv.contract.noSignatory');
  const P = await loadParams(ctx);
  const seq = await r.seq.next('contract');
  const total = kp.params.premiumEmployee * kp.params.employees + kp.params.premiumFamily * kp.params.familyMembers;
  const at = tzIso(ctx.now());
  const c: Contract = {
    id: randomId(),
    number: contractNumber(new Date(ctx.now()).getFullYear(), seq, P.numbering()),
    dealId: deal.id,
    clientId: client.id,
    clientName: client.name,
    version: 1,
    templateId: 'contract',
    templateVersion: DOC_TEMPLATES.contract.version,
    params: {
      startDate: kp.params.coverageStart,
      endDate: kp.params.coverageEnd,
      program: q?.program ?? client.program ?? 'standard',
      premiumEmployee: kp.params.premiumEmployee,
      premiumFamily: kp.params.premiumFamily,
      employees: kp.params.employees,
      familyMembers: kp.params.familyMembers,
      total,
      // Inclusions during the term are priced as the underwriter chose in the quote; the band table of the
      // quote is the contract's appendix (also when priced by type, so the basis can be switched in the draft).
      pricingBasis: q?.pricingBasis ?? 'flat_by_type',
      ...(q?.ageBandRates.length ? { ageBandRates: q.ageBandRates.map((x) => ({ ...x })) } : {}),
      paymentFrequency: 'single',
      paymentSchedule: buildPaymentSchedule(total, kp.params.coverageStart, 'single'),
      // By default the contract comes into force not earlier than the first installment is paid.
      activationRule: 'after_first_payment',
      migSignatoryId: signatory.id,
      clientSignatory: { name: client.requisites?.director ?? client.hrContact.name, position: 'Директор', basis: client.requisites?.directorBasis ?? 'Устав' },
      assistanceId: kp.params.assistanceId ?? null,
    },
    clauseOverrides: [],
    status: 'draft',
    signing: { paperOriginal: { required: false } },
    createdAt: at,
    quoteId: q?.id,
    versions: [{ version: 1, at, byName: user.displayName, changes: `Создан по КП ${kp.number}` }],
  };
  await r.contracts.insert(c, { at: 'start' });
  await moveDeal(ctx, deal.id, 'contract_draft', user.displayName, `Подготовлен договор ${c.number}`);
  await audit(ctx, user, 'contract_created', { targetType: 'contract', targetId: c.id, targetLabel: c.number });
  await completeTasks(ctx, 'contract_draft', { dealId: deal.id, clientId: deal.clientId }, user.displayName);
  return contractView(ctx, c);
}

export async function patchContract(ctx: AuthCtx, id: string, body: unknown): Promise<ContractView> {
  const { user } = ctx;
  requirePermission(user, 'contracts.draft');
  const c = await contractOf(ctx, id);
  if (c.status !== 'draft') throw conflict('srv.contract.draftOnly');
  const input = validate(contractPatchSchema, body);
  const changes: string[] = [];
  if (input.params) {
    const p = { ...c.params, ...input.params };
    if (p.endDate <= p.startDate) throw new DomainError(422, 'validation', 'srv.contract.endAfterStart', { fields: { 'params.endDate': msg('srv.contract.afterStart') } });
    const signatory = await ctx.repos.staff.get(p.migSignatoryId);
    if (!signatory?.signatory?.canSign) throw new DomainError(422, 'validation', 'srv.contract.chooseSignatory', { fields: { 'params.migSignatoryId': msg('srv.contract.notSignatory') } });
    const pricing = pricingProblem(contractPricing(p));
    if (pricing) throw errorOf(422, 'validation', pricing, { 'params.pricingBasis': pricing });
    p.total = p.premiumEmployee * p.employees + p.premiumFamily * p.familyMembers;
    if (input.params.paymentSchedule) {
      const sum = input.params.paymentSchedule.reduce((s, x) => s + x.amount, 0);
      if (sum !== p.total) throw new DomainError(422, 'validation', 'srv.contract.scheduleSum', { fields: { 'params.paymentSchedule': msg('srv.contract.scheduleSumHint', { sum, total: p.total }) } });
    } else p.paymentSchedule = buildPaymentSchedule(p.total, p.startDate, p.paymentFrequency);
    for (const k of Object.keys(input.params) as (keyof typeof input.params)[]) if (!sameJson(c.params[k], p[k])) changes.push(k);
    c.params = p;
    const q = c.quoteId ? await ctx.repos.quotes.get(c.quoteId) : null;
    const differs = !!q && (q.premiumEmployee !== p.premiumEmployee || q.premiumFamily !== p.premiumFamily);
    if (differs !== !!c.financeDiffers || (differs && changes.some((x) => x.startsWith('premium')))) c.financeApprovedByName = undefined;
    c.financeDiffers = differs;
  }
  if (input.clauseOverrides) {
    const next = overridesFrom('contract', input.clauseOverrides, c.clauseOverrides, user, ctx.now());
    const before = new Set(c.clauseOverrides.map((o) => `${o.clauseId}:${o.text}`));
    const changedClauses = next.filter((o) => !before.has(`${o.clauseId}:${o.text}`)).map((o) => o.clauseId);
    const removed = c.clauseOverrides.filter((o) => !next.some((n) => n.clauseId === o.clauseId)).map((o) => o.clauseId);
    if (changedClauses.length) changes.push(`изменены пункты ${changedClauses.join(', ')}`);
    if (removed.length) changes.push(`возвращён исходный текст пунктов ${removed.join(', ')}`);
    c.clauseOverrides = next;
  }
  if (changes.length) c.versions.push({ version: c.version, at: tzIso(ctx.now()), byName: user.displayName, changes: changes.join('; ') });
  await ctx.repos.contracts.update(c.id, { params: c.params, financeApprovedByName: c.financeApprovedByName, financeDiffers: c.financeDiffers, clauseOverrides: c.clauseOverrides, versions: c.versions });
  if (changes.length) await audit(ctx, user, 'contract_updated', { targetType: 'contract', targetId: c.id, targetLabel: `${c.number}: ${changes.join('; ')}`.slice(0, 200) });
  return contractView(ctx, c);
}

export async function financeApprove(ctx: AuthCtx, id: string): Promise<ContractView> {
  const { user } = ctx;
  requirePermission(user, 'quotes.calculate');
  const c = await contractOf(ctx, id);
  if (!c.financeDiffers) throw conflict('srv.contract.financeSame');
  c.financeApprovedByName = user.displayName;
  c.versions.push({ version: c.version, at: tzIso(ctx.now()), byName: user.displayName, changes: 'Андеррайтер утвердил финансовые условия' });
  await ctx.repos.contracts.update(c.id, { financeApprovedByName: c.financeApprovedByName, versions: c.versions });
  await audit(ctx, user, 'contract_finance_approved', { targetType: 'contract', targetId: c.id, targetLabel: c.number });
  return contractView(ctx, c);
}

export async function newVersion(ctx: AuthCtx, id: string): Promise<ContractView> {
  const { user } = ctx;
  requirePermission(user, 'contracts.draft');
  const c = await contractOf(ctx, id);
  if (!['sent', 'signing', 'approved'].includes(c.status)) throw conflict('srv.contract.newVersionState');
  c.version += 1;
  c.status = 'draft';
  c.signing = { paperOriginal: { required: false } };
  c.legalApprovedByName = undefined;
  c.versions.push({ version: c.version, at: tzIso(ctx.now()), byName: user.displayName, changes: `Новая версия ${c.version}: подписи предыдущей версии сброшены` });
  await ctx.repos.contracts.update(c.id, { version: c.version, status: c.status, signing: c.signing, legalApprovedByName: undefined, versions: c.versions });
  await moveDeal(ctx, c.dealId, 'contract_draft', user.displayName, `Договор ${c.number}: новая версия ${c.version}`);
  await audit(ctx, user, 'contract_updated', { targetType: 'contract', targetId: c.id, targetLabel: `${c.number}: версия ${c.version}` });
  return contractView(ctx, c);
}

/** Appendix 2 (`text`: the CSV file, a row per person). */
export async function uploadInsuredList(ctx: AuthCtx, id: string, text: string): Promise<ContractView> {
  const { user } = ctx;
  // HR uploads appendix 2 of a contract of its company it sees, or of a draft MIG asked it for («Запросить у HR»):
  // the draft is hidden from HR (RLS), so after these checks the system reads and writes it for HR.
  const hrCtx = user.role === 'hr' ? asSystem(ctx, 'appendix 2 by HR: the contract of its company MIG asked it to fill') : null;
  const c = await contractOf(hrCtx ?? ctx, id);
  if (user.role === 'hr') {
    const asked = await ctx.repos.tasks.exists({ status: 'open', toRole: 'hr', action: 'insured_list', contractId: c.id });
    if (!can(user, 'contracts.sign_client', { companyId: c.clientId }) || (!HR_VISIBLE.has(c.status) && !asked)) throw notFound();
  } else requirePermission(user, 'contracts.draft');
  ctx = hrCtx ?? ctx;
  if (c.status === 'active' || c.status === 'signed' || c.status === 'terminated' || c.status === 'expired') throw conflict('srv.contract.listViaEndorsement');
  const parsed = parsePolicyList(text);
  if (parsed.errors.length)
    throw new DomainError(422, 'validation', 'srv.census.fileErrors', {
      params: { count: parsed.errors.length, details: parsed.errors.slice(0, 3).map((e) => t('srv.census.rowError', { row: e.row, message: tm(e.message) })).join('; ') },
    });
  // Appendix 2: a row per person, family members with the relation and the employee's PINFL (FAMILY_SPEC).
  const rows = parsed.rows.map(toListRow);
  await ctx.repos.contractInsured.put({ contractId: c.id, rows });
  c.insuredListId = c.id;
  c.insuredCount = rows.length;
  c.versions.push({ version: c.version, at: tzIso(ctx.now()), byName: user.displayName, changes: `Загружено приложение 2: ${rows.length} застрахованных` });
  await ctx.repos.contracts.update(c.id, { insuredListId: c.insuredListId, insuredCount: c.insuredCount, versions: c.versions });
  await completeTasks(ctx, 'insured_list', { contractId: c.id, dealId: c.dealId, clientId: c.clientId }, user.displayName);
  if (c.dealId) await dealEvent(ctx, c.dealId, user.displayName, `Приложение 2 к договору ${c.number}: ${rows.length} застрахованных${user.role === 'hr' ? ' (загрузил HR клиента)' : ''}`);
  return forViewer(user, await contractView(ctx, c));
}

export async function terminate(ctx: AuthCtx, id: string, body: unknown): Promise<EndorsementView> {
  const { user } = ctx;
  requirePermission(user, 'endorsements.manage');
  if (user.role === 'hr') throw forbidden();
  const c = await contractOf(ctx, id);
  const { date, reason } = validate(terminateSchema, body);
  if (date < c.params.startDate || date > c.params.endDate) throw new DomainError(422, 'validation', 'srv.contract.dateWithinTerm', { fields: { date: msg('srv.contract.withinTerm') } });
  if (await ctx.repos.endorsements.exists({ contractId: c.id, kind: 'termination', status: { ne: 'signed' } })) throw conflict('srv.contract.terminationPending');
  const e = await createEndorsement(ctx, c, [], 'termination', date);
  if (c.dealId) await dealEvent(ctx, c.dealId, user.displayName, `Подготовлено соглашение о расторжении ${e.number}: ${reason}`);
  await audit(ctx, user, 'endorsement_created', { targetType: 'endorsement', targetId: e.id, targetLabel: `${e.number}: расторжение`, reason });
  return endorsementView(ctx, e);
}

// ---------------------------------------------------------------- invoices and payments (§9)

export async function listInvoices(ctx: AuthCtx, qs: URLSearchParams): Promise<InvoiceView[]> {
  const { user } = ctx;
  requirePermission(user, 'invoices.read');
  if (user.role === 'hr') throw forbidden();
  let list: Invoice[] = [];
  for (const i of await ctx.repos.invoices.list({ where: { contractId: { isNull: false } } })) list.push(await freshInvoice(ctx, i));
  const contractId = qs.get('contractId');
  if (contractId) list = list.filter((i) => i.contractId === contractId);
  const status = qs.get('status');
  if (status) list = list.filter((i) => status.split(',').includes(i.status));
  const all: InvoiceView[] = [];
  for (const i of list) all.push(await invoiceView(ctx, i));
  const views = filterLegalForm(all, qs, (i) => i.clientLegalForm);
  return sortBy(views, qs, {
    number: (i) => i.number,
    clientName: byLegalName((i) => i.clientName),
    legalForm: byLegalForm((i) => i.clientLegalForm),
    amount: (i) => i.amount,
    dueDate: (i) => i.dueDate,
    status: (i) => i.status,
  });
}

export async function createPayment(ctx: AuthCtx, body: unknown): Promise<Payment> {
  const { user } = ctx;
  requirePermission(user, 'payments.record');
  const input = validate(paymentSchema, body);
  const inv = await ctx.repos.invoices.get(input.invoiceId);
  if (!inv) throw notFound();
  if (input.amount > inv.amount - (inv.paid ?? 0)) throw new DomainError(422, 'validation', 'srv.invoice.overRemaining', { fields: { amount: msg('srv.invoice.remaining', { amount: inv.amount - (inv.paid ?? 0) }) } });
  const client = await ctx.repos.clients.get(inv.clientId);
  const p = await recordPayment(ctx, user, inv.id, input.amount, input.paidAt, client?.inn ?? '', input.purpose ?? `Оплата по счёту ${inv.number}`, 'manual');
  await audit(ctx, user, 'payment_recorded', { targetType: 'invoice', targetId: inv.id, targetLabel: `${inv.number}: ${input.amount}` });
  return p;
}

/** The bank statement exported from 1C (`text`: the CSV file). */
export async function importStatement(ctx: AuthCtx, text: string): Promise<ImportPaymentsResult> {
  const { user } = ctx;
  const r = ctx.repos;
  requirePermission(user, 'payments.record');
  if (text.length > 1024 * 1024) throw new DomainError(413, 'validation', 'srv.file.tooLarge1mb');
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields ?? [];
  const missing = ['doc_number', 'date', 'amount', 'inn', 'purpose'].filter((f) => !fields.includes(f));
  if (missing.length) throw new DomainError(422, 'validation', 'srv.statement.missingColumns', { params: { columns: missing.join(', ') } });
  if (parsed.data.length > 5000) throw new DomainError(422, 'validation', 'srv.statement.over5000Rows');
  const out: ImportPaymentsResult = { matched: 0, queued: 0, skipped: 0, unmatched: [], activated: 0 };
  const activeBefore = await r.contracts.count({ status: 'active' });
  for (const [k, row] of parsed.data.entries()) {
    const line = k + 2;
    const amount = Number((row.amount ?? '').replace(/\s/g, ''));
    const date = (row.date ?? '').trim();
    const inn = (row.inn ?? '').replace(/\D/g, '').slice(0, 14);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000_000 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      out.unmatched.push({ line, reason: msg('srv.statement.badDateOrAmount') });
      continue;
    }
    const docNumber = (row.doc_number ?? '').trim().slice(0, 40);
    if (!docNumber) {
      out.unmatched.push({ line, reason: msg('srv.statement.noDocNumber') });
      continue;
    }
    // A repeated upload (or the same line twice in one file) changes nothing.
    const key = statementLineKey({ docNumber, date, amount, payerInn: inn });
    if (await r.statementKeys.has(key)) {
      out.skipped += 1;
      continue;
    }
    await r.statementKeys.add(key);
    const purpose = (row.purpose ?? '').trim().slice(0, 300);
    // Matching runs line by line on the current state: an earlier line of the same statement may pay an invoice off.
    const m = matchPayment({ amount, payerInn: inn, purpose }, await openInvoices(ctx));
    if (m.kind === 'matched') {
      await recordPayment(ctx, user, m.invoiceId, amount, date, inn, purpose, '1c', { matchedBy: m.by, docNumber });
      out.matched += 1;
      continue;
    }
    const payerName = (row.payer ?? '').trim().slice(0, 200) || undefined;
    await r.bankPayments.insert(
      { id: randomId(), docNumber, date, amount, payerInn: inn, payerName, purpose, reason: m.reason, importedAt: tzIso(ctx.now()), importedByName: user.displayName, allocated: 0, status: 'pending', allocations: [] },
      { at: 'start' },
    );
    out.queued += 1;
  }
  out.activated = (await r.contracts.count({ status: 'active' })) - activeBefore;
  await audit(ctx, user, 'payments_imported', {
    targetType: 'invoice',
    targetLabel: `Выписка 1С: сопоставлено ${out.matched}, в ручную разноску ${out.queued}, пропущено как повтор ${out.skipped}, ошибок ${out.unmatched.length}`,
  });
  return out;
}

export async function paymentQueue(ctx: AuthCtx, qs: URLSearchParams): Promise<BankPaymentView[]> {
  requirePermission(ctx.user, 'payments.record');
  const status = qs.get('status') === 'allocated' ? 'allocated' : 'pending';
  const all: BankPaymentView[] = [];
  for (const b of await ctx.repos.bankPayments.list({ where: { status } })) all.push(await bankPaymentView(ctx, b));
  const views = filterLegalForm(all, qs, (b) => b.payerLegalForm);
  return sortBy(views, qs, {
    date: (b) => b.date,
    payerName: byLegalName((b) => b.payerName ?? b.payerInn),
    legalForm: byLegalForm((b) => b.payerLegalForm),
    amount: (b) => b.amount,
    remaining: (b) => b.remaining,
  });
}

export async function allocatePayment(ctx: AuthCtx, id: string, body: unknown): Promise<BankPaymentView> {
  const { user } = ctx;
  requirePermission(user, 'payments.record');
  const b = await ctx.repos.bankPayments.get(id);
  if (!b) throw notFound();
  if (b.status !== 'pending') throw conflict('srv.payment.alreadyMatched');
  const input = validate(paymentAllocationSchema, body);
  if (new Set(input.lines.map((l) => l.invoiceId)).size !== input.lines.length) throw new DomainError(422, 'validation', 'srv.payment.invoiceTwice');
  const all = await openInvoices(ctx);
  const lines = input.lines.map((l) => {
    const invoice = all.find((i) => i.id === l.invoiceId);
    if (!invoice) throw notFound();
    return { invoice, amount: l.amount };
  });
  const error = checkAllocation(b, lines, input.comment);
  if (error) {
    // The comment is the last check: with a long enough comment the allocation passes.
    const aboutComment = checkAllocation(b, lines, 'comment') === null;
    throw errorOf(422, 'validation', error, aboutComment ? { comment: error } : undefined);
  }
  const comment = input.comment || undefined;
  for (const l of lines) {
    await recordPayment(ctx, user, l.invoice.id, l.amount, b.date, b.payerInn, b.purpose, '1c', { matchedBy: 'manual', bankPaymentId: b.id, docNumber: b.docNumber, comment });
    b.allocations.push({ invoiceId: l.invoice.id, invoiceNumber: l.invoice.number, amount: l.amount, at: tzIso(ctx.now()), byName: user.displayName, comment });
    b.allocated += l.amount;
    await ctx.repos.bankPayments.update(b.id, { allocations: b.allocations, allocated: b.allocated });
    const foreign = l.invoice.clientInn !== b.payerInn;
    await audit(ctx, user, 'payment_allocated', { targetType: 'invoice', targetId: l.invoice.id, targetLabel: `${l.invoice.number}: ${l.amount}${foreign ? ' (плательщик — третье лицо)' : ''}`, reason: comment });
  }
  if (b.allocated >= b.amount) {
    b.status = 'allocated';
    await ctx.repos.bankPayments.update(b.id, { status: b.status });
  }
  return bankPaymentView(ctx, b);
}

// ---------------------------------------------------------------- certificates (§10)

export async function policyCertificates(ctx: AuthCtx, policyId: string): Promise<CertificateView[]> {
  const { user } = ctx;
  readerRole(user);
  const p = await ctx.repos.policies.get(policyId);
  if (!p) throw notFound();
  if (user.role === 'hr') {
    if (!can(user, 'contracts.read', { companyId: p.clientId })) throw notFound();
  } else if (!isStaffRole(user.role) || !can(user, 'contracts.read')) throw forbidden();
  return certificates(ctx, p.id);
}

/** The insured person's certificate; `personId`: a person of the family the signed-in person may see (FAMILY_SPEC). */
export async function myCertificate(ctx: AuthCtx, personId: string | null): Promise<CertificateView | null> {
  const { user } = ctx;
  if (user.role !== 'insured' || !user.insuredId) throw forbidden();
  const viewer = await ctx.repos.insured.get(user.insuredId);
  if (!viewer) throw notFound();
  const me = (await personFor(ctx, viewer, personId, 'card')).person;
  if (!me.certificateNumber) throw notFound();
  return (await certificates(ctx, me.policyId)).find((c) => c.insuredId === me.id) ?? null;
}

// ---------------------------------------------------------------- change requests and endorsements (§11)

export async function listChangeRequests(ctx: AuthCtx, qs: URLSearchParams): Promise<ChangeRequestView[]> {
  const { user } = ctx;
  let list = await ctx.repos.changeRequests.list();
  if (user.role === 'hr') {
    if (!can(user, 'endorsements.manage', { companyId: user.companyId })) throw forbidden();
    const ids = new Set((await ctx.repos.contracts.list({ where: { clientId: user.companyId } })).map((c) => c.id));
    list = list.filter((r) => ids.has(r.contractId));
  } else if (!isStaffRole(user.role) || !can(user, 'contracts.read')) throw forbidden();
  const contractId = qs.get('contractId');
  if (contractId) list = list.filter((r) => r.contractId === contractId);
  const status = qs.get('status');
  if (status) list = list.filter((r) => status.split(',').includes(r.status));
  const all: ChangeRequestView[] = [];
  for (const r of list) all.push(await changeRequestView(ctx, r));
  return filterLegalForm(all, qs, (r) => r.clientLegalForm);
}

export async function createChangeRequest(ctx: AuthCtx, body: unknown): Promise<ChangeRequestView> {
  const { user } = ctx;
  requirePermission(user, 'endorsements.manage');
  if (user.role === 'hr') throw forbidden();
  const input = validate(changeRequestCreateSchema, body);
  const c = await contractOf(ctx, input.contractId);
  if (c.status !== 'active') throw conflict('srv.endorsement.activeOnly');
  if (input.effectiveDate < c.params.startDate || input.effectiveDate > c.params.endDate) throw new DomainError(422, 'validation', 'srv.contract.dateWithinTerm', { fields: { effectiveDate: msg('srv.contract.withinTerm') } });
  if (input.type === 'change_program' && (!input.program || input.program === c.params.program)) throw new DomainError(422, 'validation', 'srv.endorsement.otherProgram', { fields: { program: msg('srv.endorsement.otherProgram') } });
  if (input.type === 'other' && (input.amount === undefined || !input.description)) throw new DomainError(422, 'validation', 'srv.endorsement.describeAndAmount', { fields: { description: msg('srv.endorsement.describe') } });
  const r: ChangeRequestRow = {
    id: randomId(),
    contractId: c.id,
    type: input.type,
    effectiveDate: input.effectiveDate,
    payload: input.type === 'change_program' ? { program: input.program, fromProgram: c.params.program } : { amount: input.amount, description: input.description },
    requestedBy: { id: user.id, role: user.role, name: user.displayName },
    status: 'pending',
    createdAt: tzIso(ctx.now()),
    description: input.type === 'change_program' ? `Смена программы с ${input.effectiveDate.split('-').reverse().join('.')}` : input.description,
  };
  await ctx.repos.changeRequests.insert(r, { at: 'start' });
  await audit(ctx, user, 'change_request_created', { targetType: 'contract', targetId: c.id, targetLabel: `${c.number}: ${r.description ?? r.type}` });
  return changeRequestView(ctx, r);
}

export async function listEndorsements(ctx: AuthCtx, qs: URLSearchParams): Promise<EndorsementView[]> {
  const { user } = ctx;
  await refreshAllContracts(ctx);
  let list = await ctx.repos.endorsements.list();
  if (user.role === 'hr') {
    const ids = new Set((await ctx.repos.contracts.list()).filter((c) => c.clientId === user.companyId).map((c) => c.id));
    list = list.filter((e) => ids.has(e.contractId) && HR_VISIBLE.has(e.status));
  } else if (!isStaffRole(user.role) || !can(user, 'contracts.read')) throw forbidden();
  const contractId = qs.get('contractId');
  if (contractId) list = list.filter((e) => e.contractId === contractId);
  const all: EndorsementView[] = [];
  for (const e of list) all.push(forViewer(user, await endorsementView(ctx, e)));
  const views = filterLegalForm(all, qs, (e) => e.clientLegalForm);
  return sortBy(views, qs, {
    number: (e) => e.number,
    clientName: byLegalName((e) => e.clientName),
    legalForm: byLegalForm((e) => e.clientLegalForm),
    total: (e) => e.total,
    status: (e) => e.status,
    createdAt: (e) => e.createdAt,
  });
}

export async function getEndorsement(ctx: AuthCtx, id: string): Promise<EndorsementView> {
  readerRole(ctx.user);
  const ref = await refOf(ctx, 'endorsement', id);
  readable(ctx.user, ref);
  await refreshContract(ctx, ref.contract);
  return forViewer(ctx.user, await endorsementViewOf(ctx, ref.id));
}

export async function createEndorsements(ctx: AuthCtx, body: unknown): Promise<EndorsementView[]> {
  const { user } = ctx;
  requirePermission(user, 'endorsements.manage');
  if (user.role === 'hr') throw forbidden();
  const input = validate(endorsementCreateSchema, body);
  const c = await contractOf(ctx, input.contractId);
  let requests = await pendingRequests(ctx, c.id);
  if (input.changeRequestIds) requests = requests.filter((r) => input.changeRequestIds!.includes(r.id));
  if (!requests.length) throw conflict('srv.endorsement.noRequests');
  const periodicity = PERIODICITIES[(await loadParams(ctx)).dmsParam('endorsementPeriodicity')] ?? 'monthly';
  const groups = periodicity === 'per_change' ? requests.map((r) => [r]) : [requests];
  const out: EndorsementView[] = [];
  for (const g of groups) {
    const e = await createEndorsement(ctx, c, g, 'changes');
    await audit(ctx, user, 'endorsement_created', { targetType: 'endorsement', targetId: e.id, targetLabel: `${e.number}: строк ${g.length}` });
    out.push(await endorsementView(ctx, e));
  }
  return out;
}

export async function patchEndorsement(ctx: AuthCtx, id: string, body: unknown): Promise<EndorsementView> {
  const { user } = ctx;
  requirePermission(user, 'endorsements.manage');
  if (user.role === 'hr') throw forbidden();
  const e = await ctx.repos.endorsements.get(id);
  if (!e) throw notFound();
  if (e.status !== 'draft') throw conflict('srv.endorsement.draftOnly');
  const { clauseOverrides } = validate(endorsementPatchSchema, body);
  e.clauseOverrides = overridesFrom('endorsement', clauseOverrides, e.clauseOverrides, user, ctx.now());
  // Lines are recalculated: parameters (refund rule) may have changed since the draft was formed.
  if (e.kind !== 'termination') {
    e.lines = await endorsementLines(ctx, await contractOf(ctx, e.contractId), await ctx.repos.changeRequests.list({ where: { id: { in: e.changeRequestIds } } }));
    e.total = e.lines.reduce((s, l) => s + l.amount, 0);
  }
  await ctx.repos.endorsements.update(e.id, { clauseOverrides: e.clauseOverrides, lines: e.lines, total: e.total });
  return endorsementView(ctx, e);
}

export async function approveAmounts(ctx: AuthCtx, id: string): Promise<EndorsementView> {
  const { user } = ctx;
  requirePermission(user, 'endorsements.manage', { sub: 'approve_amounts' });
  if (user.role !== 'underwriter') throw forbidden();
  const e = await ctx.repos.endorsements.get(id);
  if (!e) throw notFound();
  e.amountsApprovedByName = user.displayName;
  await ctx.repos.endorsements.update(e.id, { amountsApprovedByName: e.amountsApprovedByName });
  await audit(ctx, user, 'contract_finance_approved', { targetType: 'endorsement', targetId: e.id, targetLabel: `${e.number}: суммы утверждены` });
  return endorsementView(ctx, e);
}
