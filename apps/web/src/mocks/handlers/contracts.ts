/*
 * Contracts, endorsements and their signing (LIFECYCLE_SPEC §7–12): drafting with changed clauses,
 * legal and finance approval, sending, signing by each side with E-IMZO, EDO, paper or scan, the paper
 * original, invoices and payments (1C statement), coming into force, certificates, change requests,
 * endorsements and termination. The logic is the shared service (packages/domain/src/services/contracts.ts);
 * this is the MSW adapter.
 */
import { http, HttpResponse } from 'msw';
import * as contracts from '@mig/domain/services/contracts';
import type { DocKind, ScanForm } from '@mig/domain/services/contracts';
import { API, authCtx, param, readJson, route } from '../http';

/** The fields of a multipart scan upload; `null` when the body is not a readable form (also the portfolio transfer). */
export async function readScanForm(request: Request): Promise<ScanForm | null> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  const side = form.get('side');
  const file = form.get('file');
  return {
    side: typeof side === 'string' ? side : null,
    file: file instanceof File ? { size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) } : null,
  };
}

/** Signing routes shared by contracts and endorsements (LIFECYCLE_SPEC §8: the same rules and methods). */
function signingRoutes(kind: DocKind) {
  const base = `${API}/${kind === 'contract' ? 'contracts' : 'endorsements'}/:id`;
  return [
    http.post(`${base}/sign`, route(async (c) => contracts.sign(await authCtx(c.request), kind, param(c, 'id'), await readJson(c.request)))),
    http.post(`${base}/edo`, route(async (c) => contracts.sendToEdo(await authCtx(c.request), kind, param(c, 'id'), await readJson(c.request)))),
    http.post(`${base}/scan`, route(async (c) => contracts.uploadScan(await authCtx(c.request), kind, param(c, 'id'), await readScanForm(c.request)))),
    http.post(`${base}/scan/verify`, route(async (c) => contracts.verifyScan(await authCtx(c.request), kind, param(c, 'id'), await readJson(c.request)))),
    http.post(`${base}/originals`, route(async (c) => contracts.originals(await authCtx(c.request), kind, param(c, 'id'), await readJson(c.request)))),
    // ---- legal approval: needed only when a clause was changed ----
    http.post(`${base}/submit-legal`, route(async (c) => contracts.submitLegal(await authCtx(c.request), kind, param(c, 'id')))),
    http.post(`${base}/legal-approve`, route(async (c) => contracts.legalApprove(await authCtx(c.request), kind, param(c, 'id'), await readJson(c.request)))),
    http.post(`${base}/legal-return`, route(async (c) => contracts.legalReturn(await authCtx(c.request), kind, param(c, 'id'), await readJson(c.request)))),
    http.post(`${base}/send`, route(async (c) => contracts.sendToClient(await authCtx(c.request), kind, param(c, 'id')))),
  ];
}

export const contractHandlers = [
  // ---------------- contracts ----------------
  http.get(`${API}/contracts`, route(async ({ request, url }) => contracts.listContracts(await authCtx(request), url.searchParams))),
  http.get(`${API}/contracts/:id`, route(async (c) => contracts.getContract(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/contracts`, route(async ({ request }) => HttpResponse.json(await contracts.createContract(await authCtx(request), await readJson(request)), { status: 201 }))),
  http.patch(`${API}/contracts/:id`, route(async (c) => contracts.patchContract(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/contracts/:id/finance-approve`, route(async (c) => contracts.financeApprove(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/contracts/:id/new-version`, route(async (c) => contracts.newVersion(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/contracts/:id/insured-list`, route(async (c) => contracts.uploadInsuredList(await authCtx(c.request), param(c, 'id'), await c.request.text()))),
  http.post(
    `${API}/contracts/:id/terminate`,
    route(async (c) => HttpResponse.json(await contracts.terminate(await authCtx(c.request), param(c, 'id'), await readJson(c.request)), { status: 201 })),
  ),
  ...signingRoutes('contract'),

  // ---------------- invoices and payments (§9) ----------------
  http.get(`${API}/invoices`, route(async ({ request, url }) => contracts.listInvoices(await authCtx(request), url.searchParams))),
  http.post(`${API}/payments`, route(async ({ request }) => HttpResponse.json(await contracts.createPayment(await authCtx(request), await readJson(request)), { status: 201 }))),
  http.post(`${API}/payments/import-1c`, route(async ({ request }) => contracts.importStatement(await authCtx(request), await request.text()))),
  http.get(`${API}/payments/queue`, route(async ({ request, url }) => contracts.paymentQueue(await authCtx(request), url.searchParams))),
  http.post(`${API}/payments/queue/:id/allocate`, route(async (c) => contracts.allocatePayment(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),

  // ---------------- certificates (§10) ----------------
  http.get(`${API}/policies/:id/certificates`, route(async (c) => contracts.policyCertificates(await authCtx(c.request), param(c, 'id')))),
  http.get(`${API}/me/certificate`, route(async ({ request, url }) => contracts.myCertificate(await authCtx(request), url.searchParams.get('personId')))),

  // ---------------- change requests and endorsements (§11) ----------------
  http.get(`${API}/change-requests`, route(async ({ request, url }) => contracts.listChangeRequests(await authCtx(request), url.searchParams))),
  http.post(`${API}/change-requests`, route(async ({ request }) => HttpResponse.json(await contracts.createChangeRequest(await authCtx(request), await readJson(request)), { status: 201 }))),
  http.get(`${API}/endorsements`, route(async ({ request, url }) => contracts.listEndorsements(await authCtx(request), url.searchParams))),
  http.get(`${API}/endorsements/:id`, route(async (c) => contracts.getEndorsement(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/endorsements`, route(async ({ request }) => HttpResponse.json(await contracts.createEndorsements(await authCtx(request), await readJson(request)), { status: 201 }))),
  http.patch(`${API}/endorsements/:id`, route(async (c) => contracts.patchEndorsement(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/endorsements/:id/approve-amounts`, route(async (c) => contracts.approveAmounts(await authCtx(c.request), param(c, 'id')))),
  ...signingRoutes('endorsement'),
];
