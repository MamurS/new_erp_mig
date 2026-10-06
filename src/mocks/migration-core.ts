/*
 * Transfer of the existing portfolio on the mock server (/staff/admin/migration): references of the
 * database for the dry run, applying a batch (clients, contracts in force with policies and certificates,
 * insured persons, used limits, open claims, unpaid invoices), reconciliation, and the rollback with its
 * rules: a batch is rolled back only while nobody has acted on its records.
 */
import type { AuditAction, ClaimEvent, Contract, Deal, Invoice, LimitCategory, MigrationMark, Policy, SessionUser, UUID } from '@/shared/types';
import type { MigrationBatchSummary, MigrationBatchView, MigrationContractPremium, MigrationRollbackBlocker, MigrationStep, MigrationStepView } from '@/shared/types/migration';
import { can } from '@/shared/auth/permissions';
import { MIGRATION_STEPS, contractPremiumCheck, emptyDbRefs, loadedTotals, reconcile, validateBatch, type BatchResults, type MigrationDbRefs, type MigrationRef } from '@/shared/domain/migration';
import { defaultTariff } from '@/shared/domain/policies';
import { addDays, buildPaymentSchedule, certificateNumber, contractNumber, dealNumber } from '@/shared/domain/contracts';
import { DOC_TEMPLATES } from '@/features/documents/templates';
import type { ClaimRow, ClientRow, Db, InsuredRow, MigrationBatchRow } from './db';
import { audit, conflict, notFound } from './http';
import { createInsured, nextPolicyNumber, refreshPolicyTotals } from './policy-core';
import { syncAssistance } from './assistance-core';
import { nextClaimNumber } from './clinic-core';
import { dealEvent, nextInvoiceNumber, refreshInvoice } from './lifecycle-core';
import { currentReserve } from './settlement-core';
import { numbering } from './params';
import { randomId } from './rng';
import { DAY, tzIso } from './time';

const MAX_ISSUES = 500;

export function batchOf(d: Db, id: UUID): MigrationBatchRow {
  const b = d.migrationBatches.find((x) => x.id === id);
  if (!b || b.status === 'discarded') throw notFound();
  return b;
}

/** What the system already has, for the dry run. */
export function dbRefs(d: Db): MigrationDbRefs {
  const refs = emptyDbRefs();
  for (const c of d.clients) {
    const p = d.policies.find((x) => x.id === c.activePolicyId);
    refs.clients.set(c.inn, { id: c.id, hasActivePolicy: !!p && p.status === 'active' });
  }
  for (const c of d.contracts) {
    if (!c.externalNumber) continue;
    refs.contracts.set(c.externalNumber.toUpperCase(), {
      id: c.id,
      program: c.params.program,
      startDate: c.params.startDate,
      endDate: c.params.endDate,
      active: c.status === 'active',
      premiumEmployee: c.params.premiumEmployee,
      premiumFamily: c.params.premiumFamily,
    });
  }
  for (const i of d.insured) {
    if (i.status !== 'active') continue;
    const p = d.policies.find((x) => x.id === i.policyId);
    const facts = { id: i.id, program: p?.program ?? 'standard', from: p?.startDate ?? i.insuredFrom };
    refs.insuredByPinfl.set(i.pinfl, facts);
    if (i.externalCertificateNumber) refs.insuredByCertificate.set(i.externalCertificateNumber.toUpperCase(), facts);
    if (i.phone) refs.phones.add(i.phone);
    for (const cat of Object.keys(i.migratedUsed ?? {})) refs.limits.add(`${i.id}:${cat}`);
  }
  for (const c of d.claims) if (c.externalNumber) refs.claimNumbers.add(c.externalNumber.toUpperCase());
  for (const i of d.invoices) if (i.externalNumber) refs.invoiceNumbers.add(i.externalNumber.toUpperCase());
  for (const a of d.assistances) refs.assistances.set(a.name.toLowerCase(), a.id);
  return refs;
}

/** Dry run of the files of the batch up to `upTo` (inclusive), against the database now. */
export function validate(d: Db, b: MigrationBatchRow, upTo?: MigrationStep): BatchResults {
  const last = upTo ? MIGRATION_STEPS.indexOf(upTo) : MIGRATION_STEPS.length - 1;
  const files: Partial<Record<MigrationStep, Record<string, string>[]>> = {};
  MIGRATION_STEPS.forEach((s, k) => {
    const f = b.files[s];
    if (k <= last && f && b.steps[s]?.status !== 'skipped') files[s] = f.rows;
  });
  return validateBatch({ migrationDate: b.migrationDate, files }, dbRefs(d));
}

/** Rows of every step that will be written now (valid rows of confirmed steps). */
export function rowsToWrite(res: BatchResults): number {
  return MIGRATION_STEPS.reduce((s, step) => s + (res[step]?.valid.length ?? 0), 0);
}

/**
 * The batch still holds what was confirmed: no confirmed step got new errors (a step confirmed without
 * exclusion must stay error-free, with exclusion the rows to write must stay the same).
 */
export function staleSteps(b: MigrationBatchRow, res: BatchResults): MigrationStep[] {
  return MIGRATION_STEPS.filter((s) => {
    const st = b.steps[s];
    const r = res[s];
    if (!st || st.status !== 'confirmed' || !r) return false;
    if (!st.excludeErrors && r.errorRows > 0) return true;
    const confirmed = st.validRows ?? [];
    const now = r.valid.map((v) => v.row);
    return confirmed.length !== now.length || confirmed.some((x, k) => x !== now[k]);
  });
}

// ---------------------------------------------------------------- views

function rowsOf(d: Db, b: MigrationBatchRow): number {
  if (b.status === 'applied' || b.status === 'rolled_back') {
    const a = b.applied;
    if (!a) return 0;
    return a.clientIds.length + a.contractIds.length + a.insuredIds.length + a.claimIds.length + a.invoiceIds.length + a.limitsCount;
  }
  return rowsToWrite(validate(d, b));
}

export function batchSummary(d: Db, b: MigrationBatchRow): MigrationBatchSummary {
  return {
    id: b.id,
    seq: b.seq,
    kind: b.kind,
    status: b.status,
    migrationDate: b.migrationDate,
    createdAt: b.createdAt,
    createdById: b.createdById,
    createdByName: b.createdByName,
    rows: rowsOf(d, b),
    submittedAt: b.submittedAt,
    decidedAt: b.decidedAt,
    decidedByName: b.decidedByName,
  };
}

function loadedOf(d: Db, b: MigrationBatchRow) {
  const mine = (m?: MigrationMark) => m?.batchId === b.id;
  const insured = d.insured.filter((i) => mine(i.migration));
  const limitsUsed =
    insured.reduce((s, i) => s + Object.values(i.migratedUsed ?? {}).reduce((x, y) => x + (y ?? 0), 0), 0) +
    (b.applied?.limitsOnExisting ?? []).reduce((s, l) => {
      const person = d.insured.find((i) => i.id === l.insuredId);
      return s + (Object.keys(l.used) as LimitCategory[]).reduce((x, cat) => x + (person?.migratedUsed?.[cat] ?? 0), 0);
    }, 0);
  return loadedTotals({
    clients: d.clients.filter((c) => mine(c.migration)).length,
    contracts: d.contracts.filter((c) => mine(c.migration)).map((c) => ({ total: c.params.total })),
    insured: insured.length,
    limitsUsed,
    claims: d.claims.filter((c) => mine(c.migration)).map((c) => ({ reserve: currentReserve(c) })),
    invoices: d.invoices.filter((i) => mine(i.migration)).map((i) => ({ amount: i.amount, paid: i.paid ?? 0 })),
  });
}

/**
 * Per-contract premium check: before the load from the dry run, after it from the premiums stored on the
 * batch's insured persons (a rolled back batch keeps the figures it had when applied).
 */
function contractPremiumsOf(d: Db, b: MigrationBatchRow, res: BatchResults | null): MigrationContractPremium[] {
  if (res) return res.contractPremiums ?? [];
  if (b.status !== 'applied') return b.contractPremiums ?? [];
  return (b.contractPremiums ?? []).map((x) => {
    const c = d.contracts.find((y) => y.migration?.batchId === b.id && y.externalNumber === x.oldNumber);
    if (!c) return x;
    const persons = d.insured.filter((i) => i.contractId === c.id && i.migration?.batchId === b.id && i.migratedPremium).map((i) => ({ premium: i.migratedPremium!.amount, source: i.migratedPremium!.source }));
    return contractPremiumCheck({ oldNumber: x.oldNumber, number: c.number, total: c.params.total }, persons);
  });
}

export function batchView(d: Db, b: MigrationBatchRow, user: SessionUser): MigrationBatchView {
  const res = b.status === 'draft' || b.status === 'pending_approval' || b.status === 'rejected' ? validate(d, b) : null;
  const totals = b.totals;
  const steps: MigrationStepView[] = MIGRATION_STEPS.map((step) => {
    const st = b.steps[step];
    const r = res?.[step];
    const t = totals?.[step];
    const f = b.files[step];
    return {
      step,
      status: st?.status ?? 'empty',
      total: r?.total ?? t?.fileTotals.rows ?? 0,
      valid: r?.valid.length ?? t?.validTotals.rows ?? 0,
      errorRows: r?.errorRows ?? t?.errorRows ?? 0,
      warningRows: r?.warningRows ?? t?.warningRows ?? 0,
      excludeErrors: st?.excludeErrors ?? false,
      issues: (r?.issues ?? t?.issues ?? []).slice(0, MAX_ISSUES),
      fileTotals: r?.fileTotals ?? t?.fileTotals ?? { rows: 0, amount: 0 },
      validTotals: r?.validTotals ?? t?.validTotals ?? { rows: 0, amount: 0 },
      ...(f ? { uploadedAt: f.uploadedAt, uploadedByName: f.uploadedByName } : {}),
    };
  });
  const forRecon = Object.fromEntries(steps.filter((s) => s.status !== 'empty' && s.status !== 'skipped').map((s) => [s.step, s]));
  const applied = b.status === 'applied' || b.status === 'rolled_back';
  const view: MigrationBatchView = {
    ...batchSummary(d, b),
    steps,
    rejectReason: b.rejectReason,
    appliedAt: b.appliedAt,
    rolledBackAt: b.rolledBackAt,
    rolledBackByName: b.rolledBackByName,
    rollbackReason: b.rollbackReason,
    canApprove: b.status === 'pending_approval' && can(user, 'migration.approve', { createdById: b.createdById }),
    isAuthor: b.createdById === user.id,
    reconciliation: reconcile(forRecon, applied ? loadedOf(d, b) : null),
    contractPremiums: contractPremiumsOf(d, b, res && b.steps.insured?.status !== 'skipped' && b.files.insured ? res : null),
    contracts: d.contracts
      .filter((c) => c.migration?.batchId === b.id)
      .map((c) => ({ id: c.id, number: c.number, externalNumber: c.externalNumber ?? '', clientName: c.clientName })),
  };
  if (b.status === 'applied') {
    const blockers = rollbackBlockers(d, b);
    view.rollback = { allowed: blockers.length === 0, blockers: blockers.slice(0, 50) };
  }
  return view;
}

// ---------------------------------------------------------------- apply

const MIGRATED_BY = (b: MigrationBatchRow, at: string): MigrationMark => ({ batchId: b.id, at, byName: b.createdByName });

function managerOf(d: Db, fallback: { id: UUID; name: string }): { id: UUID; name: string } {
  const s = d.staff.find((x) => x.active && x.role === 'sales_manager');
  return s ? { id: s.id, name: s.fullName } : fallback;
}

/** Writes the batch to the system. The batch must have been validated just before (`res`). */
export function applyBatch(d: Db, b: MigrationBatchRow, res: BatchResults, approver: SessionUser): void {
  const at = tzIso(Date.now());
  const mark = MIGRATED_BY(b, at);
  const author = d.staff.find((s) => s.id === b.createdById);
  const manager = managerOf(d, { id: b.createdById, name: b.createdByName });
  const signatory = d.staff.find((s) => s.active && s.signatory?.canSign) ?? author;
  const applied: NonNullable<MigrationBatchRow['applied']> = {
    clientIds: [],
    dealIds: [],
    contractIds: [],
    policyIds: [],
    insuredIds: [],
    claimIds: [],
    invoiceIds: [],
    documentIds: [],
    clientsBefore: [],
    limitsOnExisting: [],
    limitsCount: 0,
    auditMark: '',
  };

  // ---- clients
  const clientByRow = new Map<number, ClientRow>();
  for (const v of res.clients?.valid ?? []) {
    const r = v.data;
    const client: ClientRow = {
      id: randomId(),
      legalForm: r.legalForm,
      name: r.name,
      inn: r.stir,
      status: 'draft',
      managerId: manager.id,
      managerName: manager.name,
      hrContact: { name: r.hrName, phone: r.hrPhone, email: r.hrEmail },
      premium: 0,
      lossRatio: null,
      createdAt: at,
      requisites: { bank: r.bank, account: r.account, mfo: r.mfo, director: r.director, directorBasis: r.directorBasis ?? 'Устав', ...(r.address ? { address: r.address } : {}) },
      migration: mark,
    };
    d.clients.unshift(client);
    clientByRow.set(v.row, client);
    applied.clientIds.push(client.id);
  }
  const clientOf = (ref: MigrationRef): ClientRow => {
    const c = 'batch' in ref ? clientByRow.get(ref.batch) : d.clients.find((x) => x.id === ref.db);
    if (!c) throw conflict('srv.migration.stale');
    return c;
  };

  // ---- contracts in force, with a deal, a policy and the client's documents
  const contractByRow = new Map<number, { c: Contract; p: Policy; client: ClientRow }>();
  const insuredRows = res.insured?.valid ?? [];
  for (const v of res.contracts?.valid ?? []) {
    const r = v.data;
    const client = clientOf(v.ref.client);
    const members = insuredRows.filter((x) => 'batch' in x.ref.contract && x.ref.contract.batch === v.row);
    const employees = members.length;
    const family = members.reduce((s, x) => s + x.data.familyMembers, 0);
    const year = new Date().getFullYear();
    d.contractSeq += 1;
    d.dealSeq += 1;
    const deal: Deal = { id: randomId(), number: dealNumber(year, d.dealSeq, numbering()), clientId: client.id, type: 'new', stage: 'active', ownerId: manager.id, expectedStart: r.startDate, createdAt: at, updatedAt: at };
    d.deals.unshift(deal);
    applied.dealIds.push(deal.id);
    // Tariff for later changes of the list: the premiums by type of the file, else the program's base tariff.
    const base = defaultTariff(r.program);
    const premiumEmployee = r.premium_employee ?? base.employee;
    const premiumFamily = r.premium_family ?? base.family;
    const c: Contract = {
      id: randomId(),
      number: contractNumber(year, d.contractSeq, numbering()),
      dealId: deal.id,
      clientId: client.id,
      clientName: client.name,
      version: 1,
      templateId: 'contract',
      templateVersion: DOC_TEMPLATES.contract.version,
      params: {
        startDate: r.startDate,
        endDate: r.endDate,
        program: r.program,
        premiumEmployee,
        premiumFamily,
        employees,
        familyMembers: family,
        total: r.premium,
        paymentFrequency: r.paymentFrequency,
        paymentSchedule: buildPaymentSchedule(r.premium, r.startDate, r.paymentFrequency),
        activationRule: 'on_start_date',
        migSignatoryId: signatory?.id ?? b.createdById,
        clientSignatory: { name: client.requisites?.director ?? client.hrContact.name, position: 'Директор', basis: client.requisites?.directorBasis ?? 'Устав' },
        assistanceId: v.ref.assistanceId,
      },
      clauseOverrides: [],
      status: 'active',
      signing: { paperOriginal: { required: false } },
      createdAt: at,
      versions: [{ version: 1, at, byName: b.createdByName, changes: `Перенесён из старой системы: старый № ${r.oldNumber}, подтвердил ${approver.displayName}` }],
      activatedAt: at,
      insuredCount: employees,
      externalNumber: r.oldNumber,
      migration: mark,
    };
    const policy: Policy = {
      id: randomId(),
      number: nextPolicyNumber(d, Number(r.startDate.slice(0, 4))),
      clientId: client.id,
      clientName: client.name,
      clientLegalForm: client.legalForm,
      program: r.program,
      startDate: r.startDate,
      endDate: r.endDate,
      status: 'active',
      premium: r.premium,
      insuredCount: 0,
      tariff: { employee: premiumEmployee, family: premiumFamily },
      familyCount: 0,
      assistanceId: v.ref.assistanceId,
      contractId: c.id,
    };
    c.policyId = policy.id;
    d.contracts.unshift(c);
    d.policies.unshift(policy);
    d.assignments.push({ policyId: policy.id, assistanceId: v.ref.assistanceId, from: r.startDate, setById: b.createdById, setAt: at });
    applied.contractIds.push(c.id);
    applied.policyIds.push(policy.id);
    // The client's current policy switches to the transferred one unless the client already has one in force.
    const isNew = client.migration?.batchId === b.id;
    const current = d.policies.find((p) => p.id === client.activePolicyId);
    if (isNew || !current || current.status !== 'active') {
      if (!isNew && !applied.clientsBefore.some((x) => x.id === client.id))
        applied.clientsBefore.push({ id: client.id, fields: { activePolicyId: client.activePolicyId, status: client.status, program: client.program, premium: client.premium, renewalDate: client.renewalDate, assistanceId: client.assistanceId } });
      client.activePolicyId = policy.id;
      client.status = 'active';
      client.program = r.program;
      client.premium = r.premium;
      client.renewalDate = r.endDate;
      client.assistanceId = v.ref.assistanceId;
    }
    const docs = [
      { id: randomId(), clientId: client.id, title: `Договор ДМС ${c.number} (старый № ${r.oldNumber})`, kind: 'contract' as const, createdAt: at.slice(0, 10) },
      { id: randomId(), clientId: client.id, title: `Полис ${policy.number}`, kind: 'policy' as const, createdAt: at.slice(0, 10) },
    ];
    d.documents.unshift(...docs);
    applied.documentIds.push(...docs.map((x) => x.id));
    dealEvent(d, deal.id, b.createdByName, `Договор перенесён из старой системы: старый № ${r.oldNumber}, новый № ${c.number}, полис ${policy.number}`);
    contractByRow.set(v.row, { c, p: policy, client });
  }
  const contractOf = (ref: MigrationRef): { c: Contract; p: Policy; client: ClientRow } => {
    if ('batch' in ref) {
      const x = contractByRow.get(ref.batch);
      if (!x) throw conflict('srv.migration.stale');
      return x;
    }
    const c = d.contracts.find((x) => x.id === ref.db);
    const p = c ? d.policies.find((x) => x.id === c.policyId) : undefined;
    const client = c ? d.clients.find((x) => x.id === c.clientId) : undefined;
    if (!c || !p || !client) throw conflict('srv.migration.stale');
    return { c, p, client };
  };

  // ---- insured persons with new certificates
  const insuredByRow = new Map<number, InsuredRow>();
  for (const v of insuredRows) {
    const r = v.data;
    const { c, p, client } = contractOf(v.ref.contract);
    const person = createInsured(d, client, p, { fullName: r.fullName, position: r.position ?? 'Сотрудник', birthDate: r.birthDate, pinfl: r.pinfl, phone: r.phone ?? '', familyMembers: r.familyMembers }, r.inclusionDate, r.phone ? 'invited' : 'not_invited');
    person.contractId = c.id;
    person.certificateNumber = certificateNumber(c.number, d.insured.filter((i) => i.contractId === c.id).length, numbering());
    person.externalCertificateNumber = r.oldCertificate;
    person.migratedPremium = { amount: v.ref.premium, source: v.ref.premiumSource };
    person.migration = mark;
    person.updatedAt = at;
    if (r.phone) d.smsOutbox.unshift({ at, insuredId: person.id, text: `Ваш полис ДМС перенесён в новую систему МИГ. Сертификат ${person.certificateNumber}. Скачайте приложение MIG ДМС.` });
    insuredByRow.set(v.row, person);
    applied.insuredIds.push(person.id);
  }
  for (const id of applied.policyIds) {
    const p = d.policies.find((x) => x.id === id)!;
    refreshPolicyTotals(d, p);
  }
  const personOf = (ref: MigrationRef): InsuredRow => {
    const i = 'batch' in ref ? insuredByRow.get(ref.batch) : d.insured.find((x) => x.id === ref.db);
    if (!i) throw conflict('srv.migration.stale');
    return i;
  };

  // ---- used limits as of the migration date
  for (const v of res.limits?.valid ?? []) {
    const person = personOf(v.ref.insured);
    const cat = v.data.category as LimitCategory;
    person.migratedUsed = { ...person.migratedUsed, [cat]: v.data.usedAmount };
    applied.limitsCount += 1;
    if ('db' in v.ref.insured) {
      const entry = applied.limitsOnExisting.find((x) => x.insuredId === person.id);
      if (entry) entry.used[cat] = v.data.usedAmount;
      else applied.limitsOnExisting.push({ insuredId: person.id, used: { [cat]: v.data.usedAmount } });
    }
  }

  // ---- open claims with reserves
  for (const v of res.claims?.valid ?? []) {
    const r = v.data;
    const person = personOf(v.ref.insured);
    const history: ClaimEvent[] = [{ at, actorName: b.createdByName, to: 'new', comment: `Перенесён из старой системы: старый № ${r.oldNumber}` }];
    if (r.status === 'review' || r.status === 'medical_review') history.push({ at, actorName: b.createdByName, from: 'new', to: 'review' });
    if (r.status === 'medical_review') history.push({ at, actorName: b.createdByName, from: 'review', to: 'medical_review' });
    const claim: ClaimRow = {
      id: randomId(),
      number: nextClaimNumber(d),
      insuredId: person.id,
      insuredName: person.fullName,
      clientId: person.clientId,
      clientName: person.clientName,
      category: r.category,
      source: 'operator',
      amountClaimed: r.amountClaimed,
      providerName: r.provider,
      serviceDate: r.serviceDate,
      status: r.status,
      slaDueAt: tzIso(Date.now() + 5 * DAY),
      createdAt: at,
      updatedAt: at,
      attachments: [],
      history,
      handledBy: 'mig',
      externalNumber: r.oldNumber,
      migration: mark,
      ...(r.reserve !== r.amountClaimed ? { reserveHistory: [{ at, byName: b.createdByName, from: r.amountClaimed, to: r.reserve, reason: `Резерв на дату переноса ${b.migrationDate.split('-').reverse().join('.')}` }] } : {}),
    };
    d.claims.unshift(claim);
    applied.claimIds.push(claim.id);
  }

  // ---- unpaid invoices
  for (const v of res.invoices?.valid ?? []) {
    const r = v.data;
    const { c } = contractOf(v.ref.contract);
    const inv: Invoice = refreshInvoice({
      id: randomId(),
      clientId: c.clientId,
      number: nextInvoiceNumber(d),
      amount: r.amount,
      issuedAt: r.issuedAt,
      dueDate: r.dueDate ?? addDays(r.issuedAt, 10),
      status: 'unpaid',
      contractId: c.id,
      paid: r.paid,
      externalNumber: r.oldNumber,
      migration: mark,
    });
    d.invoices.unshift(inv);
    applied.invoiceIds.push(inv.id);
  }

  syncAssistance(d);
  b.applied = applied;
  b.status = 'applied';
  b.appliedAt = at;
  b.decidedAt = at;
  b.decidedById = approver.id;
  b.decidedByName = approver.displayName;
  b.contractPremiums = (res.contractPremiums ?? []).map((x) => {
    const c = d.contracts.find((y) => y.migration?.batchId === b.id && y.externalNumber === x.oldNumber);
    return c ? { ...x, number: c.number } : x;
  });
  b.totals = Object.fromEntries(
    MIGRATION_STEPS.flatMap((s) => {
      const r = res[s];
      return r ? [[s, { fileTotals: r.fileTotals, validTotals: r.validTotals, errorRows: r.errorRows, warningRows: r.warningRows, issues: r.issues.slice(0, MAX_ISSUES) }]] : [];
    }),
  );
  // The files are no longer needed: what was written lives in the system, the report in `totals`.
  b.files = Object.fromEntries(Object.entries(b.files).map(([s, f]) => [s, { rows: [], uploadedAt: f.uploadedAt, uploadedByName: f.uploadedByName }]));
  audit(approver, 'migration_applied', {
    targetType: 'migration',
    targetId: b.id,
    targetLabel: `Пакет № ${b.seq}: клиентов ${applied.clientIds.length}, договоров ${applied.contractIds.length}, застрахованных ${applied.insuredIds.length}, убытков ${applied.claimIds.length}, счетов ${applied.invoiceIds.length}`,
    reason: `Подготовил ${b.createdByName}`,
  });
  applied.auditMark = d.audit[0]!.id;
}

// ---------------------------------------------------------------- rollback

/** Audit actions that only read data: they do not block a rollback. */
const READ_ONLY: ReadonlySet<AuditAction> = new Set<AuditAction>(['login', 'logout', 'login_failed', 'reveal_pii', 'open_medical', 'export', 'kp_downloaded', 'clinic_check_patient', 'clinic_check_failed']);

/**
 * New actions on the batch's data after it was applied. A rollback is allowed only without them:
 * - audit events (not read-only) on transferred clients, contracts, policies, insured persons, claims, invoices;
 * - records created on top of the transferred ones: claims, payments, endorsements, change requests,
 *   insured-list changes, appointments, guarantee letters, visits, invoices, contracts, deals, KP,
 *   insured persons, limit requests, assistance cases, chat messages, uploaded files;
 * - the consent of a transferred insured person given in the app.
 */
export function rollbackBlockers(d: Db, b: MigrationBatchRow): MigrationRollbackBlocker[] {
  const a = b.applied;
  if (!a) return [];
  const clients = new Set(a.clientIds);
  const contracts = new Set(a.contractIds);
  const policies = new Set(a.policyIds);
  const insured = new Set(a.insuredIds);
  const claims = new Set(a.claimIds);
  const invoices = new Set(a.invoiceIds);
  const deals = new Set(a.dealIds);
  const all = new Set([...clients, ...contracts, ...policies, ...insured, ...claims, ...invoices]);
  const out: MigrationRollbackBlocker[] = [];
  const markIdx = d.audit.findIndex((e) => e.id === a.auditMark);
  const newer = markIdx >= 0 ? d.audit.slice(0, markIdx) : d.audit.filter((e) => !!b.appliedAt && e.at > b.appliedAt);
  for (const e of newer) {
    if (!e.targetId || !all.has(e.targetId) || READ_ONLY.has(e.action) || e.action.startsWith('migration_')) continue;
    out.push({ kind: 'audit', label: e.targetLabel ?? '', at: e.at, actorName: e.actorName, action: e.action });
  }
  const insuredLabel = (id: UUID) => d.insured.find((i) => i.id === id)?.certificateNumber ?? id.slice(0, 8);
  for (const c of d.claims) if (insured.has(c.insuredId) && !claims.has(c.id)) out.push({ kind: 'claim', label: c.number, at: c.createdAt });
  for (const p of d.payments) if ((p.contractId && contracts.has(p.contractId)) || (p.invoiceId && invoices.has(p.invoiceId))) out.push({ kind: 'payment', label: p.purpose, at: p.paidAt, actorName: p.recordedByName });
  for (const e of d.endorsements) if (contracts.has(e.contractId)) out.push({ kind: 'endorsement', label: e.number, at: e.createdAt });
  for (const r of d.changeRequests) if (contracts.has(r.contractId)) out.push({ kind: 'change_request', label: r.description ?? r.type, at: r.createdAt, actorName: r.requestedBy.name });
  for (const r of d.policyChanges) if (policies.has(r.policyId) || clients.has(r.clientId)) out.push({ kind: 'policy_change', label: r.policyNumber, at: r.requestedAt, actorName: r.requestedByName });
  for (const x of d.appointments) if (insured.has(x.insuredId)) out.push({ kind: 'appointment', label: insuredLabel(x.insuredId), at: x.createdAt });
  for (const g of d.guarantees) if (insured.has(g.insuredId)) out.push({ kind: 'guarantee', label: g.number, at: g.createdAt });
  for (const v of d.visits) if (insured.has(v.insuredId)) out.push({ kind: 'visit', label: insuredLabel(v.insuredId), at: v.openedAt });
  for (const i of d.invoices) if (i.contractId && contracts.has(i.contractId) && !invoices.has(i.id)) out.push({ kind: 'invoice', label: i.number, at: i.issuedAt });
  for (const c of d.contracts) if (clients.has(c.clientId) && !contracts.has(c.id)) out.push({ kind: 'contract', label: c.number, at: c.createdAt });
  for (const x of d.deals) if (clients.has(x.clientId) && !deals.has(x.id)) out.push({ kind: 'deal', label: x.number, at: x.createdAt });
  for (const k of d.kp) if (clients.has(k.clientId)) out.push({ kind: 'kp', label: k.number, at: k.createdAt });
  for (const i of d.insured) if (policies.has(i.policyId) && !insured.has(i.id)) out.push({ kind: 'insured', label: i.certificateNumber ?? insuredLabel(i.id), at: i.addedAt });
  for (const i of d.insured) if (insured.has(i.id) && i.consentGivenAt) out.push({ kind: 'consent', label: insuredLabel(i.id), at: i.consentGivenAt });
  for (const m of d.chat) if (insured.has(m.insuredId)) out.push({ kind: 'chat', label: insuredLabel(m.insuredId), at: m.at });
  for (const f of d.files) if ((f.contractId && contracts.has(f.contractId)) || (f.clientId && clients.has(f.clientId)) || (f.insuredId && insured.has(f.insuredId))) out.push({ kind: 'file', label: f.fileName ?? '' });
  for (const r of d.limitRequests) if (policies.has(r.policyId)) out.push({ kind: 'limit_request', label: r.policyNumber, at: r.createdAt, actorName: r.requestedByName });
  for (const c of d.cases) if (policies.has(c.policyId)) out.push({ kind: 'case', label: c.number, at: c.createdAt });
  return out;
}

/** Removes everything the batch created and restores the clients it changed. */
export function rollbackBatch(d: Db, b: MigrationBatchRow, user: SessionUser, reason: string): void {
  const a = b.applied;
  if (!a) throw conflict('srv.migration.notApplied');
  const ids = (list: UUID[]) => new Set(list);
  const clients = ids(a.clientIds);
  const contracts = ids(a.contractIds);
  const policies = ids(a.policyIds);
  const insured = ids(a.insuredIds);
  const deals = ids(a.dealIds);
  const userIds = new Set(d.insured.filter((i) => insured.has(i.id)).map((i) => i.userId));
  d.claims = d.claims.filter((c) => !a.claimIds.includes(c.id));
  d.invoices = d.invoices.filter((i) => !a.invoiceIds.includes(i.id));
  d.insured = d.insured.filter((i) => !insured.has(i.id));
  d.smsOutbox = d.smsOutbox.filter((s) => !insured.has(s.insuredId));
  d.cardTokens = d.cardTokens.filter((t) => !insured.has(t.insuredId));
  d.sessions = d.sessions.filter((s) => !userIds.has(s.userId));
  d.policies = d.policies.filter((p) => !policies.has(p.id));
  d.assignments = d.assignments.filter((x) => !policies.has(x.policyId));
  d.contracts = d.contracts.filter((c) => !contracts.has(c.id));
  d.deals = d.deals.filter((x) => !deals.has(x.id));
  d.dealEvents = d.dealEvents.filter((x) => !deals.has(x.dealId));
  d.documents = d.documents.filter((x) => !a.documentIds.includes(x.id));
  d.clients = d.clients.filter((c) => !clients.has(c.id));
  for (const before of a.clientsBefore) {
    const c = d.clients.find((x) => x.id === before.id);
    if (c) Object.assign(c, before.fields);
  }
  for (const l of a.limitsOnExisting) {
    const person = d.insured.find((i) => i.id === l.insuredId);
    if (!person?.migratedUsed) continue;
    for (const cat of Object.keys(l.used) as LimitCategory[]) delete person.migratedUsed[cat];
  }
  syncAssistance(d);
  const at = tzIso(Date.now());
  b.status = 'rolled_back';
  b.rolledBackAt = at;
  b.rolledBackByName = user.displayName;
  b.rollbackReason = reason;
  audit(user, 'migration_rolled_back', {
    targetType: 'migration',
    targetId: b.id,
    targetLabel: `Пакет № ${b.seq}: удалено клиентов ${a.clientIds.length}, договоров ${a.contractIds.length}, застрахованных ${a.insuredIds.length}, убытков ${a.claimIds.length}, счетов ${a.invoiceIds.length}`,
    reason,
  });
}
