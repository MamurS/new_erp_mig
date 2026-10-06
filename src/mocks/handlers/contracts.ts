/*
 * Contracts, endorsements and their signing (LIFECYCLE_SPEC §7–12): drafting with changed clauses,
 * legal and finance approval, sending, signing by each side with E-IMZO, EDO, paper or scan, the paper
 * original, invoices and payments (1C statement), coming into force, certificates, change requests,
 * endorsements and termination.
 */
import { msg, t, tm } from '@/i18n/core';
import { http, HttpResponse } from 'msw';
import Papa from 'papaparse';
import type { BankPayment, ClauseOverride, Contract, Endorsement, Payment, SessionUser, Signing } from '@/shared/types';
import type { BankPaymentView, CertificateView, ChangeRequestView, ContractView, EndorsementView, ImportPaymentsResult, InvoiceView } from '@/shared/types/dto';
import { checkAllocation, matchPayment, remainingOf, statementLineKey, type OpenInvoice } from '@/shared/domain/payments';
import { can } from '@/shared/auth/permissions';
import { isStaffRole } from '@/shared/domain/labels';
import { addDays, addPendingScan, addSignature, buildPaymentSchedule, contractNumber, originalReminderDue, verifyScan, type Side } from '@/shared/domain/contracts';
import { PERIODICITIES } from '@/shared/domain/endorsements';
import { contractPricing, pricingProblem } from '@/shared/domain/pricing';
import { clausesOf, DOC_TEMPLATES } from '@/features/documents/templates';
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
} from '@/shared/schemas/forms';
import { detectMime } from '@/shared/lib/image';
import { db, type ChangeRequestRow, type Db } from '../db';
import { API, audit, body, byLegalForm, byLegalName, conflict, type Ctx, filterLegalForm, forbidden, HttpError, httpErrorOf, notFound, param, q as searchTerm, requirePermission, requireSession, route, sortBy } from '../http';
import { randomId } from '../rng';
import { tzIso } from '../time';
import { toClient } from '../views';
import { parsePolicyList, toListRow } from '../policy-core';
import { personFor, personIdParam } from '../family-core';
import { dmsParam, numbering } from '../params';
import { assistanceName } from '../assistance-core';
import {
  afterSigning,
  clientRow,
  contractOf,
  createEndorsement,
  dealEvent,
  dealOf,
  endorsementLines,
  endorsementSummary,
  latestQuote,
  dealKp,
  moveDeal,
  pendingRequests,
  refreshContract,
  refreshInvoice,
  signatories,
  signatoryOption,
  toChangeRequest,
  todayIso,
} from '../lifecycle-core';

const SCAN_MAX_BYTES = 20 * 1024 * 1024;
type Kind = 'contract' | 'endorsement';

/** Documents HR sees: from the moment they are sent to the client. */
const HR_VISIBLE = new Set(['sent', 'signing', 'signed', 'active', 'terminated', 'expired']);

interface DocRef {
  kind: Kind;
  id: string;
  number: string;
  clientId: string;
  dealId?: string;
  contract: Contract;
  status: string;
  signing: Signing;
  clauseOverrides: ClauseOverride[];
  setStatus: (s: string) => void;
  setSigning: (s: Signing) => void;
}

function refOf(d: Db, kind: Kind, id: string): DocRef {
  if (kind === 'contract') {
    const c = contractOf(d, id);
    return {
      kind,
      id: c.id,
      number: c.number,
      clientId: c.clientId,
      dealId: c.dealId,
      contract: c,
      status: c.status,
      signing: c.signing,
      clauseOverrides: c.clauseOverrides,
      setStatus: (s) => (c.status = s as Contract['status']),
      setSigning: (s) => (c.signing = s),
    };
  }
  const e = d.endorsements.find((x) => x.id === id);
  if (!e) throw notFound();
  const c = contractOf(d, e.contractId);
  return {
    kind,
    id: e.id,
    number: e.number,
    clientId: c.clientId,
    dealId: c.dealId,
    contract: c,
    status: e.status,
    signing: e.signing,
    clauseOverrides: e.clauseOverrides,
    setStatus: (s) => (e.status = s as Endorsement['status']),
    setSigning: (s) => (e.signing = s),
  };
}

/** Staff with contracts.read, or HR of the client's company once the document was sent; anyone else 404/403. */
function readable(user: SessionUser, ref: DocRef): void {
  if (user.role === 'hr') {
    if (!can(user, 'contracts.read', { companyId: ref.clientId }) || !HR_VISIBLE.has(ref.status)) throw notFound();
    return;
  }
  if (!isStaffRole(user.role) || !can(user, 'contracts.read')) throw forbidden();
}

const signerForClient = (c: Contract) => c.params.clientSignatory.name;

function contractView(d: Db, c: Contract): ContractView {
  const client = clientRow(d, c.clientId);
  const q = c.quoteId ? d.quotes.find((x) => x.id === c.quoteId) : latestQuote(d, c.dealId);
  const signatory = d.staff.find((s) => s.id === c.params.migSignatoryId);
  return {
    ...c,
    client: toClient(d, client),
    dealNumber: d.deals.find((x) => x.id === c.dealId)?.number ?? '—',
    migSignatory: signatory ? signatoryOption(signatory) : null,
    signatories: signatories(d),
    insuredRows: (d.contractInsured.find((x) => x.contractId === c.id)?.rows ?? []).map((r) => ({ fullName: r.fullName, position: r.position, relation: r.relation })),
    invoices: d.invoices.filter((i) => i.contractId === c.id).map(refreshInvoice),
    payments: d.payments.filter((p) => p.contractId === c.id),
    endorsements: d.endorsements.filter((e) => e.contractId === c.id).map(endorsementSummary),
    quote: q ? { id: q.id, premiumEmployee: q.premiumEmployee, premiumFamily: q.premiumFamily, total: q.total, program: q.program } : null,
    originalOverdue: originalReminderDue(c.signing, Date.now(), dmsParam('paperOriginalReminderDays')),
    assistanceName: assistanceName(d, c.params.assistanceId ?? null) ?? undefined,
  };
}

function endorsementView(d: Db, e: Endorsement): EndorsementView {
  const c = contractOf(d, e.contractId);
  const client = clientRow(d, c.clientId);
  const signatory = d.staff.find((s) => s.id === c.params.migSignatoryId);
  return {
    ...e,
    contractNumber: c.number,
    clientId: client.id,
    clientName: client.name,
    clientLegalForm: client.legalForm,
    clientInn: client.inn,
    migSignatory: signatory ? signatoryOption(signatory) : null,
    clientSignatoryName: signerForClient(c),
    requests: d.changeRequests.filter((r) => e.changeRequestIds.includes(r.id)).map(toChangeRequest),
    needsAmountApproval: d.changeRequests.some((r) => e.changeRequestIds.includes(r.id) && r.type === 'other') && !e.amountsApprovedByName,
  };
}

/** The client's HR sees the document and its signing, not MIG's internal kitchen. */
function forViewer<T extends ContractView | EndorsementView>(user: SessionUser, v: T): T {
  if (user.role !== 'hr') return v;
  if ('signatories' in v) return { ...v, signatories: [], quote: null, versions: [], legalComment: undefined, financeDiffers: undefined, financeApprovedByName: undefined, legalApprovedByName: undefined, payments: [] };
  return { ...v, needsAmountApproval: false, amountsApprovedByName: undefined };
}

function viewOf(d: Db, ref: DocRef): ContractView | EndorsementView {
  return ref.kind === 'contract' ? contractView(d, ref.contract) : endorsementView(d, d.endorsements.find((x) => x.id === ref.id)!);
}

function overridesFrom(kind: Kind, input: { clauseId: string; text: string }[], previous: ClauseOverride[], user: SessionUser): ClauseOverride[] {
  const clauses = clausesOf(kind === 'contract' ? 'contract' : 'endorsement');
  return input.flatMap((o) => {
    const clause = clauses.find((c) => c.id === o.clauseId);
    if (!clause) throw new HttpError(422, 'validation', 'srv.contract.clauseNotFound', { params: { clause: o.clauseId } });
    if (o.text === clause.text) return [];
    const prev = previous.find((p) => p.clauseId === o.clauseId && p.text === o.text);
    return [prev ?? { clauseId: o.clauseId, original: clause.text, text: o.text, byId: user.id, byName: user.displayName, at: tzIso(Date.now()) }];
  });
}

export async function readScan(request: Request): Promise<{ side: Side; bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'application/pdf' }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'validation', 'srv.form.invalid');
  }
  const side = form.get('side');
  if (side !== 'mig' && side !== 'client') throw new HttpError(422, 'validation', 'srv.signing.sideRequired', { fields: { side: msg('srv.signing.sideHint') } });
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(422, 'validation', 'srv.signing.addScan', { fields: { file: msg('srv.signing.addFile') } });
  if (file.size === 0 || file.size > SCAN_MAX_BYTES) throw new HttpError(422, 'validation', 'srv.file.tooLarge20mb', { fields: { file: msg('srv.file.tooLarge20mb') } });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectMime(bytes);
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'application/pdf') throw new HttpError(422, 'validation', 'srv.file.onlyPdfJpegPng', { fields: { file: msg('srv.file.unsupported') } });
  return { side, bytes, mime };
}

/** An `age_banded` contract without a usable band table cannot go further (legal review, signing). */
function pricingGuard(c: Contract): void {
  const problem = pricingProblem(contractPricing(c.params));
  if (problem) throw httpErrorOf(422, 'validation', problem, { 'params.pricingBasis': problem });
}

/** Signing routes shared by contracts and endorsements (LIFECYCLE_SPEC §8: the same rules and methods). */
function signingRoutes(kind: Kind) {
  const base = `${API}/${kind === 'contract' ? 'contracts' : 'endorsements'}/:id`;
  const load = (ctx: Ctx) => {
    const { user } = requireSession(ctx.request);
    const d = db();
    const ref = refOf(d, kind, param(ctx, 'id'));
    readable(user, ref);
    return { user, d, ref };
  };
  const signable = (ref: DocRef, side: Side) => {
    if (kind === 'contract') pricingGuard(ref.contract);
    const ok = side === 'mig' ? ['approved', 'sent', 'signing'] : ['sent', 'signing'];
    if (!ok.includes(ref.status)) throw conflict(side === 'client' ? 'srv.doc.notSentToClient' : 'srv.doc.notApproved');
    if (ref.signing[side]) throw conflict(side === 'mig' ? 'srv.doc.migSigned' : 'srv.doc.clientSigned');
  };
  const done = async (d: Db, ref: DocRef, user: SessionUser, side: Side, how: string) => {
    audit(user, 'contract_signed', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: `${ref.number}: ${side === 'mig' ? 'МИГ' : 'клиент'}, ${how}` });
    if (ref.dealId && kind === 'contract') dealEvent(d, ref.dealId, user.displayName, `${ref.number}: подпись ${side === 'mig' ? 'МИГ' : 'клиента'} (${how})`);
    await afterSigning(d, kind, ref.id, user.displayName);
  };
  return [
    http.post(
      `${base}/sign`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        const input = await body(ctx.request, signSchema);
        if (input.side === 'mig') {
          // Only a MIG employee who is a signatory (StaffUser.signatory) signs for MIG.
          if (!can(user, 'contracts.sign_mig')) throw new HttpError(403, 'forbidden', 'srv.signing.signatoryOnly');
        } else if (!can(user, 'contracts.sign_client', { companyId: ref.clientId })) {
          throw user.role === 'hr' ? notFound() : new HttpError(403, 'forbidden', 'srv.signing.clientInPortal');
        }
        signable(ref, input.side);
        const at = tzIso(Date.now());
        const sig =
          input.method === 'eimzo'
            ? { method: 'eimzo' as const, signedAt: at, signerName: user.displayName, certificate: { serial: input.certificateSerial, owner: user.displayName, validTo: addDays(todayIso(), 365) } }
            : { method: 'paper' as const, signedAt: at, signerName: user.displayName };
        ref.setSigning({ ...addSignature(ref.signing, input.side, sig), ...(input.method === 'paper' ? { printedAt: at } : {}) });
        await done(d, ref, user, input.side, input.method === 'eimzo' ? 'ЭЦП' : 'бумага');
        return forViewer(user, viewOf(d, refOf(d, kind, ref.id)));
      }),
    ),
    http.post(
      `${base}/edo`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        if (!can(user, 'contracts.sign_mig')) throw new HttpError(403, 'forbidden', 'srv.signing.edoSignatoryOnly');
        const { provider } = await body(ctx.request, edoSendSchema);
        if (ref.signing.client) throw conflict('srv.doc.clientSigned');
        if (!['approved', 'sent', 'signing'].includes(ref.status)) throw conflict('srv.doc.notApproved');
        const at = tzIso(Date.now());
        let s = ref.signing;
        if (!s.mig) s = addSignature(s, 'mig', { method: 'edo', signedAt: at, signerName: user.displayName, edoProvider: provider, certificate: { serial: 'C0FFEE01', owner: user.displayName, validTo: addDays(todayIso(), 365) } });
        ref.setSigning({ ...s, edoPending: { provider, sentAt: at } });
        if (ref.status === 'approved') ref.setStatus('sent');
        await done(d, ref, user, 'mig', `ЭДО ${provider}`);
        return forViewer(user, viewOf(d, refOf(d, kind, ref.id)));
      }),
    ),
    http.post(
      `${base}/scan`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        const { side, bytes, mime } = await readScan(ctx.request);
        // HR uploads the client's scan in its cabinet; MIG staff who handle documents upload either side.
        if (user.role === 'hr') {
          if (side !== 'client' || !can(user, 'contracts.sign_client', { companyId: ref.clientId })) throw forbidden();
        } else if (!can(user, 'contracts.verify_scan') && !can(user, 'contracts.draft')) throw forbidden();
        signable(ref, side);
        const fileId = randomId();
        d.files.push({ id: fileId, mime, bytes, clientId: ref.clientId, ...(kind === 'contract' ? { contractId: ref.id } : { endorsementId: ref.id }), fileName: `scan-${side}.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}` });
        ref.setSigning(addPendingScan(ref.signing, side, fileId, tzIso(Date.now()), user.displayName));
        if (ref.status === 'sent') ref.setStatus('signing');
        audit(user, 'contract_scan_uploaded', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: `${ref.number}: скан ${side === 'mig' ? 'МИГ' : 'клиента'}` });
        if (ref.dealId && kind === 'contract') dealEvent(d, ref.dealId, user.displayName, `${ref.number}: загружен скан подписи ${side === 'mig' ? 'МИГ' : 'клиента'}, ждёт проверки`);
        if (kind === 'contract') moveDeal(d, ref.dealId, 'signing', user.displayName);
        return forViewer(user, viewOf(d, refOf(d, kind, ref.id)));
      }),
    ),
    http.post(
      `${base}/scan/verify`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        requirePermission(user, 'contracts.verify_scan');
        const { side } = await body(ctx.request, scanVerifySchema);
        if (!ref.signing.pendingScans?.some((p) => p.side === side)) throw conflict('srv.signing.noScanPending');
        const signer = side === 'client' ? signerForClient(ref.contract) : (d.staff.find((s) => s.id === ref.contract.params.migSignatoryId)?.fullName ?? user.displayName);
        ref.setSigning(verifyScan(ref.signing, side, { id: user.id, name: user.displayName }, tzIso(Date.now()), signer));
        audit(user, 'contract_scan_verified', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: `${ref.number}: скан ${side === 'mig' ? 'МИГ' : 'клиента'}` });
        await done(d, ref, user, side, 'скан проверен');
        return forViewer(user, viewOf(d, refOf(d, kind, ref.id)));
      }),
    ),
    http.post(
      `${base}/originals`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        requirePermission(user, 'contracts.originals');
        const input = await body(ctx.request, originalsSchema);
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
          if (!s.client) next = addSignature(next, 'client', { method: 'paper', signedAt: tzIso(Date.now()), signerName: signerForClient(ref.contract) });
        }
        ref.setSigning(next);
        audit(user, 'contract_original', {
          targetType: kind === 'contract' ? 'contract' : 'endorsement',
          targetId: ref.id,
          targetLabel: `${ref.number}: ${input.clientOriginalReceivedAt ? 'оригинал клиента получен' : 'экземпляр МИГ отправлен клиенту'}`,
        });
        if (input.clientOriginalReceivedAt && !s.client) await done(d, ref, user, 'client', 'бумага');
        return forViewer(user, viewOf(d, refOf(d, kind, ref.id)));
      }),
    ),
    // ---- legal approval: needed only when a clause was changed ----
    http.post(
      `${base}/submit-legal`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        if (!can(user, kind === 'contract' ? 'contracts.draft' : 'endorsements.manage')) throw forbidden();
        if (ref.status !== 'draft') throw conflict('srv.doc.reviewDraftOnly');
        if (kind === 'contract' && ref.contract.financeDiffers && !ref.contract.financeApprovedByName) throw conflict('srv.contract.financeNeedsApproval');
        if (kind === 'contract') pricingGuard(ref.contract);
        if (kind === 'endorsement') {
          const e = d.endorsements.find((x) => x.id === ref.id)!;
          if (endorsementView(d, e).needsAmountApproval) throw conflict('srv.endorsement.amountNeedsApproval');
        }
        const changed = ref.clauseOverrides.length > 0;
        ref.setStatus(changed ? 'legal_review' : 'approved');
        audit(user, 'contract_legal_submitted', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: `${ref.number}: ${changed ? `изменено пунктов ${ref.clauseOverrides.length}` : 'без изменений пунктов'}` });
        if (kind === 'contract') {
          moveDeal(d, ref.dealId, 'contract_review', user.displayName, changed ? `Договор ${ref.number} у юриста: изменено пунктов ${ref.clauseOverrides.length}` : `Договор ${ref.number} без изменённых пунктов — согласование юриста не требуется`);
          ref.contract.versions.push({ version: ref.contract.version, at: tzIso(Date.now()), byName: user.displayName, changes: changed ? 'Отправлен юристу' : 'Согласован без юриста (пункты не менялись)' });
        }
        return forViewer(user, viewOf(d, refOf(d, kind, ref.id)));
      }),
    ),
    http.post(
      `${base}/legal-approve`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        requirePermission(user, 'contracts.legal_approve');
        if (ref.status !== 'legal_review') throw conflict('srv.doc.notInReview');
        const { comment } = await body(ctx.request, legalApproveSchema);
        ref.setStatus('approved');
        if (kind === 'contract') {
          ref.contract.legalApprovedByName = user.displayName;
          ref.contract.legalComment = undefined;
          ref.contract.versions.push({ version: ref.contract.version, at: tzIso(Date.now()), byName: user.displayName, changes: `Юрист согласовал${comment ? `: ${comment}` : ''}` });
          if (ref.dealId) dealEvent(d, ref.dealId, user.displayName, `Юрист согласовал договор ${ref.number}`);
        }
        audit(user, 'contract_legal_approved', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: ref.number, reason: comment });
        return forViewer(user, viewOf(d, refOf(d, kind, ref.id)));
      }),
    ),
    http.post(
      `${base}/legal-return`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        requirePermission(user, 'contracts.legal_approve');
        if (ref.status !== 'legal_review') throw conflict('srv.doc.notInReview');
        const { comment } = await body(ctx.request, legalReturnSchema);
        ref.setStatus('draft');
        if (kind === 'contract') {
          ref.contract.legalComment = comment;
          ref.contract.versions.push({ version: ref.contract.version, at: tzIso(Date.now()), byName: user.displayName, changes: `Юрист вернул: ${comment}` });
          if (ref.dealId) dealEvent(d, ref.dealId, user.displayName, `Юрист вернул договор ${ref.number}: ${comment}`);
        }
        audit(user, 'contract_legal_returned', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: ref.number, reason: comment });
        return forViewer(user, viewOf(d, refOf(d, kind, ref.id)));
      }),
    ),
    http.post(
      `${base}/send`,
      route((ctx) => {
        const { user, d, ref } = load(ctx);
        if (!can(user, kind === 'contract' ? 'contracts.draft' : 'endorsements.manage')) throw forbidden();
        if (ref.status !== 'approved') throw conflict('srv.doc.sendApprovedOnly');
        ref.setStatus(ref.signing.mig || ref.signing.client ? 'signing' : 'sent');
        audit(user, 'contract_sent', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: ref.number });
        if (kind === 'contract') {
          moveDeal(d, ref.dealId, 'contract_sent', user.displayName, `Договор ${ref.number} отправлен клиенту`);
          ref.contract.versions.push({ version: ref.contract.version, at: tzIso(Date.now()), byName: user.displayName, changes: 'Отправлен клиенту' });
        }
        return forViewer(user, viewOf(d, refOf(d, kind, ref.id)));
      }),
    ),
  ];
}

function invoiceView(d: Db, i: ReturnType<typeof refreshInvoice>): InvoiceView {
  const client = d.clients.find((c) => c.id === i.clientId);
  return {
    ...i,
    clientName: client?.name ?? '—',
    clientLegalForm: client?.legalForm,
    clientInn: client?.inn,
    contractNumber: i.contractId ? d.contracts.find((c) => c.id === i.contractId)?.number : undefined,
    endorsementNumber: i.endorsementId ? d.endorsements.find((e) => e.id === i.endorsementId)?.number : undefined,
  };
}

async function recordPayment(
  d: Db,
  user: SessionUser,
  invoiceId: string,
  amount: number,
  paidAt: string,
  payerInn: string,
  purpose: string,
  source: Payment['source'],
  extra: Pick<Payment, 'matchedBy' | 'bankPaymentId' | 'docNumber' | 'comment'> = {},
): Promise<Payment> {
  const inv = d.invoices.find((i) => i.id === invoiceId);
  if (!inv) throw notFound();
  const p: Payment = { id: randomId(), invoiceId: inv.id, contractId: inv.contractId, amount, paidAt, payerInn, purpose, source, recordedByName: user.displayName, ...extra };
  d.payments.unshift(p);
  inv.paid = (inv.paid ?? 0) + amount;
  refreshInvoice(inv);
  const c = inv.contractId ? d.contracts.find((x) => x.id === inv.contractId) : undefined;
  if (c) {
    if (c.dealId) dealEvent(d, c.dealId, user.displayName, `Оплата ${amount} по счёту ${inv.number}${inv.status === 'paid' ? ' (оплачен)' : ' (частично)'}`);
    await refreshContract(d, c);
  }
  return p;
}

/** Contract invoices with the client's INN, as the matching rules see them. */
function openInvoices(d: Db): OpenInvoice[] {
  return d.invoices
    .filter((i) => i.contractId)
    .map((i) => ({ id: i.id, number: i.number, clientId: i.clientId, clientInn: d.clients.find((c) => c.id === i.clientId)?.inn ?? '', amount: i.amount, paid: i.paid ?? 0, dueDate: i.dueDate }));
}

/** A queued payment with fresh candidates for what is left of it. */
function bankPaymentView(d: Db, b: BankPayment): BankPaymentView {
  const remaining = b.amount - b.allocated;
  const all = openInvoices(d);
  const m = b.status === 'pending' ? matchPayment({ amount: remaining, payerInn: b.payerInn, purpose: b.purpose }, all) : undefined;
  // A queued payment is never allocated automatically: an exact match found later is offered as a candidate.
  const cands = !m ? [] : m.kind === 'manual' ? m.candidates : [{ invoiceId: m.invoiceId, why: m.by }];
  // The payer as known by its INN (a client), else as written in the statement.
  const payer = d.clients.find((c) => c.inn === b.payerInn);
  return {
    ...b,
    ...(payer ? { payerName: payer.name, payerLegalForm: payer.legalForm } : {}),
    remaining,
    candidates: cands.flatMap((c) => {
      const inv = all.find((i) => i.id === c.invoiceId);
      const row = d.invoices.find((i) => i.id === c.invoiceId);
      if (!inv || !row) return [];
      const view = invoiceView(d, row);
      return [{ invoiceId: inv.id, number: inv.number, clientName: view.clientName, clientLegalForm: view.clientLegalForm, clientInn: inv.clientInn, contractNumber: view.endorsementNumber ?? view.contractNumber, remaining: remainingOf(inv), dueDate: inv.dueDate, why: c.why }];
    }),
  };
}

function certificates(d: Db, policyId: string): CertificateView[] {
  const p = d.policies.find((x) => x.id === policyId);
  if (!p) throw notFound();
  const c = p.contractId ? d.contracts.find((x) => x.id === p.contractId) : undefined;
  const a = d.assistances.find((x) => x.id === p.assistanceId);
  const client = d.clients.find((x) => x.id === p.clientId);
  return d.insured
    .filter((i) => i.policyId === p.id && i.status === 'active' && i.certificateNumber)
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

function changeRequestView(d: Db, r: ChangeRequestRow): ChangeRequestView {
  const c = d.contracts.find((x) => x.id === r.contractId)!;
  const client = d.clients.find((x) => x.id === c.clientId);
  return {
    ...toChangeRequest(r),
    contractNumber: c.number,
    clientName: client?.name ?? '—',
    clientLegalForm: client?.legalForm,
    endorsementNumber: r.endorsementId ? d.endorsements.find((e) => e.id === r.endorsementId)?.number : undefined,
  };
}

export const contractHandlers = [
  // ---------------- contracts ----------------
  http.get(
    `${API}/contracts`,
    route(async ({ request, url }) => {
      const { user } = requireSession(request);
      const d = db();
      for (const c of d.contracts) await refreshContract(d, c);
      let list = d.contracts;
      if (user.role === 'hr') {
        if (!user.companyId) throw forbidden();
        list = list.filter((c) => c.clientId === user.companyId && HR_VISIBLE.has(c.status));
      } else if (!isStaffRole(user.role) || !can(user, 'contracts.read')) throw forbidden();
      const status = url.searchParams.get('status');
      if (status) list = list.filter((c) => status.split(',').includes(c.status));
      const clientId = url.searchParams.get('clientId');
      if (clientId) list = list.filter((c) => c.clientId === clientId);
      // `?q=`: the new number, the number in the previous system (transferred contracts) or the client.
      const term = searchTerm(url);
      if (term) list = list.filter((c) => c.number.toLowerCase().includes(term) || (c.externalNumber ?? '').toLowerCase().includes(term) || c.clientName.toLowerCase().includes(term));
      const views = filterLegalForm(
        list.map((c) => forViewer(user, contractView(d, c))),
        url,
        (c) => c.client.legalForm,
      );
      return sortBy(views, url, {
        number: (c) => c.number,
        clientName: byLegalName((c) => c.client.name),
        legalForm: byLegalForm((c) => c.client.legalForm),
        status: (c) => c.status,
        startDate: (c) => c.params.startDate,
        total: (c) => c.params.total,
      });
    }),
  ),
  http.get(
    `${API}/contracts/:id`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      const d = db();
      const ref = refOf(d, 'contract', param(ctx, 'id'));
      readable(user, ref);
      await refreshContract(d, ref.contract);
      return forViewer(user, contractView(d, ref.contract));
    }),
  ),
  http.post(
    `${API}/contracts`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'contracts.draft');
      const { dealId } = await body(request, contractCreateSchema);
      const d = db();
      const deal = dealOf(d, dealId);
      const kp = dealKp(d, deal.id);
      if (!kp || kp.status !== 'accepted') throw conflict('srv.contract.needsAcceptedKp');
      const existing = d.contracts.find((c) => c.dealId === deal.id);
      if (existing) throw conflict('srv.contract.alreadyExists');
      const client = clientRow(d, deal.clientId);
      const q = kp.quoteId ? d.quotes.find((x) => x.id === kp.quoteId) : latestQuote(d, deal.id);
      const signatory = d.staff.find((s) => s.active && s.signatory?.canSign);
      if (!signatory) throw conflict('srv.contract.noSignatory');
      d.contractSeq += 1;
      const total = kp.params.premiumEmployee * kp.params.employees + kp.params.premiumFamily * kp.params.familyMembers;
      const at = tzIso(Date.now());
      const c: Contract = {
        id: randomId(),
        number: contractNumber(new Date().getFullYear(), d.contractSeq, numbering()),
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
          ...(q?.ageBandRates.length ? { ageBandRates: q.ageBandRates.map((r) => ({ ...r })) } : {}),
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
      d.contracts.unshift(c);
      moveDeal(d, deal.id, 'contract_draft', user.displayName, `Подготовлен договор ${c.number}`);
      audit(user, 'contract_created', { targetType: 'contract', targetId: c.id, targetLabel: c.number });
      return HttpResponse.json(contractView(d, c), { status: 201 });
    }),
  ),
  http.patch(
    `${API}/contracts/:id`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'contracts.draft');
      const d = db();
      const c = contractOf(d, param(ctx, 'id'));
      if (c.status !== 'draft') throw conflict('srv.contract.draftOnly');
      const input = await body(ctx.request, contractPatchSchema);
      const changes: string[] = [];
      if (input.params) {
        const p = { ...c.params, ...input.params };
        if (p.endDate <= p.startDate) throw new HttpError(422, 'validation', 'srv.contract.endAfterStart', { fields: { 'params.endDate': msg('srv.contract.afterStart') } });
        const signatory = d.staff.find((s) => s.id === p.migSignatoryId);
        if (!signatory?.signatory?.canSign) throw new HttpError(422, 'validation', 'srv.contract.chooseSignatory', { fields: { 'params.migSignatoryId': msg('srv.contract.notSignatory') } });
        const pricing = pricingProblem(contractPricing(p));
        if (pricing) throw httpErrorOf(422, 'validation', pricing, { 'params.pricingBasis': pricing });
        p.total = p.premiumEmployee * p.employees + p.premiumFamily * p.familyMembers;
        if (input.params.paymentSchedule) {
          const sum = input.params.paymentSchedule.reduce((s, x) => s + x.amount, 0);
          if (sum !== p.total) throw new HttpError(422, 'validation', 'srv.contract.scheduleSum', { fields: { 'params.paymentSchedule': msg('srv.contract.scheduleSumHint', { sum, total: p.total }) } });
        } else p.paymentSchedule = buildPaymentSchedule(p.total, p.startDate, p.paymentFrequency);
        for (const k of Object.keys(input.params) as (keyof typeof input.params)[]) if (JSON.stringify(c.params[k]) !== JSON.stringify(p[k])) changes.push(k);
        c.params = p;
        const q = c.quoteId ? d.quotes.find((x) => x.id === c.quoteId) : undefined;
        const differs = !!q && (q.premiumEmployee !== p.premiumEmployee || q.premiumFamily !== p.premiumFamily);
        if (differs !== !!c.financeDiffers || (differs && changes.some((x) => x.startsWith('premium')))) c.financeApprovedByName = undefined;
        c.financeDiffers = differs;
      }
      if (input.clauseOverrides) {
        const next = overridesFrom('contract', input.clauseOverrides, c.clauseOverrides, user);
        const before = new Set(c.clauseOverrides.map((o) => `${o.clauseId}:${o.text}`));
        const changedClauses = next.filter((o) => !before.has(`${o.clauseId}:${o.text}`)).map((o) => o.clauseId);
        const removed = c.clauseOverrides.filter((o) => !next.some((n) => n.clauseId === o.clauseId)).map((o) => o.clauseId);
        if (changedClauses.length) changes.push(`изменены пункты ${changedClauses.join(', ')}`);
        if (removed.length) changes.push(`возвращён исходный текст пунктов ${removed.join(', ')}`);
        c.clauseOverrides = next;
      }
      if (changes.length) {
        c.versions.push({ version: c.version, at: tzIso(Date.now()), byName: user.displayName, changes: changes.join('; ') });
        audit(user, 'contract_updated', { targetType: 'contract', targetId: c.id, targetLabel: `${c.number}: ${changes.join('; ')}`.slice(0, 200) });
      }
      return contractView(d, c);
    }),
  ),
  http.post(
    `${API}/contracts/:id/finance-approve`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'quotes.calculate');
      const d = db();
      const c = contractOf(d, param(ctx, 'id'));
      if (!c.financeDiffers) throw conflict('srv.contract.financeSame');
      c.financeApprovedByName = user.displayName;
      c.versions.push({ version: c.version, at: tzIso(Date.now()), byName: user.displayName, changes: 'Андеррайтер утвердил финансовые условия' });
      audit(user, 'contract_finance_approved', { targetType: 'contract', targetId: c.id, targetLabel: c.number });
      return contractView(d, c);
    }),
  ),
  http.post(
    `${API}/contracts/:id/new-version`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'contracts.draft');
      const d = db();
      const c = contractOf(d, param(ctx, 'id'));
      if (!['sent', 'signing', 'approved'].includes(c.status)) throw conflict('srv.contract.newVersionState');
      c.version += 1;
      c.status = 'draft';
      c.signing = { paperOriginal: { required: false } };
      c.legalApprovedByName = undefined;
      c.versions.push({ version: c.version, at: tzIso(Date.now()), byName: user.displayName, changes: `Новая версия ${c.version}: подписи предыдущей версии сброшены` });
      moveDeal(d, c.dealId, 'contract_draft', user.displayName, `Договор ${c.number}: новая версия ${c.version}`);
      audit(user, 'contract_updated', { targetType: 'contract', targetId: c.id, targetLabel: `${c.number}: версия ${c.version}` });
      return contractView(d, c);
    }),
  ),
  http.post(
    `${API}/contracts/:id/insured-list`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      const d = db();
      const c = contractOf(d, param(ctx, 'id'));
      if (user.role === 'hr') {
        if (!can(user, 'contracts.sign_client', { companyId: c.clientId }) || !HR_VISIBLE.has(c.status)) throw notFound();
      } else requirePermission(user, 'contracts.draft');
      if (c.status === 'active' || c.status === 'signed' || c.status === 'terminated' || c.status === 'expired') throw conflict('srv.contract.listViaEndorsement');
      const parsed = parsePolicyList(await ctx.request.text());
      if (parsed.errors.length)
        throw new HttpError(422, 'validation', 'srv.census.fileErrors', {
          params: { count: parsed.errors.length, details: parsed.errors.slice(0, 3).map((e) => t('srv.census.rowError', { row: e.row, message: tm(e.message) })).join('; ') },
        });
      // Appendix 2: a row per person, family members with the relation and the employee's PINFL (FAMILY_SPEC).
      const rows = parsed.rows.map(toListRow);
      d.contractInsured = [...d.contractInsured.filter((x) => x.contractId !== c.id), { contractId: c.id, rows }];
      c.insuredListId = c.id;
      c.insuredCount = rows.length;
      c.versions.push({ version: c.version, at: tzIso(Date.now()), byName: user.displayName, changes: `Загружено приложение 2: ${rows.length} застрахованных` });
      return forViewer(user, contractView(d, c));
    }),
  ),
  http.post(
    `${API}/contracts/:id/terminate`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'endorsements.manage');
      if (user.role === 'hr') throw forbidden();
      const d = db();
      const c = contractOf(d, param(ctx, 'id'));
      const { date, reason } = await body(ctx.request, terminateSchema);
      if (date < c.params.startDate || date > c.params.endDate) throw new HttpError(422, 'validation', 'srv.contract.dateWithinTerm', { fields: { date: msg('srv.contract.withinTerm') } });
      if (d.endorsements.some((e) => e.contractId === c.id && e.kind === 'termination' && e.status !== 'signed')) throw conflict('srv.contract.terminationPending');
      const e = createEndorsement(d, c, [], 'termination', date);
      if (c.dealId) dealEvent(d, c.dealId, user.displayName, `Подготовлено соглашение о расторжении ${e.number}: ${reason}`);
      audit(user, 'endorsement_created', { targetType: 'endorsement', targetId: e.id, targetLabel: `${e.number}: расторжение`, reason });
      return HttpResponse.json(endorsementView(d, e), { status: 201 });
    }),
  ),
  ...signingRoutes('contract'),

  // ---------------- invoices and payments (§9) ----------------
  http.get(
    `${API}/invoices`,
    route(async ({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'invoices.read');
      if (user.role === 'hr') throw forbidden();
      const d = db();
      let list = d.invoices.filter((i) => i.contractId).map(refreshInvoice);
      const contractId = url.searchParams.get('contractId');
      if (contractId) list = list.filter((i) => i.contractId === contractId);
      const status = url.searchParams.get('status');
      if (status) list = list.filter((i) => status.split(',').includes(i.status));
      const views = filterLegalForm(
        list.map((i) => invoiceView(d, i)),
        url,
        (i) => i.clientLegalForm,
      );
      return sortBy(views, url, {
        number: (i) => i.number,
        clientName: byLegalName((i) => i.clientName),
        legalForm: byLegalForm((i) => i.clientLegalForm),
        amount: (i) => i.amount,
        dueDate: (i) => i.dueDate,
        status: (i) => i.status,
      });
    }),
  ),
  http.post(
    `${API}/payments`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'payments.record');
      const input = await body(request, paymentSchema);
      const d = db();
      const inv = d.invoices.find((i) => i.id === input.invoiceId);
      if (!inv) throw notFound();
      if (input.amount > inv.amount - (inv.paid ?? 0)) throw new HttpError(422, 'validation', 'srv.invoice.overRemaining', { fields: { amount: msg('srv.invoice.remaining', { amount: inv.amount - (inv.paid ?? 0) }) } });
      const client = d.clients.find((c) => c.id === inv.clientId);
      const p = await recordPayment(d, user, inv.id, input.amount, input.paidAt, client?.inn ?? '', input.purpose ?? `Оплата по счёту ${inv.number}`, 'manual');
      audit(user, 'payment_recorded', { targetType: 'invoice', targetId: inv.id, targetLabel: `${inv.number}: ${input.amount}` });
      return HttpResponse.json(p, { status: 201 });
    }),
  ),
  http.post(
    `${API}/payments/import-1c`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'payments.record');
      const text = await request.text();
      if (text.length > 1024 * 1024) throw new HttpError(413, 'validation', 'srv.file.tooLarge1mb');
      const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true });
      const fields = parsed.meta.fields ?? [];
      const missing = ['doc_number', 'date', 'amount', 'inn', 'purpose'].filter((f) => !fields.includes(f));
      if (missing.length) throw new HttpError(422, 'validation', 'srv.statement.missingColumns', { params: { columns: missing.join(', ') } });
      if (parsed.data.length > 5000) throw new HttpError(422, 'validation', 'srv.statement.over5000Rows');
      const d = db();
      const out: ImportPaymentsResult = { matched: 0, queued: 0, skipped: 0, unmatched: [], activated: 0 };
      const seen = new Set(d.statementKeys);
      const activeBefore = d.contracts.filter((c) => c.status === 'active').length;
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
        if (seen.has(key)) {
          out.skipped += 1;
          continue;
        }
        seen.add(key);
        d.statementKeys.push(key);
        const purpose = (row.purpose ?? '').trim().slice(0, 300);
        // Matching runs line by line on the current state: an earlier line of the same statement may pay an invoice off.
        const m = matchPayment({ amount, payerInn: inn, purpose }, openInvoices(d));
        if (m.kind === 'matched') {
          await recordPayment(d, user, m.invoiceId, amount, date, inn, purpose, '1c', { matchedBy: m.by, docNumber });
          out.matched += 1;
          continue;
        }
        const payerName = (row.payer ?? '').trim().slice(0, 200) || undefined;
        d.bankPayments.unshift({ id: randomId(), docNumber, date, amount, payerInn: inn, payerName, purpose, reason: m.reason, importedAt: tzIso(Date.now()), importedByName: user.displayName, allocated: 0, status: 'pending', allocations: [] });
        out.queued += 1;
      }
      out.activated = d.contracts.filter((c) => c.status === 'active').length - activeBefore;
      audit(user, 'payments_imported', { targetType: 'invoice', targetLabel: `Выписка 1С: сопоставлено ${out.matched}, в ручную разноску ${out.queued}, пропущено как повтор ${out.skipped}, ошибок ${out.unmatched.length}` });
      return out;
    }),
  ),
  http.get(
    `${API}/payments/queue`,
    route(async ({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'payments.record');
      const d = db();
      const status = url.searchParams.get('status') === 'allocated' ? 'allocated' : 'pending';
      const views = filterLegalForm(
        d.bankPayments.filter((b) => b.status === status).map((b) => bankPaymentView(d, b)),
        url,
        (b) => b.payerLegalForm,
      );
      return sortBy(views, url, {
        date: (b) => b.date,
        payerName: byLegalName((b) => b.payerName ?? b.payerInn),
        legalForm: byLegalForm((b) => b.payerLegalForm),
        amount: (b) => b.amount,
        remaining: (b) => b.remaining,
      });
    }),
  ),
  http.post(
    `${API}/payments/queue/:id/allocate`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'payments.record');
      const d = db();
      const b = d.bankPayments.find((x) => x.id === param(ctx, 'id'));
      if (!b) throw notFound();
      if (b.status !== 'pending') throw conflict('srv.payment.alreadyMatched');
      const input = await body(ctx.request, paymentAllocationSchema);
      if (new Set(input.lines.map((l) => l.invoiceId)).size !== input.lines.length) throw new HttpError(422, 'validation', 'srv.payment.invoiceTwice');
      const all = openInvoices(d);
      const lines = input.lines.map((l) => {
        const invoice = all.find((i) => i.id === l.invoiceId);
        if (!invoice) throw notFound();
        return { invoice, amount: l.amount };
      });
      const error = checkAllocation(b, lines, input.comment);
      if (error) {
        // The comment is the last check: with a long enough comment the allocation passes.
        const aboutComment = checkAllocation(b, lines, 'comment') === null;
        throw httpErrorOf(422, 'validation', error, aboutComment ? { comment: error } : undefined);
      }
      const comment = input.comment || undefined;
      for (const l of lines) {
        await recordPayment(d, user, l.invoice.id, l.amount, b.date, b.payerInn, b.purpose, '1c', { matchedBy: 'manual', bankPaymentId: b.id, docNumber: b.docNumber, comment });
        b.allocations.push({ invoiceId: l.invoice.id, invoiceNumber: l.invoice.number, amount: l.amount, at: tzIso(Date.now()), byName: user.displayName, comment });
        b.allocated += l.amount;
        const foreign = l.invoice.clientInn !== b.payerInn;
        audit(user, 'payment_allocated', { targetType: 'invoice', targetId: l.invoice.id, targetLabel: `${l.invoice.number}: ${l.amount}${foreign ? ' (плательщик — третье лицо)' : ''}`, reason: comment });
      }
      if (b.allocated >= b.amount) b.status = 'allocated';
      return bankPaymentView(d, b);
    }),
  ),

  // ---------------- certificates (§10) ----------------
  http.get(
    `${API}/policies/:id/certificates`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      const d = db();
      const p = d.policies.find((x) => x.id === param(ctx, 'id'));
      if (!p) throw notFound();
      if (user.role === 'hr') {
        if (!can(user, 'contracts.read', { companyId: p.clientId })) throw notFound();
      } else if (!isStaffRole(user.role) || !can(user, 'contracts.read')) throw forbidden();
      return certificates(d, p.id);
    }),
  ),
  http.get(
    `${API}/me/certificate`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      if (user.role !== 'insured' || !user.insuredId) throw forbidden();
      const d = db();
      const viewer = d.insured.find((i) => i.id === user.insuredId);
      if (!viewer) throw notFound();
      // `?personId=`: a person of the family whose certificate the signed-in person may see (FAMILY_SPEC).
      const me = personFor(d, viewer, personIdParam(url), 'card').person;
      if (!me.certificateNumber) throw notFound();
      return certificates(d, me.policyId).find((c) => c.insuredId === me.id) ?? null;
    }),
  ),

  // ---------------- change requests and endorsements (§11) ----------------
  http.get(
    `${API}/change-requests`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      const d = db();
      let list = d.changeRequests;
      if (user.role === 'hr') {
        if (!can(user, 'endorsements.manage', { companyId: user.companyId })) throw forbidden();
        const ids = new Set(d.contracts.filter((c) => c.clientId === user.companyId).map((c) => c.id));
        list = list.filter((r) => ids.has(r.contractId));
      } else if (!isStaffRole(user.role) || !can(user, 'contracts.read')) throw forbidden();
      const contractId = url.searchParams.get('contractId');
      if (contractId) list = list.filter((r) => r.contractId === contractId);
      const status = url.searchParams.get('status');
      if (status) list = list.filter((r) => status.split(',').includes(r.status));
      return filterLegalForm(
        list.map((r) => changeRequestView(d, r)),
        url,
        (r) => r.clientLegalForm,
      );
    }),
  ),
  http.post(
    `${API}/change-requests`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'endorsements.manage');
      if (user.role === 'hr') throw forbidden();
      const input = await body(request, changeRequestCreateSchema);
      const d = db();
      const c = contractOf(d, input.contractId);
      if (c.status !== 'active') throw conflict('srv.endorsement.activeOnly');
      if (input.effectiveDate < c.params.startDate || input.effectiveDate > c.params.endDate) throw new HttpError(422, 'validation', 'srv.contract.dateWithinTerm', { fields: { effectiveDate: msg('srv.contract.withinTerm') } });
      if (input.type === 'change_program' && (!input.program || input.program === c.params.program)) throw new HttpError(422, 'validation', 'srv.endorsement.otherProgram', { fields: { program: msg('srv.endorsement.otherProgram') } });
      if (input.type === 'other' && (input.amount === undefined || !input.description)) throw new HttpError(422, 'validation', 'srv.endorsement.describeAndAmount', { fields: { description: msg('srv.endorsement.describe') } });
      const r: ChangeRequestRow = {
        id: randomId(),
        contractId: c.id,
        type: input.type,
        effectiveDate: input.effectiveDate,
        payload: input.type === 'change_program' ? { program: input.program, fromProgram: c.params.program } : { amount: input.amount, description: input.description },
        requestedBy: { id: user.id, role: user.role, name: user.displayName },
        status: 'pending',
        createdAt: tzIso(Date.now()),
        description: input.type === 'change_program' ? `Смена программы с ${input.effectiveDate.split('-').reverse().join('.')}` : input.description,
      };
      d.changeRequests.unshift(r);
      audit(user, 'change_request_created', { targetType: 'contract', targetId: c.id, targetLabel: `${c.number}: ${r.description ?? r.type}` });
      return HttpResponse.json(changeRequestView(d, r), { status: 201 });
    }),
  ),
  http.get(
    `${API}/endorsements`,
    route(async ({ request, url }) => {
      const { user } = requireSession(request);
      const d = db();
      for (const c of d.contracts) await refreshContract(d, c);
      let list = d.endorsements;
      if (user.role === 'hr') {
        const ids = new Set(d.contracts.filter((c) => c.clientId === user.companyId).map((c) => c.id));
        list = list.filter((e) => ids.has(e.contractId) && HR_VISIBLE.has(e.status));
      } else if (!isStaffRole(user.role) || !can(user, 'contracts.read')) throw forbidden();
      const contractId = url.searchParams.get('contractId');
      if (contractId) list = list.filter((e) => e.contractId === contractId);
      const views = filterLegalForm(
        list.map((e) => forViewer(user, endorsementView(d, e))),
        url,
        (e) => e.clientLegalForm,
      );
      return sortBy(views, url, {
        number: (e) => e.number,
        clientName: byLegalName((e) => e.clientName),
        legalForm: byLegalForm((e) => e.clientLegalForm),
        total: (e) => e.total,
        status: (e) => e.status,
        createdAt: (e) => e.createdAt,
      });
    }),
  ),
  http.get(
    `${API}/endorsements/:id`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      const d = db();
      const ref = refOf(d, 'endorsement', param(ctx, 'id'));
      readable(user, ref);
      await refreshContract(d, ref.contract);
      return forViewer(user, endorsementView(d, d.endorsements.find((e) => e.id === ref.id)!));
    }),
  ),
  http.post(
    `${API}/endorsements`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'endorsements.manage');
      if (user.role === 'hr') throw forbidden();
      const input = await body(request, endorsementCreateSchema);
      const d = db();
      const c = contractOf(d, input.contractId);
      let requests = pendingRequests(d, c.id);
      if (input.changeRequestIds) requests = requests.filter((r) => input.changeRequestIds!.includes(r.id));
      if (!requests.length) throw conflict('srv.endorsement.noRequests');
      const periodicity = PERIODICITIES[dmsParam('endorsementPeriodicity')] ?? 'monthly';
      const groups = periodicity === 'per_change' ? requests.map((r) => [r]) : [requests];
      const out = groups.map((g) => {
        const e = createEndorsement(d, c, g, 'changes');
        audit(user, 'endorsement_created', { targetType: 'endorsement', targetId: e.id, targetLabel: `${e.number}: строк ${g.length}` });
        return endorsementView(d, e);
      });
      return HttpResponse.json(out, { status: 201 });
    }),
  ),
  http.patch(
    `${API}/endorsements/:id`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'endorsements.manage');
      if (user.role === 'hr') throw forbidden();
      const d = db();
      const e = d.endorsements.find((x) => x.id === param(ctx, 'id'));
      if (!e) throw notFound();
      if (e.status !== 'draft') throw conflict('srv.endorsement.draftOnly');
      const { clauseOverrides } = await body(ctx.request, endorsementPatchSchema);
      e.clauseOverrides = overridesFrom('endorsement', clauseOverrides, e.clauseOverrides, user);
      // Lines are recalculated: parameters (refund rule) may have changed since the draft was formed.
      if (e.kind !== 'termination') {
        e.lines = endorsementLines(d, contractOf(d, e.contractId), d.changeRequests.filter((r) => e.changeRequestIds.includes(r.id)));
        e.total = e.lines.reduce((s, l) => s + l.amount, 0);
      }
      return endorsementView(d, e);
    }),
  ),
  http.post(
    `${API}/endorsements/:id/approve-amounts`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'endorsements.manage', { sub: 'approve_amounts' });
      if (user.role !== 'underwriter') throw forbidden();
      const d = db();
      const e = d.endorsements.find((x) => x.id === param(ctx, 'id'));
      if (!e) throw notFound();
      e.amountsApprovedByName = user.displayName;
      audit(user, 'contract_finance_approved', { targetType: 'endorsement', targetId: e.id, targetLabel: `${e.number}: суммы утверждены` });
      return endorsementView(d, e);
    }),
  ),
  ...signingRoutes('endorsement'),
];

