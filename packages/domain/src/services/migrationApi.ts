/*
 * Transfer of the existing portfolio (/staff/admin/migration), the endpoints. Every request checks
 * `migration.manage`; applying a batch needs `migration.approve` by another administrator (four-eyes).
 * Uploading a file is a dry run: the rows are checked and kept in the batch, nothing reaches the business
 * tables until the batch is applied (services/migration.ts).
 */
import { msg } from '@mig/i18n';
import type { SessionUser, UUID } from '@mig/contracts';
import type { MigrationBatchSummary, MigrationBatchView, MigrationStep } from '@mig/contracts/migration';
import { can } from '../auth/permissions';
import { MIGRATION_STEPS, parseMigrationCsv, stepAvailable } from '../migration';
import { migrationBatchCreateSchema, migrationConfirmSchema, migrationManualSchema, migrationReasonSchema, migrationUploadSchema } from '../schemas/migration';
import { randomId } from '../lib/random';
import type { MigrationBatchRow } from '../store/db';
import { audit, conflict, DomainError, errorOf, forbidden, notFound, requirePermission, tzIso, validate, type AuthCtx } from './kernel';
import { checkScan, type ScanForm } from './contracts';
import { applyBatch, batchOf, batchSummary, batchView, rollbackBatch, rollbackBlockers, rowsToWrite, staleSteps, validateFiles } from './migration';

function admin(ctx: AuthCtx): SessionUser {
  requirePermission(ctx.user, 'migration.manage');
  return ctx.user;
}

function stepOf(s: unknown): MigrationStep {
  if (typeof s !== 'string' || !(MIGRATION_STEPS as readonly string[]).includes(s)) throw notFound();
  return s as MigrationStep;
}

/** Edits of a draft: only its author. */
async function draftOf(ctx: AuthCtx, id: UUID): Promise<MigrationBatchRow> {
  const b = await batchOf(ctx, id);
  if (b.createdById !== ctx.user.id) throw new DomainError(403, 'forbidden', 'srv.migration.authorOnly');
  if (b.status !== 'draft') throw conflict('srv.migration.notDraft');
  return b;
}

const label = (b: MigrationBatchRow, text: string) => `Пакет № ${b.seq}: ${text}`;
const STEP_RU: Record<MigrationStep, string> = { clients: 'клиенты', contracts: 'договоры', insured: 'застрахованные', limits: 'лимиты', claims: 'убытки', invoices: 'счета' };

const statusesOf = (b: MigrationBatchRow) => Object.fromEntries(MIGRATION_STEPS.map((s) => [s, b.steps[s]?.status]));

/** Steps whose rows changed since they were confirmed go back to «validated»; the batch back to a draft. */
function reopen(b: MigrationBatchRow, steps: MigrationStep[]): void {
  const from = Math.min(...steps.map((s) => MIGRATION_STEPS.indexOf(s)));
  for (const s of MIGRATION_STEPS.slice(from)) {
    if (b.steps[s]?.status === 'confirmed') b.steps[s] = { status: 'validated', excludeErrors: false };
  }
  b.status = 'draft';
  b.submittedAt = undefined;
}

/** Drops the files and states of the steps after `step` (they referred to its old rows). */
function dropLater(b: MigrationBatchRow, step: MigrationStep): void {
  for (const later of MIGRATION_STEPS.slice(MIGRATION_STEPS.indexOf(step) + 1)) {
    delete b.files[later];
    delete b.steps[later];
  }
}

async function newBatch(ctx: AuthCtx, kind: MigrationBatchRow['kind'], migrationDate: string, fill?: Partial<MigrationBatchRow>): Promise<MigrationBatchRow> {
  const b: MigrationBatchRow = {
    id: randomId(),
    seq: (await ctx.repos.migrationBatches.count()) + 1,
    kind,
    status: 'draft',
    migrationDate,
    createdAt: tzIso(ctx.now()),
    createdById: ctx.user.id,
    createdByName: ctx.user.displayName,
    files: {},
    steps: {},
    ...fill,
  };
  await ctx.repos.migrationBatches.insert(b, { at: 'start' });
  return b;
}

/** Saves a batch changed in place and returns its view. */
async function saved(ctx: AuthCtx, b: MigrationBatchRow): Promise<MigrationBatchView> {
  await ctx.repos.migrationBatches.put(b);
  return batchView(ctx, b, ctx.user);
}

// ---------------------------------------------------------------- endpoints

export async function listBatches(ctx: AuthCtx): Promise<{ items: MigrationBatchSummary[]; assistances: string[] }> {
  admin(ctx);
  const batches = await ctx.repos.migrationBatches.list({ where: { status: { ne: 'discarded' } } });
  const items: MigrationBatchSummary[] = [];
  for (const b of batches) items.push(await batchSummary(ctx, b));
  return { items, assistances: (await ctx.repos.assistances.list()).map((a) => a.name) };
}

/** 201 with the view of the new draft. */
export async function createBatch(ctx: AuthCtx, body: unknown): Promise<MigrationBatchView> {
  const user = admin(ctx);
  const { migrationDate } = validate(migrationBatchCreateSchema, body);
  const b = await newBatch(ctx, 'csv', migrationDate);
  return batchView(ctx, b, user);
}

export async function getBatch(ctx: AuthCtx, id: UUID): Promise<MigrationBatchView> {
  const user = admin(ctx);
  return batchView(ctx, await batchOf(ctx, id), user);
}

export async function discardBatch(ctx: AuthCtx, id: UUID): Promise<{ ok: true }> {
  admin(ctx);
  const b = await draftOf(ctx, id);
  await ctx.repos.migrationBatches.update(b.id, { status: 'discarded', files: {} });
  return { ok: true as const };
}

/** One file: upload and dry run (nothing is written). */
export async function uploadStep(ctx: AuthCtx, id: UUID, stepRaw: unknown, body: unknown): Promise<MigrationBatchView> {
  const user = admin(ctx);
  const b = await draftOf(ctx, id);
  const step = stepOf(stepRaw);
  if (!stepAvailable(statusesOf(b), step)) throw conflict('srv.migration.stepLocked');
  const { csv } = validate(migrationUploadSchema, body);
  const parsed = parseMigrationCsv(step, csv);
  if ('error' in parsed) throw errorOf(422, 'validation', parsed.error, { file: parsed.error });
  b.files[step] = { rows: parsed.rows, uploadedAt: tzIso(ctx.now()), uploadedByName: user.displayName };
  b.steps[step] = { status: 'validated', excludeErrors: false };
  // Later files referred to the old rows of this one: they are checked again from scratch.
  dropLater(b, step);
  await ctx.repos.migrationBatches.put(b);
  const r = (await validateFiles(ctx, b, step))[step]!;
  await audit(ctx, user, 'migration_validated', { targetType: 'migration', targetId: b.id, targetLabel: label(b, `${STEP_RU[step]}: строк ${r.total}, с ошибками ${r.errorRows}, с предупреждениями ${r.warningRows}`) });
  return batchView(ctx, b, user);
}

export async function confirmStep(ctx: AuthCtx, id: UUID, stepRaw: unknown, body: unknown): Promise<MigrationBatchView> {
  admin(ctx);
  const b = await draftOf(ctx, id);
  const step = stepOf(stepRaw);
  const { excludeErrors } = validate(migrationConfirmSchema, body);
  const st = b.steps[step];
  if (!st || (st.status !== 'validated' && st.status !== 'confirmed') || !b.files[step]) throw conflict('srv.migration.notValidated');
  if (!stepAvailable(statusesOf(b), step)) throw conflict('srv.migration.stepLocked');
  const r = (await validateFiles(ctx, b, step))[step]!;
  // Rows with errors are never written: the step is confirmed only when they are excluded explicitly.
  if (r.errorRows > 0 && !excludeErrors) throw conflict('srv.migration.hasErrors');
  b.steps[step] = { status: 'confirmed', excludeErrors: r.errorRows > 0 && excludeErrors, validRows: r.valid.map((v) => v.row) };
  return saved(ctx, b);
}

export async function skipStep(ctx: AuthCtx, id: UUID, stepRaw: unknown): Promise<MigrationBatchView> {
  admin(ctx);
  const b = await draftOf(ctx, id);
  const step = stepOf(stepRaw);
  if (!stepAvailable(statusesOf(b), step)) throw conflict('srv.migration.stepLocked');
  delete b.files[step];
  b.steps[step] = { status: 'skipped', excludeErrors: false };
  dropLater(b, step);
  return saved(ctx, b);
}

export async function submitBatch(ctx: AuthCtx, id: UUID): Promise<MigrationBatchView> {
  const user = admin(ctx);
  const b = await draftOf(ctx, id);
  if (!MIGRATION_STEPS.every((s) => b.steps[s]?.status === 'confirmed' || b.steps[s]?.status === 'skipped')) throw conflict('srv.migration.incomplete');
  const res = await validateFiles(ctx, b);
  const stale = staleSteps(b, res);
  if (stale.length) {
    // The reopened steps are saved although the request fails: the author sees what to confirm again.
    reopen(b, stale);
    await ctx.repos.migrationBatches.put(b);
    throw conflict('srv.migration.stale');
  }
  if (rowsToWrite(res) === 0) throw conflict('srv.migration.nothingToLoad');
  b.status = 'pending_approval';
  b.submittedAt = tzIso(ctx.now());
  await ctx.repos.migrationBatches.put(b);
  await audit(ctx, user, 'migration_submitted', { targetType: 'migration', targetId: b.id, targetLabel: label(b, `строк к загрузке ${rowsToWrite(res)}`) });
  return batchView(ctx, b, user);
}

/** Four-eyes approval: applies the batch (all-or-nothing, see services/migration.ts). */
export async function approveBatch(ctx: AuthCtx, id: UUID): Promise<MigrationBatchView> {
  const user = admin(ctx);
  const b = await batchOf(ctx, id);
  if (!can(user, 'migration.approve', { createdById: b.createdById })) throw new DomainError(403, 'forbidden', 'srv.migration.fourEyes');
  if (b.status !== 'pending_approval') throw conflict('srv.migration.notPending');
  // The system may have changed since the check (another batch, a new client): check again.
  const res = await validateFiles(ctx, b);
  const stale = staleSteps(b, res);
  if (stale.length) {
    reopen(b, stale);
    await ctx.repos.migrationBatches.put(b);
    throw conflict('srv.migration.stale');
  }
  await applyBatch(ctx, b, res, user);
  return batchView(ctx, b, user);
}

export async function rejectBatch(ctx: AuthCtx, id: UUID, body: unknown): Promise<MigrationBatchView> {
  const user = admin(ctx);
  const b = await batchOf(ctx, id);
  if (b.status !== 'pending_approval') throw conflict('srv.migration.notPending');
  // The author may withdraw own batch; anyone else needs the right to approve it.
  if (b.createdById !== user.id && !can(user, 'migration.approve', { createdById: b.createdById })) throw forbidden();
  const { reason } = validate(migrationReasonSchema, body);
  b.status = 'rejected';
  b.rejectReason = reason;
  b.decidedAt = tzIso(ctx.now());
  b.decidedById = user.id;
  b.decidedByName = user.displayName;
  await ctx.repos.migrationBatches.put(b);
  await audit(ctx, user, 'migration_rejected', { targetType: 'migration', targetId: b.id, targetLabel: label(b, b.createdById === user.id ? 'отозван автором' : 'отклонён'), reason });
  return batchView(ctx, b, user);
}

export async function rollback(ctx: AuthCtx, id: UUID, body: unknown): Promise<MigrationBatchView> {
  const user = admin(ctx);
  const b = await batchOf(ctx, id);
  if (b.status !== 'applied') throw conflict('srv.migration.notApplied');
  const { reason } = validate(migrationReasonSchema, body);
  const blockers = await rollbackBlockers(ctx, b);
  if (blockers.length) throw conflict('srv.migration.rollbackBlocked');
  await rollbackBatch(ctx, b, user, reason);
  return batchView(ctx, b, user);
}

/** Manual entry of one contract: a one-row batch with the same checks, waiting for the second admin. 201. */
export async function manualContract(ctx: AuthCtx, body: unknown): Promise<MigrationBatchView> {
  const user = admin(ctx);
  const { migrationDate, row } = validate(migrationManualSchema, body);
  const draft: MigrationBatchRow = { id: '', seq: 0, kind: 'manual', status: 'draft', migrationDate, createdAt: '', createdById: user.id, createdByName: user.displayName, files: { contracts: { rows: [row], uploadedAt: '', uploadedByName: '' } }, steps: {} };
  const r = (await validateFiles(ctx, draft)).contracts!;
  if (r.errorRows > 0) {
    const fields: Record<string, string> = {};
    for (const i of r.issues) if (i.level === 'error' && !fields[i.field]) fields[i.field] = i.message;
    throw new DomainError(422, 'validation', 'srv.migration.manualInvalid', { fields });
  }
  const at = tzIso(ctx.now());
  const b = await newBatch(ctx, 'manual', migrationDate, {
    files: { contracts: { rows: [row], uploadedAt: at, uploadedByName: user.displayName } },
    steps: {
      clients: { status: 'skipped', excludeErrors: false },
      contracts: { status: 'confirmed', excludeErrors: false, validRows: [2] },
      insured: { status: 'skipped', excludeErrors: false },
      limits: { status: 'skipped', excludeErrors: false },
      claims: { status: 'skipped', excludeErrors: false },
      invoices: { status: 'skipped', excludeErrors: false },
    },
    status: 'pending_approval',
    submittedAt: at,
  });
  await audit(ctx, user, 'migration_submitted', { targetType: 'migration', targetId: b.id, targetLabel: label(b, `договор вручную, старый № ${r.valid[0]!.data.oldNumber}`) });
  return batchView(ctx, b, user);
}

// ---------------------------------------------------------------- the signed scan of a transferred contract

/** The multipart form of a scan: the same as for signing (contracts.ts). */
export type { ScanForm };

export async function attachMigratedScan(ctx: AuthCtx, contractId: UUID, form: ScanForm | null) {
  const user = ctx.user;
  if (!can(user, 'contracts.read') || user.role === 'hr') throw forbidden();
  if (!can(user, 'contracts.verify_scan') && !can(user, 'contracts.draft')) throw forbidden();
  const c = await ctx.repos.contracts.get(contractId);
  if (!c) throw notFound();
  if (!c.migration) throw conflict('srv.migration.notMigrated');
  const { bytes, mime } = await checkScan(ctx, form);
  const fileId = randomId();
  if (c.migratedScan) await ctx.repos.files.remove(c.migratedScan.fileId);
  await ctx.repos.files.insert({ id: fileId, mime, bytes, clientId: c.clientId, contractId: c.id, fileName: `contract-scan.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}` });
  c.migratedScan = { fileId, uploadedAt: tzIso(ctx.now()), uploadedByName: user.displayName };
  c.versions.push({ version: c.version, at: c.migratedScan.uploadedAt, byName: user.displayName, changes: 'Приложен скан подписанного договора' });
  await ctx.repos.contracts.update(c.id, { migratedScan: c.migratedScan, versions: c.versions });
  await audit(ctx, user, 'migration_scan_attached', { targetType: 'contract', targetId: c.id, targetLabel: `${c.number} (старый № ${c.externalNumber ?? '—'})` });
  return { migratedScan: c.migratedScan, message: msg('migration.scanAttached') };
}
