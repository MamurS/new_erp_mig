/*
 * Transfer of the existing portfolio (/staff/admin/migration). Every request checks `migration.manage`;
 * applying a batch needs `migration.approve` by another administrator (four-eyes). Uploading a file is a
 * dry run: the rows are checked and kept in the batch, nothing reaches the business tables until the
 * batch is applied.
 */
import { http, HttpResponse } from 'msw';
import { msg } from '@mig/i18n';
import type { SessionUser } from '@mig/contracts';
import type { MigrationStep } from '@mig/contracts/migration';
import { can } from '@mig/domain/auth/permissions';
import { MIGRATION_STEPS, parseMigrationCsv, stepAvailable } from '@mig/domain/migration';
import { migrationBatchCreateSchema, migrationConfirmSchema, migrationManualSchema, migrationReasonSchema, migrationUploadSchema } from '@mig/domain/schemas/migration';
import { db, type Db, type MigrationBatchRow } from '../db';
import { API, audit, body, conflict, type Ctx, forbidden, HttpError, httpErrorOf, notFound, param, requirePermission, requireSession, route } from '../http';
import { randomId } from '@mig/seed/rng';
import { tzIso } from '@mig/seed/time';
import { applyBatch, batchOf, batchSummary, batchView, rollbackBatch, rollbackBlockers, rowsToWrite, staleSteps, validate } from '../migration-core';
import { readScan } from './contracts';

const BASE = `${API}/admin/migration`;

function admin(request: Request): SessionUser {
  const { user } = requireSession(request);
  requirePermission(user, 'migration.manage');
  return user;
}

function stepParam(ctx: Ctx): MigrationStep {
  const s = ctx.params.step;
  if (typeof s !== 'string' || !(MIGRATION_STEPS as readonly string[]).includes(s)) throw notFound();
  return s as MigrationStep;
}

/** Edits of a draft: only its author. */
function draftOf(d: Db, ctx: Ctx, user: SessionUser): MigrationBatchRow {
  const b = batchOf(d, param(ctx, 'id'));
  if (b.createdById !== user.id) throw new HttpError(403, 'forbidden', 'srv.migration.authorOnly');
  if (b.status !== 'draft') throw conflict('srv.migration.notDraft');
  return b;
}

const label = (b: MigrationBatchRow, text: string) => `Пакет № ${b.seq}: ${text}`;
const STEP_RU: Record<MigrationStep, string> = { clients: 'клиенты', contracts: 'договоры', insured: 'застрахованные', limits: 'лимиты', claims: 'убытки', invoices: 'счета' };

/** Steps whose rows changed since they were confirmed go back to «validated»; the batch back to a draft. */
function reopen(b: MigrationBatchRow, steps: MigrationStep[]): void {
  const from = Math.min(...steps.map((s) => MIGRATION_STEPS.indexOf(s)));
  for (const s of MIGRATION_STEPS.slice(from)) {
    if (b.steps[s]?.status === 'confirmed') b.steps[s] = { status: 'validated', excludeErrors: false };
  }
  b.status = 'draft';
  b.submittedAt = undefined;
}

function newBatch(d: Db, user: SessionUser, kind: MigrationBatchRow['kind'], migrationDate: string): MigrationBatchRow {
  const b: MigrationBatchRow = {
    id: randomId(),
    seq: d.migrationBatches.length + 1,
    kind,
    status: 'draft',
    migrationDate,
    createdAt: tzIso(Date.now()),
    createdById: user.id,
    createdByName: user.displayName,
    files: {},
    steps: {},
  };
  d.migrationBatches.unshift(b);
  return b;
}

export const migrationHandlers = [
  http.get(
    `${BASE}/batches`,
    route(({ request }) => {
      admin(request);
      const d = db();
      return {
        items: d.migrationBatches.filter((b) => b.status !== 'discarded').map((b) => batchSummary(d, b)),
        assistances: d.assistances.map((a) => a.name),
      };
    }),
  ),
  http.post(
    `${BASE}/batches`,
    route(async ({ request }) => {
      const user = admin(request);
      const { migrationDate } = await body(request, migrationBatchCreateSchema);
      const d = db();
      const b = newBatch(d, user, 'csv', migrationDate);
      return HttpResponse.json(batchView(d, b, user), { status: 201 });
    }),
  ),
  http.get(
    `${BASE}/batches/:id`,
    route((ctx) => {
      const user = admin(ctx.request);
      const d = db();
      return batchView(d, batchOf(d, param(ctx, 'id')), user);
    }),
  ),
  http.delete(
    `${BASE}/batches/:id`,
    route((ctx) => {
      const user = admin(ctx.request);
      const d = db();
      const b = draftOf(d, ctx, user);
      b.status = 'discarded';
      b.files = {};
      return { ok: true as const };
    }),
  ),
  // ---- one file: upload and dry run (nothing is written)
  http.post(
    `${BASE}/batches/:id/steps/:step`,
    route(async (ctx) => {
      const user = admin(ctx.request);
      const d = db();
      const b = draftOf(d, ctx, user);
      const step = stepParam(ctx);
      const statuses = Object.fromEntries(MIGRATION_STEPS.map((s) => [s, b.steps[s]?.status]));
      if (!stepAvailable(statuses, step)) throw conflict('srv.migration.stepLocked');
      const { csv } = await body(ctx.request, migrationUploadSchema);
      const parsed = parseMigrationCsv(step, csv);
      if ('error' in parsed) throw httpErrorOf(422, 'validation', parsed.error, { file: parsed.error });
      b.files[step] = { rows: parsed.rows, uploadedAt: tzIso(Date.now()), uploadedByName: user.displayName };
      b.steps[step] = { status: 'validated', excludeErrors: false };
      // Later files referred to the old rows of this one: they are checked again from scratch.
      for (const later of MIGRATION_STEPS.slice(MIGRATION_STEPS.indexOf(step) + 1)) {
        delete b.files[later];
        delete b.steps[later];
      }
      const r = validate(d, b, step)[step]!;
      audit(user, 'migration_validated', { targetType: 'migration', targetId: b.id, targetLabel: label(b, `${STEP_RU[step]}: строк ${r.total}, с ошибками ${r.errorRows}, с предупреждениями ${r.warningRows}`) });
      return batchView(d, b, user);
    }),
  ),
  http.post(
    `${BASE}/batches/:id/steps/:step/confirm`,
    route(async (ctx) => {
      const user = admin(ctx.request);
      const d = db();
      const b = draftOf(d, ctx, user);
      const step = stepParam(ctx);
      const { excludeErrors } = await body(ctx.request, migrationConfirmSchema);
      const st = b.steps[step];
      if (!st || (st.status !== 'validated' && st.status !== 'confirmed') || !b.files[step]) throw conflict('srv.migration.notValidated');
      const statuses = Object.fromEntries(MIGRATION_STEPS.map((s) => [s, b.steps[s]?.status]));
      if (!stepAvailable(statuses, step)) throw conflict('srv.migration.stepLocked');
      const r = validate(d, b, step)[step]!;
      // Rows with errors are never written: the step is confirmed only when they are excluded explicitly.
      if (r.errorRows > 0 && !excludeErrors) throw conflict('srv.migration.hasErrors');
      b.steps[step] = { status: 'confirmed', excludeErrors: r.errorRows > 0 && excludeErrors, validRows: r.valid.map((v) => v.row) };
      return batchView(d, b, user);
    }),
  ),
  http.post(
    `${BASE}/batches/:id/steps/:step/skip`,
    route((ctx) => {
      const user = admin(ctx.request);
      const d = db();
      const b = draftOf(d, ctx, user);
      const step = stepParam(ctx);
      const statuses = Object.fromEntries(MIGRATION_STEPS.map((s) => [s, b.steps[s]?.status]));
      if (!stepAvailable(statuses, step)) throw conflict('srv.migration.stepLocked');
      delete b.files[step];
      b.steps[step] = { status: 'skipped', excludeErrors: false };
      for (const later of MIGRATION_STEPS.slice(MIGRATION_STEPS.indexOf(step) + 1)) {
        delete b.files[later];
        delete b.steps[later];
      }
      return batchView(d, b, user);
    }),
  ),
  http.post(
    `${BASE}/batches/:id/submit`,
    route((ctx) => {
      const user = admin(ctx.request);
      const d = db();
      const b = draftOf(d, ctx, user);
      if (!MIGRATION_STEPS.every((s) => b.steps[s]?.status === 'confirmed' || b.steps[s]?.status === 'skipped')) throw conflict('srv.migration.incomplete');
      const res = validate(d, b);
      const stale = staleSteps(b, res);
      if (stale.length) {
        reopen(b, stale);
        throw conflict('srv.migration.stale');
      }
      if (rowsToWrite(res) === 0) throw conflict('srv.migration.nothingToLoad');
      b.status = 'pending_approval';
      b.submittedAt = tzIso(Date.now());
      audit(user, 'migration_submitted', { targetType: 'migration', targetId: b.id, targetLabel: label(b, `строк к загрузке ${rowsToWrite(res)}`) });
      return batchView(d, b, user);
    }),
  ),
  http.post(
    `${BASE}/batches/:id/approve`,
    route((ctx) => {
      const user = admin(ctx.request);
      const d = db();
      const b = batchOf(d, param(ctx, 'id'));
      if (!can(user, 'migration.approve', { createdById: b.createdById })) throw new HttpError(403, 'forbidden', 'srv.migration.fourEyes');
      if (b.status !== 'pending_approval') throw conflict('srv.migration.notPending');
      // The system may have changed since the check (another batch, a new client): check again.
      const res = validate(d, b);
      const stale = staleSteps(b, res);
      if (stale.length) {
        reopen(b, stale);
        throw conflict('srv.migration.stale');
      }
      applyBatch(d, b, res, user);
      return batchView(d, b, user);
    }),
  ),
  http.post(
    `${BASE}/batches/:id/reject`,
    route(async (ctx) => {
      const user = admin(ctx.request);
      const d = db();
      const b = batchOf(d, param(ctx, 'id'));
      if (b.status !== 'pending_approval') throw conflict('srv.migration.notPending');
      // The author may withdraw own batch; anyone else needs the right to approve it.
      if (b.createdById !== user.id && !can(user, 'migration.approve', { createdById: b.createdById })) throw forbidden();
      const { reason } = await body(ctx.request, migrationReasonSchema);
      b.status = 'rejected';
      b.rejectReason = reason;
      b.decidedAt = tzIso(Date.now());
      b.decidedById = user.id;
      b.decidedByName = user.displayName;
      audit(user, 'migration_rejected', { targetType: 'migration', targetId: b.id, targetLabel: label(b, b.createdById === user.id ? 'отозван автором' : 'отклонён'), reason });
      return batchView(d, b, user);
    }),
  ),
  http.post(
    `${BASE}/batches/:id/rollback`,
    route(async (ctx) => {
      const user = admin(ctx.request);
      const d = db();
      const b = batchOf(d, param(ctx, 'id'));
      if (b.status !== 'applied') throw conflict('srv.migration.notApplied');
      const { reason } = await body(ctx.request, migrationReasonSchema);
      const blockers = rollbackBlockers(d, b);
      if (blockers.length) throw conflict('srv.migration.rollbackBlocked');
      rollbackBatch(d, b, user, reason);
      return batchView(d, b, user);
    }),
  ),
  // ---- manual entry of one contract: a one-row batch with the same checks, waiting for the second admin
  http.post(
    `${BASE}/manual`,
    route(async ({ request }) => {
      const user = admin(request);
      const { migrationDate, row } = await body(request, migrationManualSchema);
      const d = db();
      const draft: MigrationBatchRow = { id: '', seq: 0, kind: 'manual', status: 'draft', migrationDate, createdAt: '', createdById: user.id, createdByName: user.displayName, files: { contracts: { rows: [row], uploadedAt: '', uploadedByName: '' } }, steps: {} };
      const r = validate(d, draft).contracts!;
      if (r.errorRows > 0) {
        const fields: Record<string, string> = {};
        for (const i of r.issues) if (i.level === 'error' && !fields[i.field]) fields[i.field] = i.message;
        throw new HttpError(422, 'validation', 'srv.migration.manualInvalid', { fields });
      }
      const b = newBatch(d, user, 'manual', migrationDate);
      b.files = { contracts: { rows: [row], uploadedAt: tzIso(Date.now()), uploadedByName: user.displayName } };
      b.steps = {
        clients: { status: 'skipped', excludeErrors: false },
        contracts: { status: 'confirmed', excludeErrors: false, validRows: [2] },
        insured: { status: 'skipped', excludeErrors: false },
        limits: { status: 'skipped', excludeErrors: false },
        claims: { status: 'skipped', excludeErrors: false },
        invoices: { status: 'skipped', excludeErrors: false },
      };
      b.status = 'pending_approval';
      b.submittedAt = tzIso(Date.now());
      audit(user, 'migration_submitted', { targetType: 'migration', targetId: b.id, targetLabel: label(b, `договор вручную, старый № ${r.valid[0]!.data.oldNumber}`) });
      return HttpResponse.json(batchView(d, b, user), { status: 201 });
    }),
  ),
  // ---- the signed scan of a transferred contract, attached later (the upload rules of contract scans)
  http.post(
    `${API}/contracts/:id/migrated-scan`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      if (!can(user, 'contracts.read') || user.role === 'hr') throw forbidden();
      if (!can(user, 'contracts.verify_scan') && !can(user, 'contracts.draft')) throw forbidden();
      const d = db();
      const c = d.contracts.find((x) => x.id === param(ctx, 'id'));
      if (!c) throw notFound();
      if (!c.migration) throw conflict('srv.migration.notMigrated');
      const { bytes, mime } = await readScan(ctx.request);
      const fileId = randomId();
      if (c.migratedScan) d.files = d.files.filter((f) => f.id !== c.migratedScan!.fileId);
      d.files.push({ id: fileId, mime, bytes, clientId: c.clientId, contractId: c.id, fileName: `contract-scan.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}` });
      c.migratedScan = { fileId, uploadedAt: tzIso(Date.now()), uploadedByName: user.displayName };
      c.versions.push({ version: c.version, at: c.migratedScan.uploadedAt, byName: user.displayName, changes: 'Приложен скан подписанного договора' });
      audit(user, 'migration_scan_attached', { targetType: 'contract', targetId: c.id, targetLabel: `${c.number} (старый № ${c.externalNumber ?? '—'})` });
      return { migratedScan: c.migratedScan, message: msg('migration.scanAttached') };
    }),
  ),
];
