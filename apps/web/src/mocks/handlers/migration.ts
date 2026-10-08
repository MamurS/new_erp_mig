/*
 * Transfer of the existing portfolio (/staff/admin/migration). The logic is the shared service
 * (packages/domain/src/services/migrationApi.ts and migration.ts); this is the MSW adapter.
 */
import { http, HttpResponse } from 'msw';
import * as migration from '@mig/domain/services/migrationApi';
import { API, authCtx, param, readJson, route } from '../http';
import { readScanForm as scanForm } from './contracts';

const BASE = `${API}/admin/migration`;

export const migrationHandlers = [
  http.get(`${BASE}/batches`, route(async ({ request }) => migration.listBatches(await authCtx(request)))),
  http.post(`${BASE}/batches`, route(async ({ request }) => HttpResponse.json(await migration.createBatch(await authCtx(request), await readJson(request)), { status: 201 }))),
  http.get(`${BASE}/batches/:id`, route(async (c) => migration.getBatch(await authCtx(c.request), param(c, 'id')))),
  http.delete(`${BASE}/batches/:id`, route(async (c) => migration.discardBatch(await authCtx(c.request), param(c, 'id')))),
  // ---- one file: upload and dry run (nothing is written)
  http.post(`${BASE}/batches/:id/steps/:step`, route(async (c) => migration.uploadStep(await authCtx(c.request), param(c, 'id'), c.params.step, await readJson(c.request)))),
  http.post(`${BASE}/batches/:id/steps/:step/confirm`, route(async (c) => migration.confirmStep(await authCtx(c.request), param(c, 'id'), c.params.step, await readJson(c.request)))),
  http.post(`${BASE}/batches/:id/steps/:step/skip`, route(async (c) => migration.skipStep(await authCtx(c.request), param(c, 'id'), c.params.step))),
  http.post(`${BASE}/batches/:id/submit`, route(async (c) => migration.submitBatch(await authCtx(c.request), param(c, 'id')))),
  http.post(`${BASE}/batches/:id/approve`, route(async (c) => migration.approveBatch(await authCtx(c.request), param(c, 'id')))),
  http.post(`${BASE}/batches/:id/reject`, route(async (c) => migration.rejectBatch(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${BASE}/batches/:id/rollback`, route(async (c) => migration.rollback(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  // ---- manual entry of one contract: a one-row batch with the same checks, waiting for the second admin
  http.post(`${BASE}/manual`, route(async ({ request }) => HttpResponse.json(await migration.manualContract(await authCtx(request), await readJson(request)), { status: 201 }))),
  // ---- the signed scan of a transferred contract, attached later (the upload rules of contract scans)
  http.post(`${API}/contracts/:id/migrated-scan`, route(async (c) => migration.attachMigratedScan(await authCtx(c.request), param(c, 'id'), await scanForm(c.request)))),
];
