/*
 * Contracts, endorsements and their signing (LIFECYCLE_SPEC §7–12): drafting with changed clauses,
 * legal and finance approval, sending, signing by each side with E-IMZO, EDO, paper or scan, the paper
 * original, invoices and payments (1C statement), coming into force, certificates, change requests,
 * endorsements and termination.
 */
import { http, HttpResponse } from 'msw';
import Papa from 'papaparse';
import type { ClauseOverride, Contract, Endorsement, Payment, SessionUser, Signing } from '@/shared/types';
import type { CertificateView, ChangeRequestView, ContractView, EndorsementView, ImportPaymentsResult, InvoiceView } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole } from '@/shared/domain/labels';
import { addDays, addPendingScan, addSignature, buildPaymentSchedule, contractNumber, originalReminderDue, verifyScan, type Side } from '@/shared/domain/contracts';
import { PERIODICITIES } from '@/shared/domain/endorsements';
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
  paymentSchema,
  scanVerifySchema,
  signSchema,
  terminateSchema,
} from '@/shared/schemas/forms';
import { detectMime } from '@/shared/lib/image';
import { db, type ChangeRequestRow, type Db } from '../db';
import { API, audit, body, conflict, forbidden, HttpError, notFound, param, requirePermission, requireSession, route, type Ctx } from '../http';
import { randomId } from '../rng';
import { tzIso } from '../time';
import { toClient } from '../views';
import { parsePolicyList } from '../policy-core';
import { dmsParam } from '../params';
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
    insuredRows: (d.contractInsured.find((x) => x.contractId === c.id)?.rows ?? []).map((r) => ({ fullName: r.fullName, position: r.position, familyMembers: r.familyMembers })),
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
    clientName: `${client.legalForm} «${client.name}»`,
    clientInn: client.inn,
    migSignatory: signatory ? signatoryOption(signatory) : null,
    clientSignatoryName: signerForClient(c),
    requests: d.changeRequests.filter((r) => e.changeRequestIds.includes(r.id)).map(toChangeRequest),
    needsAmountApproval: d.changeRequests.some((r) => e.changeRequestIds.includes(r.id) && r.type === 'other') && !e.amountsApprovedByName,
  };
}

function viewOf(d: Db, ref: DocRef): ContractView | EndorsementView {
  return ref.kind === 'contract' ? contractView(d, ref.contract) : endorsementView(d, d.endorsements.find((x) => x.id === ref.id)!);
}

function overridesFrom(kind: Kind, input: { clauseId: string; text: string }[], previous: ClauseOverride[], user: SessionUser): ClauseOverride[] {
  const clauses = clausesOf(kind === 'contract' ? 'contract' : 'endorsement');
  return input.flatMap((o) => {
    const clause = clauses.find((c) => c.id === o.clauseId);
    if (!clause) throw new HttpError(422, 'validation', `Пункт ${o.clauseId} не найден в шаблоне`);
    if (o.text === clause.text) return [];
    const prev = previous.find((p) => p.clauseId === o.clauseId && p.text === o.text);
    return [prev ?? { clauseId: o.clauseId, original: clause.text, text: o.text, byId: user.id, byName: user.displayName, at: tzIso(Date.now()) }];
  });
}

async function readScan(request: Request): Promise<{ side: Side; bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'application/pdf' }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'validation', 'Некорректные данные формы');
  }
  const side = form.get('side');
  if (side !== 'mig' && side !== 'client') throw new HttpError(422, 'validation', 'Укажите сторону', { side: 'mig или client' });
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(422, 'validation', 'Добавьте файл скана', { file: 'Добавьте файл' });
  if (file.size === 0 || file.size > SCAN_MAX_BYTES) throw new HttpError(422, 'validation', 'Файл больше 20 МБ', { file: 'Файл больше 20 МБ' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectMime(bytes);
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'application/pdf') throw new HttpError(422, 'validation', 'Можно загрузить только PDF, JPEG или PNG', { file: 'Неподдерживаемый формат' });
  return { side, bytes, mime };
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
    const ok = side === 'mig' ? ['approved', 'sent', 'signing'] : ['sent', 'signing'];
    if (!ok.includes(ref.status)) throw conflict(side === 'client' ? 'Документ ещё не отправлен клиенту' : 'Документ ещё не согласован');
    if (ref.signing[side]) throw conflict(side === 'mig' ? 'МИГ уже подписал' : 'Клиент уже подписал');
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
          if (!can(user, 'contracts.sign_mig')) throw new HttpError(403, 'forbidden', 'Подписать за МИГ может только подписант с доверенностью');
        } else if (!can(user, 'contracts.sign_client', { companyId: ref.clientId })) {
          throw user.role === 'hr' ? notFound() : new HttpError(403, 'forbidden', 'Клиент подписывает в своём кабинете');
        }
        signable(ref, input.side);
        const at = tzIso(Date.now());
        const sig =
          input.method === 'eimzo'
            ? { method: 'eimzo' as const, signedAt: at, signerName: user.displayName, certificate: { serial: input.certificateSerial, owner: user.displayName, validTo: addDays(todayIso(), 365) } }
            : { method: 'paper' as const, signedAt: at, signerName: user.displayName };
        ref.setSigning({ ...addSignature(ref.signing, input.side, sig), ...(input.method === 'paper' ? { printedAt: at } : {}) });
        await done(d, ref, user, input.side, input.method === 'eimzo' ? 'ЭЦП' : 'бумага');
        return viewOf(d, refOf(d, kind, ref.id));
      }),
    ),
    http.post(
      `${base}/edo`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        if (!can(user, 'contracts.sign_mig')) throw new HttpError(403, 'forbidden', 'Отправить в ЭДО может подписант МИГ: документ уходит с его подписью');
        const { provider } = await body(ctx.request, edoSendSchema);
        if (ref.signing.client) throw conflict('Клиент уже подписал');
        if (!['approved', 'sent', 'signing'].includes(ref.status)) throw conflict('Документ ещё не согласован');
        const at = tzIso(Date.now());
        let s = ref.signing;
        if (!s.mig) s = addSignature(s, 'mig', { method: 'edo', signedAt: at, signerName: user.displayName, edoProvider: provider, certificate: { serial: 'C0FFEE01', owner: user.displayName, validTo: addDays(todayIso(), 365) } });
        ref.setSigning({ ...s, edoPending: { provider, sentAt: at } });
        if (ref.status === 'approved') ref.setStatus('sent');
        await done(d, ref, user, 'mig', `ЭДО ${provider}`);
        return viewOf(d, refOf(d, kind, ref.id));
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
        return viewOf(d, refOf(d, kind, ref.id));
      }),
    ),
    http.post(
      `${base}/scan/verify`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        requirePermission(user, 'contracts.verify_scan');
        const { side } = await body(ctx.request, scanVerifySchema);
        if (!ref.signing.pendingScans?.some((p) => p.side === side)) throw conflict('Скана на проверке нет');
        const signer = side === 'client' ? signerForClient(ref.contract) : (d.staff.find((s) => s.id === ref.contract.params.migSignatoryId)?.fullName ?? user.displayName);
        ref.setSigning(verifyScan(ref.signing, side, { id: user.id, name: user.displayName }, tzIso(Date.now()), signer));
        audit(user, 'contract_scan_verified', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: `${ref.number}: скан ${side === 'mig' ? 'МИГ' : 'клиента'}` });
        await done(d, ref, user, side, 'скан проверен');
        return viewOf(d, refOf(d, kind, ref.id));
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
          if (!s.mig) throw conflict('Сначала отметьте «Подписано МИГ»');
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
        return viewOf(d, refOf(d, kind, ref.id));
      }),
    ),
    // ---- legal approval: needed only when a clause was changed ----
    http.post(
      `${base}/submit-legal`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        if (!can(user, kind === 'contract' ? 'contracts.draft' : 'endorsements.manage')) throw forbidden();
        if (ref.status !== 'draft') throw conflict('Отправить на согласование можно черновик');
        if (kind === 'contract' && ref.contract.financeDiffers && !ref.contract.financeApprovedByName) throw conflict('Финансовые условия отличаются от котировки: сначала их утверждает андеррайтер');
        if (kind === 'endorsement') {
          const e = d.endorsements.find((x) => x.id === ref.id)!;
          if (endorsementView(d, e).needsAmountApproval) throw conflict('Суммы по прочим условиям утверждает андеррайтер');
        }
        const changed = ref.clauseOverrides.length > 0;
        ref.setStatus(changed ? 'legal_review' : 'approved');
        audit(user, 'contract_legal_submitted', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: `${ref.number}: ${changed ? `изменено пунктов ${ref.clauseOverrides.length}` : 'без изменений пунктов'}` });
        if (kind === 'contract') {
          moveDeal(d, ref.dealId, 'contract_review', user.displayName, changed ? `Договор ${ref.number} у юриста: изменено пунктов ${ref.clauseOverrides.length}` : `Договор ${ref.number} без изменённых пунктов — согласование юриста не требуется`);
          ref.contract.versions.push({ version: ref.contract.version, at: tzIso(Date.now()), byName: user.displayName, changes: changed ? 'Отправлен юристу' : 'Согласован без юриста (пункты не менялись)' });
        }
        return viewOf(d, refOf(d, kind, ref.id));
      }),
    ),
    http.post(
      `${base}/legal-approve`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        requirePermission(user, 'contracts.legal_approve');
        if (ref.status !== 'legal_review') throw conflict('Документ не на согласовании');
        const { comment } = await body(ctx.request, legalApproveSchema);
        ref.setStatus('approved');
        if (kind === 'contract') {
          ref.contract.legalApprovedByName = user.displayName;
          ref.contract.legalComment = undefined;
          ref.contract.versions.push({ version: ref.contract.version, at: tzIso(Date.now()), byName: user.displayName, changes: `Юрист согласовал${comment ? `: ${comment}` : ''}` });
          if (ref.dealId) dealEvent(d, ref.dealId, user.displayName, `Юрист согласовал договор ${ref.number}`);
        }
        audit(user, 'contract_legal_approved', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: ref.number, reason: comment });
        return viewOf(d, refOf(d, kind, ref.id));
      }),
    ),
    http.post(
      `${base}/legal-return`,
      route(async (ctx) => {
        const { user, d, ref } = load(ctx);
        requirePermission(user, 'contracts.legal_approve');
        if (ref.status !== 'legal_review') throw conflict('Документ не на согласовании');
        const { comment } = await body(ctx.request, legalReturnSchema);
        ref.setStatus('draft');
        if (kind === 'contract') {
          ref.contract.legalComment = comment;
          ref.contract.versions.push({ version: ref.contract.version, at: tzIso(Date.now()), byName: user.displayName, changes: `Юрист вернул: ${comment}` });
          if (ref.dealId) dealEvent(d, ref.dealId, user.displayName, `Юрист вернул договор ${ref.number}: ${comment}`);
        }
        audit(user, 'contract_legal_returned', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: ref.number, reason: comment });
        return viewOf(d, refOf(d, kind, ref.id));
      }),
    ),
    http.post(
      `${base}/send`,
      route((ctx) => {
        const { user, d, ref } = load(ctx);
        if (!can(user, kind === 'contract' ? 'contracts.draft' : 'endorsements.manage')) throw forbidden();
        if (ref.status !== 'approved') throw conflict('Отправить клиенту можно согласованный документ');
        ref.setStatus(ref.signing.mig || ref.signing.client ? 'signing' : 'sent');
        audit(user, 'contract_sent', { targetType: kind === 'contract' ? 'contract' : 'endorsement', targetId: ref.id, targetLabel: ref.number });
        if (kind === 'contract') {
          moveDeal(d, ref.dealId, 'contract_sent', user.displayName, `Договор ${ref.number} отправлен клиенту`);
          ref.contract.versions.push({ version: ref.contract.version, at: tzIso(Date.now()), byName: user.displayName, changes: 'Отправлен клиенту' });
        }
        return viewOf(d, refOf(d, kind, ref.id));
      }),
    ),
  ];
}

function invoiceView(d: Db, i: ReturnType<typeof refreshInvoice>): InvoiceView {
  const client = d.clients.find((c) => c.id === i.clientId);
  return {
    ...i,
    clientName: client ? `${client.legalForm} «${client.name}»` : '—',
    contractNumber: i.contractId ? d.contracts.find((c) => c.id === i.contractId)?.number : undefined,
    endorsementNumber: i.endorsementId ? d.endorsements.find((e) => e.id === i.endorsementId)?.number : undefined,
  };
}

async function recordPayment(d: Db, user: SessionUser, invoiceId: string, amount: number, paidAt: string, payerInn: string, purpose: string, source: Payment['source']): Promise<Payment> {
  const inv = d.invoices.find((i) => i.id === invoiceId);
  if (!inv) throw notFound();
  const p: Payment = { id: randomId(), invoiceId: inv.id, contractId: inv.contractId, amount, paidAt, payerInn, purpose, source, recordedByName: user.displayName };
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
      clientName: client ? `${client.legalForm} «${client.name}»` : p.clientName,
      contractNumber: c?.number ?? '—',
      assistanceName: a?.name ?? 'MIG',
      assistancePhone: a?.phone24x7 ?? '+998 71 200 00 00',
    }));
}

function changeRequestView(d: Db, r: ChangeRequestRow): ChangeRequestView {
  const c = d.contracts.find((x) => x.id === r.contractId)!;
  const client = d.clients.find((x) => x.id === c.clientId);
  return {
    ...toChangeRequest(r),
    contractNumber: c.number,
    clientName: client ? `${client.legalForm} «${client.name}»` : '—',
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
      return list.map((c) => contractView(d, c));
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
      return contractView(d, ref.contract);
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
      if (!kp || kp.status !== 'accepted') throw conflict('Договор готовится после того, как клиент принял КП');
      const existing = d.contracts.find((c) => c.dealId === deal.id);
      if (existing) throw conflict('Договор по сделке уже создан');
      const client = clientRow(d, deal.clientId);
      const q = kp.quoteId ? d.quotes.find((x) => x.id === kp.quoteId) : latestQuote(d, deal.id);
      const signatory = d.staff.find((s) => s.active && s.signatory?.canSign);
      if (!signatory) throw conflict('В МИГ нет сотрудника-подписанта');
      d.contractSeq += 1;
      const total = kp.params.premiumEmployee * kp.params.employees + kp.params.premiumFamily * kp.params.familyMembers;
      const at = tzIso(Date.now());
      const c: Contract = {
        id: randomId(),
        number: contractNumber(new Date().getFullYear(), d.contractSeq),
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
          paymentFrequency: 'single',
          paymentSchedule: buildPaymentSchedule(total, kp.params.coverageStart, 'single'),
          activationRule: 'on_start_date',
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
      if (c.status !== 'draft') throw conflict('Изменить можно черновик. Для отправленного договора создайте новую версию');
      const input = await body(ctx.request, contractPatchSchema);
      const changes: string[] = [];
      if (input.params) {
        const p = { ...c.params, ...input.params };
        if (p.endDate <= p.startDate) throw new HttpError(422, 'validation', 'Дата окончания позже даты начала', { 'params.endDate': 'Позже даты начала' });
        const signatory = d.staff.find((s) => s.id === p.migSignatoryId);
        if (!signatory?.signatory?.canSign) throw new HttpError(422, 'validation', 'Выберите подписанта МИГ', { 'params.migSignatoryId': 'Не подписант' });
        p.total = p.premiumEmployee * p.employees + p.premiumFamily * p.familyMembers;
        if (input.params.paymentSchedule) {
          const sum = input.params.paymentSchedule.reduce((s, x) => s + x.amount, 0);
          if (sum !== p.total) throw new HttpError(422, 'validation', 'Сумма графика должна равняться премии', { 'params.paymentSchedule': `Сумма ${sum}, премия ${p.total}` });
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
      if (!c.financeDiffers) throw conflict('Финансовые условия совпадают с котировкой');
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
      if (!['sent', 'signing', 'approved'].includes(c.status)) throw conflict('Новую версию создают у отправленного и ещё не подписанного договора');
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
      if (c.status === 'active' || c.status === 'signed' || c.status === 'terminated' || c.status === 'expired') throw conflict('Список застрахованных подписанного договора меняется доп. соглашением');
      const parsed = parsePolicyList(await ctx.request.text());
      if (parsed.errors.length) return HttpResponse.json({ code: 'validation', message: 'В файле есть ошибки', errors: parsed.errors.slice(0, 50) }, { status: 422 });
      const rows = parsed.rows.map((r) => ({ fullName: r.fullName, birthDate: r.birthDate, pinfl: r.pinfl, phone: r.phone, position: r.position, familyMembers: r.familyMembers ?? 0 }));
      d.contractInsured = [...d.contractInsured.filter((x) => x.contractId !== c.id), { contractId: c.id, rows }];
      c.insuredListId = c.id;
      c.insuredCount = rows.length;
      c.versions.push({ version: c.version, at: tzIso(Date.now()), byName: user.displayName, changes: `Загружено приложение 2: ${rows.length} застрахованных` });
      return contractView(d, c);
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
      if (date < c.params.startDate || date > c.params.endDate) throw new HttpError(422, 'validation', 'Дата в пределах срока договора', { date: 'В пределах срока договора' });
      if (d.endorsements.some((e) => e.contractId === c.id && e.kind === 'termination' && e.status !== 'signed')) throw conflict('Соглашение о расторжении уже готовится');
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
      return list.map((i) => invoiceView(d, i));
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
      if (input.amount > inv.amount - (inv.paid ?? 0)) throw new HttpError(422, 'validation', 'Сумма больше остатка по счёту', { amount: `Остаток ${inv.amount - (inv.paid ?? 0)}` });
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
      if (text.length > 1024 * 1024) throw new HttpError(413, 'validation', 'Файл больше 1 МБ');
      const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true });
      const fields = parsed.meta.fields ?? [];
      const missing = ['date', 'amount', 'inn', 'purpose'].filter((f) => !fields.includes(f));
      if (missing.length) throw new HttpError(422, 'validation', `Нет столбцов: ${missing.join(', ')}`);
      const d = db();
      const out: ImportPaymentsResult = { matched: 0, unmatched: [], activated: 0 };
      const activeBefore = d.contracts.filter((c) => c.status === 'active').length;
      for (const [k, row] of parsed.data.entries()) {
        const line = k + 2;
        const amount = Number((row.amount ?? '').replace(/\s/g, ''));
        const date = (row.date ?? '').trim();
        const inn = (row.inn ?? '').replace(/\D/g, '');
        if (!Number.isInteger(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          out.unmatched.push({ line, reason: 'Дата ГГГГ-ММ-ДД и сумма — целое число' });
          continue;
        }
        const client = d.clients.find((c) => c.inn === inn);
        const inv = client ? d.invoices.filter((i) => i.clientId === client.id && i.contractId && (i.paid ?? 0) < i.amount).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0] : undefined;
        if (!inv) {
          out.unmatched.push({ line, reason: client ? 'У плательщика нет неоплаченных счетов' : 'Плательщик с таким ИНН не найден' });
          continue;
        }
        await recordPayment(d, user, inv.id, Math.min(amount, inv.amount - (inv.paid ?? 0)), date, inn, (row.purpose ?? '').slice(0, 300), '1c');
        out.matched += 1;
      }
      out.activated = d.contracts.filter((c) => c.status === 'active').length - activeBefore;
      audit(user, 'payments_imported', { targetType: 'invoice', targetLabel: `Выписка 1С: сопоставлено ${out.matched}, не найдено ${out.unmatched.length}` });
      return out;
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
    route(({ request }) => {
      const { user } = requireSession(request);
      if (user.role !== 'insured' || !user.insuredId) throw forbidden();
      const d = db();
      const me = d.insured.find((i) => i.id === user.insuredId);
      if (!me?.certificateNumber) throw notFound();
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
      return list.map((r) => changeRequestView(d, r));
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
      if (c.status !== 'active') throw conflict('Изменения оформляются к действующему договору');
      if (input.effectiveDate < c.params.startDate || input.effectiveDate > c.params.endDate) throw new HttpError(422, 'validation', 'Дата в пределах срока договора', { effectiveDate: 'В пределах срока договора' });
      if (input.type === 'change_program' && (!input.program || input.program === c.params.program)) throw new HttpError(422, 'validation', 'Выберите другую программу', { program: 'Выберите другую программу' });
      if (input.type === 'other' && (input.amount === undefined || !input.description)) throw new HttpError(422, 'validation', 'Опишите изменение и сумму', { description: 'Опишите изменение' });
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
      return list.map((e) => endorsementView(d, e));
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
      return endorsementView(d, d.endorsements.find((e) => e.id === ref.id)!);
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
      if (!requests.length) throw conflict('Нет заявок на изменение для доп. соглашения');
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
      if (e.status !== 'draft') throw conflict('Изменить можно черновик');
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

