/*
 * Transfer of the existing portfolio (/staff/admin/migration), the service core: references of the
 * database for the dry run, applying a batch (clients, contracts in force with policies and certificates,
 * insured persons, used limits, open claims, unpaid invoices), reconciliation, and the rollback with its
 * rules: a batch is rolled back only while nobody has acted on its records.
 *
 * Applying and rolling back are all-or-nothing. The memory store has no transactions, so `applyBatch`
 * first resolves every reference of the batch (`planCheck`) and only then writes; nothing after that
 * point can fail on the data. On Postgres the adapter runs the whole call in one transaction.
 */
import type { AuditAction, ClaimEvent, Contract, Deal, Invoice, LimitCategory, MigrationMark, MigrationWarning, Policy, SessionUser, UUID } from '@mig/contracts';
import type { MigrationBatchSummary, MigrationBatchView, MigrationContractPremium, MigrationRollbackBlocker, MigrationStep, MigrationStepView } from '@mig/contracts/migration';
import { can } from '../auth/permissions';
import { MIGRATION_STEPS, contractPremiumCheck, emptyDbRefs, loadedTotals, reconcile, validateBatch, type BatchResults, type MigrationDbRefs, type MigrationRef } from '../migration';
import { defaultTariff } from '../policies';
import { addDays, buildPaymentSchedule, certificateNumber, contractNumber, dealNumber } from '../contracts';
import { DOC_TEMPLATES } from '../documents/templates/index';
import { groupRulesOf, legalFormAllowed } from '../minGroup';
import { randomId } from '../lib/random';
import { DAY, isoDay, tzIso } from '../lib/time';
import type { ClaimRow, ClientRow, InsuredRow, MigrationBatchRow } from '../store/db';
import { asSystem, audit, conflict, notFound, systemRepos, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { createInsured, nextPolicyNumber, refreshPolicyTotals } from './policy';
import { syncAssistance } from './assistance';
import { nextClaimNumber } from './clinic';
import { dealEvent, nextInvoiceNumber, refreshInvoice } from './lifecycle';
import { currentReserve } from './settlement';

export const MAX_ISSUES = 500;

export async function batchOf(ctx: BaseCtx, id: UUID): Promise<MigrationBatchRow> {
  const b = await ctx.repos.migrationBatches.get(id);
  if (!b || b.status === 'discarded') throw notFound();
  return b;
}

/** What the system already has, for the dry run. */
export async function dbRefs(ctx: BaseCtx): Promise<MigrationDbRefs> {
  // A transfer is checked against every existing record (duplicates of PINFL, numbers, clients).
  const r = systemRepos(ctx, 'portfolio transfer: checks against every existing client, policy, contract, person and claim');
  const [clients, policies, contracts, insured, claims, invoices, assistances] = await Promise.all([
    r.clients.list(),
    r.policies.list(),
    r.contracts.list(),
    r.insured.list(),
    r.claims.list(),
    r.invoices.list(),
    r.assistances.list(),
  ]);
  const policyById = new Map(policies.map((p) => [p.id, p]));
  const refs = emptyDbRefs();
  for (const c of clients) {
    const p = c.activePolicyId ? policyById.get(c.activePolicyId) : undefined;
    refs.clients.set(c.inn, { id: c.id, hasActivePolicy: !!p && p.status === 'active', legalForm: c.legalForm });
  }
  for (const c of contracts) {
    if (!c.externalNumber) continue;
    refs.contracts.set(c.externalNumber.toUpperCase(), {
      id: c.id,
      program: c.params.program,
      startDate: c.params.startDate,
      endDate: c.params.endDate,
      active: c.status === 'active',
      premiumEmployee: c.params.premiumEmployee,
      premiumFamily: c.params.premiumFamily,
      pricingBasis: c.params.pricingBasis ?? 'flat_by_type',
      ...(c.params.ageBandRates ? { ageBandRates: c.params.ageBandRates } : {}),
    });
  }
  for (const i of insured) {
    if (i.status !== 'active') continue;
    const p = policyById.get(i.policyId);
    const facts = { id: i.id, program: p?.program ?? 'standard', from: p?.startDate ?? i.insuredFrom, relation: i.relation, ...(i.contractId ? { contractId: i.contractId } : {}) };
    refs.insuredByPinfl.set(i.pinfl, facts);
    if (i.externalCertificateNumber) refs.insuredByCertificate.set(i.externalCertificateNumber.toUpperCase(), facts);
    if (i.phone) refs.phones.add(i.phone);
    for (const cat of Object.keys(i.migratedUsed ?? {})) refs.limits.add(`${i.id}:${cat}`);
  }
  for (const c of claims) if (c.externalNumber) refs.claimNumbers.add(c.externalNumber.toUpperCase());
  for (const i of invoices) if (i.externalNumber) refs.invoiceNumbers.add(i.externalNumber.toUpperCase());
  for (const a of assistances) refs.assistances.set(a.name.toLowerCase(), a.id);
  return refs;
}

/** Dry run of the files of the batch up to `upTo` (inclusive), against the database now. */
export async function validateFiles(ctx: BaseCtx, b: MigrationBatchRow, upTo?: MigrationStep, P?: ParamsView): Promise<BatchResults> {
  const params = P ?? (await loadParams(ctx));
  const last = upTo ? MIGRATION_STEPS.indexOf(upTo) : MIGRATION_STEPS.length - 1;
  const files: Partial<Record<MigrationStep, Record<string, string>[]>> = {};
  MIGRATION_STEPS.forEach((s, k) => {
    const f = b.files[s];
    if (k <= last && f && b.steps[s]?.status !== 'skipped') files[s] = f.rows;
  });
  // The «Клиенты» parameters now: contracts below the minimum or of a form not allowed are warnings.
  return validateBatch({ migrationDate: b.migrationDate, files }, await dbRefs(ctx), groupRulesOf(params.paramValues()));
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

async function rowsOf(ctx: BaseCtx, b: MigrationBatchRow): Promise<number> {
  if (b.status === 'applied' || b.status === 'rolled_back') {
    const a = b.applied;
    if (!a) return 0;
    return a.clientIds.length + a.contractIds.length + a.insuredIds.length + a.claimIds.length + a.invoiceIds.length + a.limitsCount;
  }
  return rowsToWrite(await validateFiles(ctx, b));
}

export async function batchSummary(ctx: BaseCtx, b: MigrationBatchRow): Promise<MigrationBatchSummary> {
  return {
    id: b.id,
    seq: b.seq,
    kind: b.kind,
    status: b.status,
    migrationDate: b.migrationDate,
    createdAt: b.createdAt,
    createdById: b.createdById,
    createdByName: b.createdByName,
    rows: await rowsOf(ctx, b),
    submittedAt: b.submittedAt,
    decidedAt: b.decidedAt,
    decidedByName: b.decidedByName,
  };
}

const mineOf = (b: MigrationBatchRow) => (m?: MigrationMark) => m?.batchId === b.id;

async function loadedOf(ctx: BaseCtx, b: MigrationBatchRow) {
  const r = ctx.repos;
  const mine = mineOf(b);
  const allInsured = await r.insured.list();
  const insured = allInsured.filter((i) => mine(i.migration));
  const limitsUsed =
    insured.reduce((s, i) => s + Object.values(i.migratedUsed ?? {}).reduce((x, y) => x + (y ?? 0), 0), 0) +
    (b.applied?.limitsOnExisting ?? []).reduce((s, l) => {
      const person = allInsured.find((i) => i.id === l.insuredId);
      return s + (Object.keys(l.used) as LimitCategory[]).reduce((x, cat) => x + (person?.migratedUsed?.[cat] ?? 0), 0);
    }, 0);
  return loadedTotals({
    clients: (await r.clients.list()).filter((c) => mine(c.migration)).length,
    contracts: (await r.contracts.list()).filter((c) => mine(c.migration)).map((c) => ({ total: c.params.total })),
    insured: insured.length,
    limitsUsed,
    claims: (await r.claims.list()).filter((c) => mine(c.migration)).map((c) => ({ reserve: currentReserve(c) })),
    invoices: (await r.invoices.list()).filter((i) => mine(i.migration)).map((i) => ({ amount: i.amount, paid: i.paid ?? 0 })),
  });
}

/**
 * Per-contract premium check: before the load from the dry run, after it from the premiums stored on the
 * batch's insured persons (a rolled back batch keeps the figures it had when applied).
 */
async function contractPremiumsOf(ctx: BaseCtx, b: MigrationBatchRow, res: BatchResults | null): Promise<MigrationContractPremium[]> {
  if (res) return res.contractPremiums ?? [];
  if (b.status !== 'applied') return b.contractPremiums ?? [];
  const contracts = await ctx.repos.contracts.list();
  const insured = await ctx.repos.insured.list();
  return (b.contractPremiums ?? []).map((x) => {
    const c = contracts.find((y) => y.migration?.batchId === b.id && y.externalNumber === x.oldNumber);
    if (!c) return x;
    const persons = insured.filter((i) => i.contractId === c.id && i.migration?.batchId === b.id && i.migratedPremium).map((i) => ({ premium: i.migratedPremium!.amount, source: i.migratedPremium!.source }));
    return contractPremiumCheck({ oldNumber: x.oldNumber, number: c.number, total: c.params.total }, persons);
  });
}

export async function batchView(ctx: BaseCtx, b: MigrationBatchRow, user: SessionUser): Promise<MigrationBatchView> {
  const res = b.status === 'draft' || b.status === 'pending_approval' || b.status === 'rejected' ? await validateFiles(ctx, b) : null;
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
  // What the batch loaded and what was done with it since lie in tables the admin's role does not read (contracts,
  // claims, invoices of every client): the reconciliation, the list and the rollback blockers are the system's.
  const sys = asSystem(ctx, 'portfolio transfer: reconciliation, contracts and rollback blockers of the batch');
  const view: MigrationBatchView = {
    ...(await batchSummary(ctx, b)),
    steps,
    rejectReason: b.rejectReason,
    appliedAt: b.appliedAt,
    rolledBackAt: b.rolledBackAt,
    rolledBackByName: b.rolledBackByName,
    rollbackReason: b.rollbackReason,
    canApprove: b.status === 'pending_approval' && can(user, 'migration.approve', { createdById: b.createdById }),
    isAuthor: b.createdById === user.id,
    reconciliation: reconcile(forRecon, applied ? await loadedOf(sys, b) : null),
    contractPremiums: await contractPremiumsOf(sys, b, res && b.steps.insured?.status !== 'skipped' && b.files.insured ? res : null),
    contracts: (await sys.repos.contracts.list())
      .filter((c) => c.migration?.batchId === b.id)
      .map((c) => ({ id: c.id, number: c.number, externalNumber: c.externalNumber ?? '', clientName: c.clientName })),
  };
  if (b.status === 'applied') {
    const blockers = await rollbackBlockers(sys, b);
    view.rollback = { allowed: blockers.length === 0, blockers: blockers.slice(0, 50) };
  }
  return view;
}

// ---------------------------------------------------------------- apply

const MIGRATED_BY = (b: MigrationBatchRow, at: string): MigrationMark => ({ batchId: b.id, at, byName: b.createdByName });

/** The mark with the rules for new contracts the record does not meet (a new object: marks are not shared). */
function withWarnings(mark: MigrationMark, extra?: { warnings?: MigrationWarning[]; group?: MigrationMark['group'] }): MigrationMark {
  const warnings = [...new Set([...(mark.warnings ?? []), ...(extra?.warnings ?? [])])];
  const group = extra?.group ?? mark.group;
  return { batchId: mark.batchId, at: mark.at, byName: mark.byName, ...(warnings.length ? { warnings } : {}), ...(group ? { group } : {}) };
}

async function managerOf(ctx: BaseCtx, fallback: { id: UUID; name: string }): Promise<{ id: UUID; name: string }> {
  const s = await ctx.repos.staff.first({ where: { active: true, role: 'sales_manager' } });
  return s ? { id: s.id, name: s.fullName } : fallback;
}

/**
 * Every reference of the batch resolves (rows of the batch that will be created, records of the system that
 * exist): checked before anything is written, so a failure leaves the database as it was.
 */
async function planCheck(ctx: BaseCtx, res: BatchResults): Promise<void> {
  const r = ctx.repos;
  const stale = () => conflict('srv.migration.stale');
  const clientRows = new Set((res.clients?.valid ?? []).map((v) => v.row));
  const contractRows = new Set<number>();
  for (const v of res.contracts?.valid ?? []) {
    const ref = v.ref.client;
    if ('batch' in ref ? !clientRows.has(ref.batch) : !(await r.clients.get(ref.db))) throw stale();
    contractRows.add(v.row);
  }
  const contractOk = async (ref: MigrationRef): Promise<boolean> => {
    if ('batch' in ref) return contractRows.has(ref.batch);
    const c = await r.contracts.get(ref.db);
    if (!c || !c.policyId) return false;
    return !!(await r.policies.get(c.policyId)) && !!(await r.clients.get(c.clientId));
  };
  const insuredRows = new Set<number>();
  for (const v of [...(res.insured?.valid ?? [])].sort((a, b) => (a.data.relation === 'employee' ? 0 : 1) - (b.data.relation === 'employee' ? 0 : 1))) {
    if (!(await contractOk(v.ref.contract))) throw stale();
    const p = v.ref.principal;
    const principal = p ? ('batch' in p ? insuredRows.has(p.batch) : !!(await r.insured.get(p.db))) : false;
    if (v.data.relation !== 'employee' && !principal) throw stale();
    insuredRows.add(v.row);
  }
  const personOk = async (ref: MigrationRef) => ('batch' in ref ? insuredRows.has(ref.batch) : !!(await r.insured.get(ref.db)));
  for (const v of res.limits?.valid ?? []) if (!(await personOk(v.ref.insured))) throw stale();
  for (const v of res.claims?.valid ?? []) if (!(await personOk(v.ref.insured))) throw stale();
  for (const v of res.invoices?.valid ?? []) if (!(await contractOk(v.ref.contract))) throw stale();
}

/**
 * Writes the batch to the system and saves the batch. The batch must have been validated just before
 * (`res`). All-or-nothing: see the note at the top of the file.
 */
export async function applyBatch(person: BaseCtx, b: MigrationBatchRow, res: BatchResults, approver: SessionUser): Promise<void> {
  // The second admin approved (checked by the caller): the mass write of the transfer is the system's.
  const ctx = asSystem(person, 'portfolio transfer: the approved batch is written into every table');
  await planCheck(ctx, res);
  const r = ctx.repos;
  const P = await loadParams(ctx);
  const at = tzIso(ctx.now());
  const mark = MIGRATED_BY(b, at);
  const rules = groupRulesOf(P.paramValues());
  const author = await r.staff.get(b.createdById);
  const manager = await managerOf(ctx, { id: b.createdById, name: b.createdByName });
  const signatory = (await r.staff.list({ where: { active: true } })).find((s) => s.signatory?.canSign) ?? author;
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
  // Clients of the system the batch touches, loaded once (a client of several contracts sees earlier changes).
  const clientById = new Map<UUID, ClientRow>();
  for (const v of res.clients?.valid ?? []) {
    const row = v.data;
    const client: ClientRow = {
      id: randomId(),
      legalForm: row.legalForm,
      name: row.name,
      inn: row.stir,
      status: 'draft',
      managerId: manager.id,
      managerName: manager.name,
      hrContact: { name: row.hrName, phone: row.hrPhone, email: row.hrEmail },
      premium: 0,
      lossRatio: null,
      createdAt: at,
      requisites: { bank: row.bank, account: row.account, mfo: row.mfo, director: row.director, directorBasis: row.directorBasis ?? 'Устав', ...(row.address ? { address: row.address } : {}) },
      migration: { ...mark, ...(legalFormAllowed(row.legalForm, rules) ? {} : { warnings: ['form_not_allowed' as const] }) },
    };
    await r.clients.insert(client, { at: 'start' });
    clientByRow.set(v.row, client);
    clientById.set(client.id, client);
    applied.clientIds.push(client.id);
  }
  const clientOf = async (ref: MigrationRef): Promise<ClientRow> => {
    if ('batch' in ref) {
      const c = clientByRow.get(ref.batch);
      if (!c) throw conflict('srv.migration.stale');
      return c;
    }
    let c = clientById.get(ref.db);
    if (!c) {
      const loaded = await r.clients.get(ref.db);
      if (!loaded) throw conflict('srv.migration.stale');
      clientById.set(loaded.id, loaded);
      c = loaded;
    }
    return c;
  };

  // ---- contracts in force, with a deal, a policy and the client's documents
  const contractByRow = new Map<number, { c: Contract; p: Policy; client: ClientRow }>();
  const insuredRows = res.insured?.valid ?? [];
  for (const v of res.contracts?.valid ?? []) {
    const row = v.data;
    const client = await clientOf(v.ref.client);
    const members = insuredRows.filter((x) => 'batch' in x.ref.contract && x.ref.contract.batch === v.row);
    // A row per person: employees and family members are counted separately.
    const family = members.filter((x) => x.data.relation !== 'employee').length;
    const employees = members.length - family;
    const year = new Date(ctx.now()).getFullYear();
    const contractSeq = await r.seq.next('contract');
    const dealSeq = await r.seq.next('deal');
    const deal: Deal = { id: randomId(), number: dealNumber(year, dealSeq, P.numbering()), clientId: client.id, type: 'new', stage: 'active', ownerId: manager.id, expectedStart: row.startDate, createdAt: at, updatedAt: at };
    await r.deals.insert(deal, { at: 'start' });
    applied.dealIds.push(deal.id);
    // Tariff for later changes of the list: the premiums by type of the file, else the program's base tariff.
    const base = defaultTariff(row.program);
    const premiumEmployee = row.premium_employee ?? base.employee;
    const premiumFamily = row.premium_family ?? base.family;
    const c: Contract = {
      id: randomId(),
      number: contractNumber(year, contractSeq, P.numbering()),
      dealId: deal.id,
      clientId: client.id,
      clientName: client.name,
      version: 1,
      templateId: 'contract',
      templateVersion: DOC_TEMPLATES.contract.version,
      params: {
        startDate: row.startDate,
        endDate: row.endDate,
        program: row.program,
        premiumEmployee,
        premiumFamily,
        employees,
        familyMembers: family,
        total: row.premium,
        // Inclusions during the term follow the contract terms of the file (by type unless age_banded with a table).
        pricingBasis: row.pricing_basis,
        ...(row.age_bands ? { ageBandRates: row.age_bands } : {}),
        paymentFrequency: row.paymentFrequency,
        paymentSchedule: buildPaymentSchedule(row.premium, row.startDate, row.paymentFrequency),
        activationRule: 'on_start_date',
        migSignatoryId: signatory?.id ?? b.createdById,
        clientSignatory: { name: client.requisites?.director ?? client.hrContact.name, position: 'Директор', basis: client.requisites?.directorBasis ?? 'Устав' },
        assistanceId: v.ref.assistanceId,
      },
      clauseOverrides: [],
      status: 'active',
      signing: { paperOriginal: { required: false } },
      createdAt: at,
      versions: [{ version: 1, at, byName: b.createdByName, changes: `Перенесён из старой системы: старый № ${row.oldNumber}, подтвердил ${approver.displayName}` }],
      activatedAt: at,
      insuredCount: members.length,
      externalNumber: row.oldNumber,
      migration: withWarnings(mark, res.groupWarnings?.get(v.row)),
    };
    // A client of the batch carries the warnings of its transferred contracts too.
    if (client.migration?.batchId === b.id) client.migration = withWarnings(client.migration, { warnings: c.migration?.warnings ?? [] });
    const policy: Policy = {
      id: randomId(),
      number: await nextPolicyNumber(ctx, Number(row.startDate.slice(0, 4)), P),
      clientId: client.id,
      clientName: client.name,
      clientLegalForm: client.legalForm,
      program: row.program,
      startDate: row.startDate,
      endDate: row.endDate,
      status: 'active',
      premium: row.premium,
      insuredCount: 0,
      tariff: { employee: premiumEmployee, family: premiumFamily },
      familyCount: 0,
      assistanceId: v.ref.assistanceId,
      contractId: c.id,
    };
    c.policyId = policy.id;
    await r.contracts.insert(c, { at: 'start' });
    await r.policies.insert(policy, { at: 'start' });
    await r.assignments.insert({ policyId: policy.id, assistanceId: v.ref.assistanceId, from: row.startDate, setById: b.createdById, setAt: at });
    applied.contractIds.push(c.id);
    applied.policyIds.push(policy.id);
    // The client's current policy switches to the transferred one unless the client already has one in force.
    const isNew = client.migration?.batchId === b.id;
    const current = client.activePolicyId ? await r.policies.get(client.activePolicyId) : null;
    if (isNew || !current || current.status !== 'active') {
      if (!isNew && !applied.clientsBefore.some((x) => x.id === client.id))
        applied.clientsBefore.push({ id: client.id, fields: { activePolicyId: client.activePolicyId, status: client.status, program: client.program, premium: client.premium, renewalDate: client.renewalDate, assistanceId: client.assistanceId } });
      client.activePolicyId = policy.id;
      client.status = 'active';
      client.program = row.program;
      client.premium = row.premium;
      client.renewalDate = row.endDate;
      client.assistanceId = v.ref.assistanceId;
    }
    await r.clients.update(client.id, {
      migration: client.migration,
      activePolicyId: client.activePolicyId,
      status: client.status,
      program: client.program,
      premium: client.premium,
      renewalDate: client.renewalDate,
      assistanceId: client.assistanceId,
    });
    const docs = [
      { id: randomId(), clientId: client.id, title: `Договор ДМС ${c.number} (старый № ${row.oldNumber})`, kind: 'contract' as const, createdAt: at.slice(0, 10) },
      { id: randomId(), clientId: client.id, title: `Полис ${policy.number}`, kind: 'policy' as const, createdAt: at.slice(0, 10) },
    ];
    await r.documents.insertMany(docs, { at: 'start' });
    applied.documentIds.push(...docs.map((x) => x.id));
    await dealEvent(ctx, deal.id, b.createdByName, `Договор перенесён из старой системы: старый № ${row.oldNumber}, новый № ${c.number}, полис ${policy.number}`);
    contractByRow.set(v.row, { c, p: policy, client });
  }
  const contractOf = async (ref: MigrationRef): Promise<{ c: Contract; p: Policy; client: ClientRow }> => {
    if ('batch' in ref) {
      const x = contractByRow.get(ref.batch);
      if (!x) throw conflict('srv.migration.stale');
      return x;
    }
    const c = await r.contracts.get(ref.db);
    const p = c?.policyId ? await r.policies.get(c.policyId) : null;
    const client = c ? await r.clients.get(c.clientId) : null;
    if (!c || !p || !client) throw conflict('srv.migration.stale');
    return { c, p, client };
  };

  // ---- insured persons with new certificates
  const insuredByRow = new Map<number, InsuredRow>();
  // Persons of the system the batch touches (limits on existing persons), loaded once.
  const insuredById = new Map<UUID, InsuredRow>();
  // Employees first: a family member is created under the employee (a row of the batch or a person in the system).
  for (const v of [...insuredRows].sort((a, b) => (a.data.relation === 'employee' ? 0 : 1) - (b.data.relation === 'employee' ? 0 : 1))) {
    const row = v.data;
    const { c, p, client } = await contractOf(v.ref.contract);
    const pr = v.ref.principal;
    const principal = pr ? ('batch' in pr ? insuredByRow.get(pr.batch) : ((await r.insured.get(pr.db)) ?? undefined)) : undefined;
    if (row.relation !== 'employee' && !principal) throw conflict('srv.migration.stale');
    const person = await createInsured(
      ctx,
      client,
      p,
      { fullName: row.fullName, position: row.position ?? (row.relation === 'employee' ? 'Сотрудник' : ''), birthDate: row.birthDate, pinfl: row.pinfl, phone: row.phone ?? '', relation: row.relation, ...(principal ? { principalId: principal.id } : {}) },
      row.inclusionDate,
      row.phone ? 'invited' : 'not_invited',
    );
    person.contractId = c.id;
    // The person is counted: certificates of the contract are numbered from 1.
    person.certificateNumber = certificateNumber(c.number, (await r.insured.count({ contractId: c.id })) + 1, P.numbering());
    person.externalCertificateNumber = row.oldCertificate;
    person.migratedPremium = { amount: v.ref.premium, source: v.ref.premiumSource };
    person.migration = mark;
    person.updatedAt = at;
    await r.insured.update(person.id, {
      contractId: person.contractId,
      certificateNumber: person.certificateNumber,
      externalCertificateNumber: person.externalCertificateNumber,
      migratedPremium: person.migratedPremium,
      migration: person.migration,
      updatedAt: person.updatedAt,
    });
    if (row.phone) await r.smsOutbox.insert({ at, insuredId: person.id, text: `Ваш полис ДМС перенесён в новую систему МИГ. Сертификат ${person.certificateNumber}. Скачайте приложение MIG ДМС.` }, { at: 'start' });
    insuredByRow.set(v.row, person);
    insuredById.set(person.id, person);
    applied.insuredIds.push(person.id);
  }
  for (const id of applied.policyIds) {
    const p = (await r.policies.get(id))!;
    await refreshPolicyTotals(ctx, p);
  }
  const personOf = async (ref: MigrationRef): Promise<InsuredRow> => {
    if ('batch' in ref) {
      const i = insuredByRow.get(ref.batch);
      if (!i) throw conflict('srv.migration.stale');
      return i;
    }
    let i = insuredById.get(ref.db);
    if (!i) {
      const loaded = await r.insured.get(ref.db);
      if (!loaded) throw conflict('srv.migration.stale');
      insuredById.set(loaded.id, loaded);
      i = loaded;
    }
    return i;
  };

  // ---- used limits as of the migration date
  for (const v of res.limits?.valid ?? []) {
    const person = await personOf(v.ref.insured);
    const cat = v.data.category as LimitCategory;
    person.migratedUsed = { ...person.migratedUsed, [cat]: v.data.usedAmount };
    await r.insured.update(person.id, { migratedUsed: person.migratedUsed });
    applied.limitsCount += 1;
    if ('db' in v.ref.insured) {
      const entry = applied.limitsOnExisting.find((x) => x.insuredId === person.id);
      if (entry) entry.used[cat] = v.data.usedAmount;
      else applied.limitsOnExisting.push({ insuredId: person.id, used: { [cat]: v.data.usedAmount } });
    }
  }

  // ---- open claims with reserves
  for (const v of res.claims?.valid ?? []) {
    const row = v.data;
    const person = await personOf(v.ref.insured);
    const history: ClaimEvent[] = [{ at, actorName: b.createdByName, to: 'new', comment: `Перенесён из старой системы: старый № ${row.oldNumber}` }];
    if (row.status === 'review' || row.status === 'medical_review') history.push({ at, actorName: b.createdByName, from: 'new', to: 'review' });
    if (row.status === 'medical_review') history.push({ at, actorName: b.createdByName, from: 'review', to: 'medical_review' });
    const claim: ClaimRow = {
      id: randomId(),
      number: await nextClaimNumber(ctx, P),
      insuredId: person.id,
      insuredName: person.fullName,
      clientId: person.clientId,
      clientName: person.clientName,
      category: row.category,
      source: 'operator',
      amountClaimed: row.amountClaimed,
      providerName: row.provider,
      serviceDate: row.serviceDate,
      status: row.status,
      slaDueAt: tzIso(ctx.now() + 5 * DAY),
      createdAt: at,
      updatedAt: at,
      attachments: [],
      history,
      handledBy: 'mig',
      externalNumber: row.oldNumber,
      migration: mark,
      ...(row.reserve !== row.amountClaimed ? { reserveHistory: [{ at, byName: b.createdByName, from: row.amountClaimed, to: row.reserve, reason: `Резерв на дату переноса ${b.migrationDate.split('-').reverse().join('.')}` }] } : {}),
    };
    await r.claims.insert(claim, { at: 'start' });
    applied.claimIds.push(claim.id);
  }

  // ---- unpaid invoices
  const today = isoDay(ctx.now());
  for (const v of res.invoices?.valid ?? []) {
    const row = v.data;
    const { c } = await contractOf(v.ref.contract);
    const inv: Invoice = refreshInvoice(
      {
        id: randomId(),
        clientId: c.clientId,
        number: await nextInvoiceNumber(ctx, P),
        amount: row.amount,
        issuedAt: row.issuedAt,
        dueDate: row.dueDate ?? addDays(row.issuedAt, 10),
        status: 'unpaid',
        contractId: c.id,
        paid: row.paid,
        externalNumber: row.oldNumber,
        migration: mark,
      },
      today,
    );
    await r.invoices.insert(inv, { at: 'start' });
    applied.invoiceIds.push(inv.id);
  }

  await syncAssistance(ctx);
  b.applied = applied;
  b.status = 'applied';
  b.appliedAt = at;
  b.decidedAt = at;
  b.decidedById = approver.id;
  b.decidedByName = approver.displayName;
  const batchContracts = await r.contracts.list({ where: { id: { in: applied.contractIds } } });
  b.contractPremiums = (res.contractPremiums ?? []).map((x) => {
    const c = batchContracts.find((y) => y.migration?.batchId === b.id && y.externalNumber === x.oldNumber);
    return c ? { ...x, number: c.number } : x;
  });
  b.totals = Object.fromEntries(
    MIGRATION_STEPS.flatMap((s) => {
      const st = res[s];
      return st ? [[s, { fileTotals: st.fileTotals, validTotals: st.validTotals, errorRows: st.errorRows, warningRows: st.warningRows, issues: st.issues.slice(0, MAX_ISSUES) }]] : [];
    }),
  );
  // The files are no longer needed: what was written lives in the system, the report in `totals`.
  b.files = Object.fromEntries(Object.entries(b.files).map(([s, f]) => [s, { rows: [], uploadedAt: f.uploadedAt, uploadedByName: f.uploadedByName }]));
  await audit(ctx, approver, 'migration_applied', {
    targetType: 'migration',
    targetId: b.id,
    targetLabel: `Пакет № ${b.seq}: клиентов ${applied.clientIds.length}, договоров ${applied.contractIds.length}, застрахованных ${applied.insuredIds.length}, убытков ${applied.claimIds.length}, счетов ${applied.invoiceIds.length}`,
    reason: `Подготовил ${b.createdByName}`,
  });
  applied.auditMark = (await r.audit.first())!.id;
  await r.migrationBatches.put(b);
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
export async function rollbackBlockers(person: BaseCtx, b: MigrationBatchRow): Promise<MigrationRollbackBlocker[]> {
  const a = b.applied;
  if (!a) return [];
  const ctx = asSystem(person, 'portfolio transfer: what happened to the transferred records since (rollback blockers)');
  const r = ctx.repos;
  const clients = new Set(a.clientIds);
  const contracts = new Set(a.contractIds);
  const policies = new Set(a.policyIds);
  const insured = new Set(a.insuredIds);
  const claims = new Set(a.claimIds);
  const invoices = new Set(a.invoiceIds);
  const deals = new Set(a.dealIds);
  const all = new Set([...clients, ...contracts, ...policies, ...insured, ...claims, ...invoices]);
  const out: MigrationRollbackBlocker[] = [];
  const auditRows = await r.audit.list();
  const markIdx = auditRows.findIndex((e) => e.id === a.auditMark);
  const newer = markIdx >= 0 ? auditRows.slice(0, markIdx) : auditRows.filter((e) => !!b.appliedAt && e.at > b.appliedAt);
  for (const e of newer) {
    if (!e.targetId || !all.has(e.targetId) || READ_ONLY.has(e.action) || e.action.startsWith('migration_')) continue;
    out.push({ kind: 'audit', label: e.targetLabel ?? '', at: e.at, actorName: e.actorName, action: e.action });
  }
  const allInsured = await r.insured.list();
  const insuredLabel = (id: UUID) => allInsured.find((i) => i.id === id)?.certificateNumber ?? id.slice(0, 8);
  for (const c of await r.claims.list()) if (insured.has(c.insuredId) && !claims.has(c.id)) out.push({ kind: 'claim', label: c.number, at: c.createdAt });
  for (const p of await r.payments.list()) if ((p.contractId && contracts.has(p.contractId)) || (p.invoiceId && invoices.has(p.invoiceId))) out.push({ kind: 'payment', label: p.purpose, at: p.paidAt, actorName: p.recordedByName });
  for (const e of await r.endorsements.list()) if (contracts.has(e.contractId)) out.push({ kind: 'endorsement', label: e.number, at: e.createdAt });
  for (const x of await r.changeRequests.list()) if (contracts.has(x.contractId)) out.push({ kind: 'change_request', label: x.description ?? x.type, at: x.createdAt, actorName: x.requestedBy.name });
  for (const x of await r.policyChanges.list()) if (policies.has(x.policyId) || clients.has(x.clientId)) out.push({ kind: 'policy_change', label: x.policyNumber, at: x.requestedAt, actorName: x.requestedByName });
  for (const x of await r.appointments.list()) if (insured.has(x.insuredId)) out.push({ kind: 'appointment', label: insuredLabel(x.insuredId), at: x.createdAt });
  for (const g of await r.guarantees.list()) if (insured.has(g.insuredId)) out.push({ kind: 'guarantee', label: g.number, at: g.createdAt });
  for (const v of await r.visits.list()) if (insured.has(v.insuredId)) out.push({ kind: 'visit', label: insuredLabel(v.insuredId), at: v.openedAt });
  for (const i of await r.invoices.list()) if (i.contractId && contracts.has(i.contractId) && !invoices.has(i.id)) out.push({ kind: 'invoice', label: i.number, at: i.issuedAt });
  for (const c of await r.contracts.list()) if (clients.has(c.clientId) && !contracts.has(c.id)) out.push({ kind: 'contract', label: c.number, at: c.createdAt });
  for (const x of await r.deals.list()) if (clients.has(x.clientId) && !deals.has(x.id)) out.push({ kind: 'deal', label: x.number, at: x.createdAt });
  for (const k of await r.kp.list()) if (clients.has(k.clientId)) out.push({ kind: 'kp', label: k.number, at: k.createdAt });
  for (const i of allInsured) if (policies.has(i.policyId) && !insured.has(i.id)) out.push({ kind: 'insured', label: i.certificateNumber ?? insuredLabel(i.id), at: i.addedAt });
  for (const i of allInsured) if (insured.has(i.id) && i.consentGivenAt) out.push({ kind: 'consent', label: insuredLabel(i.id), at: i.consentGivenAt });
  for (const m of await r.chat.list()) if (insured.has(m.insuredId)) out.push({ kind: 'chat', label: insuredLabel(m.insuredId), at: m.at });
  for (const f of await r.files.list()) if ((f.contractId && contracts.has(f.contractId)) || (f.clientId && clients.has(f.clientId)) || (f.insuredId && insured.has(f.insuredId))) out.push({ kind: 'file', label: f.fileName ?? '' });
  for (const x of await r.limitRequests.list()) if (policies.has(x.policyId)) out.push({ kind: 'limit_request', label: x.policyNumber, at: x.createdAt, actorName: x.requestedByName });
  for (const c of await r.cases.list()) if (policies.has(c.policyId)) out.push({ kind: 'case', label: c.number, at: c.createdAt });
  return out;
}

/**
 * Removes everything the batch created, restores the clients and the limits of the persons it changed and
 * saves the batch. Every check (status, blockers) is done by the caller before: nothing here fails on the
 * data, so the rollback is all-or-nothing (on Postgres: one transaction, see the top of the file).
 */
/** The client fields a transfer may change and its rollback restores (`clientsBefore`). */
const RESTORED_CLIENT_FIELDS = ['activePolicyId', 'status', 'program', 'premium', 'renewalDate', 'assistanceId'] as const;

export async function rollbackBatch(person: BaseCtx, b: MigrationBatchRow, user: SessionUser, reason: string): Promise<void> {
  const a = b.applied;
  if (!a) throw conflict('srv.migration.notApplied');
  const ctx = asSystem(person, 'portfolio transfer: the rollback removes the batch from every table');
  const r = ctx.repos;
  const insuredIds = a.insuredIds;
  const userIds = (await r.insured.list({ where: { id: { in: insuredIds } } })).map((i) => i.userId);
  await r.claims.removeWhere({ id: { in: a.claimIds } });
  await r.invoices.removeWhere({ id: { in: a.invoiceIds } });
  await r.insured.removeWhere({ id: { in: insuredIds } });
  await r.smsOutbox.removeWhere({ insuredId: { in: insuredIds } });
  await r.cardTokens.removeWhere({ insuredId: { in: insuredIds } });
  await r.sessions.removeWhere({ userId: { in: userIds } });
  // Clients point at their active policy and policies at their client: the clients changed by the batch get their
  // fields back and the clients it created let go of its policies before those go (foreign keys in Postgres).
  for (const before of a.clientsBefore) {
    // The whole row is written back: a field that had no value before is restored as such (stored as JSON, such a
    // field is absent from `fields`, not `undefined`, so every restored field is named here).
    const c = await r.clients.get(before.id);
    if (c) await r.clients.put({ ...c, ...Object.fromEntries(RESTORED_CLIENT_FIELDS.map((k) => [k, before.fields[k]])) });
  }
  for (const c of await r.clients.list({ where: { id: { in: a.clientIds } } })) {
    const { activePolicyId: _active, ...rest } = c;
    if (_active) await r.clients.put(rest);
  }
  await r.policies.removeWhere({ id: { in: a.policyIds } });
  await r.assignments.removeWhere({ policyId: { in: a.policyIds } });
  await r.contracts.removeWhere({ id: { in: a.contractIds } });
  await r.deals.removeWhere({ id: { in: a.dealIds } });
  await r.dealEvents.removeWhere({ dealId: { in: a.dealIds } });
  await r.documents.removeWhere({ id: { in: a.documentIds } });
  await r.clients.removeWhere({ id: { in: a.clientIds } });
  for (const l of a.limitsOnExisting) {
    const person = await r.insured.get(l.insuredId);
    if (!person?.migratedUsed) continue;
    const used = { ...person.migratedUsed };
    for (const cat of Object.keys(l.used) as LimitCategory[]) delete used[cat];
    await r.insured.update(person.id, { migratedUsed: used });
  }
  await syncAssistance(ctx);
  const at = tzIso(ctx.now());
  b.status = 'rolled_back';
  b.rolledBackAt = at;
  b.rolledBackByName = user.displayName;
  b.rollbackReason = reason;
  await r.migrationBatches.put(b);
  await audit(ctx, user, 'migration_rolled_back', {
    targetType: 'migration',
    targetId: b.id,
    targetLabel: `Пакет № ${b.seq}: удалено клиентов ${a.clientIds.length}, договоров ${a.contractIds.length}, застрахованных ${a.insuredIds.length}, убытков ${a.claimIds.length}, счетов ${a.invoiceIds.length}`,
    reason,
  });
}
