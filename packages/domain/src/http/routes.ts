/*
 * The route table of the API (BACKEND_SPEC §4.3): every endpoint once — method, path, how the caller is
 * authenticated, what the body is, the service call and what the answer is. Two thin adapters are built from
 * it: MSW in the browser and in tests (apps/web/src/mocks/handlers/index.ts) and Fastify on the server
 * (apps/api). The order is the matching order (the first route that matches wins in MSW; Fastify prefers
 * static segments, and no two routes here differ only in that).
 *
 * Paths are relative to `/api`. Parameters use the `:name` syntax of both routers.
 */
import type { IntegrationScope, PartnerType } from '@mig/contracts';
import {
  appointmentList,
  assistanceCase,
  coverageCheckResult,
  guaranteeLetter,
  guaranteeList,
  insuredLimits,
  integrationAppointment,
  paymentList,
  rebill as rebillSchema,
  registry as registrySchema,
  registryList,
  rosterPage,
  slotsPutResult,
  visit as visitSchema,
} from '@mig/contracts/integration';
import type { ZodTypeAny } from 'zod';
import type { AiProvider } from '../ai/provider';
import { exportFileName } from '../lib/csv';
import * as ai from '../services/ai';
import * as assistPortal from '../services/assistPortal';
import * as auth from '../services/auth';
import * as claims from '../services/claims';
import * as clients from '../services/clients';
import * as clinicPortal from '../services/clinicPortal';
import * as contracts from '../services/contracts';
import * as dashboard from '../services/dashboard';
import * as deals from '../services/deals';
import { personIdParam } from '../services/family';
import * as help from '../services/help';
import * as hr from '../services/hr';
import * as insured from '../services/insured';
import * as integration from '../services/integration';
import * as integrationAssistance from '../services/integrationAssistance';
import { issueToken, parseJsonBody, type ApiAnswer, type ApiCallCtx, type ApiSpec } from '../services/integrationKit';
import type { AuthCtx, BaseCtx } from '../services/kernel';
import * as kp from '../services/kp';
import * as me from '../services/me';
import * as migration from '../services/migrationApi';
import * as params from '../services/params';
import * as partnerIntegration from '../services/partnerIntegration';
import * as policies from '../services/policies';
import * as settlement from '../services/settlementApi';
import * as staffAssistance from '../services/staffAssistance';
import * as staffClinics from '../services/staffClinics';
import * as misc from '../services/staffMisc';
import * as tasks from '../services/tasks';
import { formFile, formFiles, formText, requireForm, type RouteRequest } from './request';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/**
 * - `session`: a signed-in person (401 otherwise), resolved by the adapter before the call;
 * - `none`: no session needed (sign-in, the partner token endpoint); the call may still look for one;
 * - `partner`: the partner integration API (its own bearer tokens, problem+json, call log: `runApiCall`);
 * - `demo`: a signed-in person, and the route exists only in demo/ci/staging deployments (demoRoutes.ts).
 */
export type AuthKind = 'session' | 'none' | 'partner' | 'demo';
export type BodyKind = 'json' | 'form' | 'text' | 'none';
/** `json` (200; 204 when the call returns undefined), `201`, or `raw`: the call returns a RawResult. */
export type ResultKind = 'json' | 201 | 'raw';

/** An answer that is not JSON: CSV, file bytes, problem+json of the partner API. */
export interface RawResult {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array | null;
}

/** What the deployment provides to the routes (the mock and the server differ only here). */
export interface RouteDeps {
  /** The AI provider of a call (the mock simulates latency). */
  aiProvider(): AiProvider;
  /** The help guide, its search and answers. */
  help: help.HelpProvider<unknown>;
  /** A picture of a seeded receipt (no stored bytes). */
  receiptPng(lines: string[]): Promise<Uint8Array>;
  /** The first password of an invited account (demo deployments; Supabase Auth invitations in production). */
  invitePassword: string;
}

interface RouteBase {
  method: Method;
  path: string;
  body: BodyKind;
  result: ResultKind;
  /** A GET that changes data (the mock persists it like a mutation). */
  writes?: true;
}
export interface SessionRoute extends RouteBase {
  auth: 'session' | 'demo';
  call(ctx: AuthCtx, req: RouteRequest, deps: RouteDeps): Promise<unknown>;
}
export interface OpenRoute extends RouteBase {
  auth: 'none';
  /** `session()`: the session of the request, when the call wants it (401 without one). */
  call(ctx: BaseCtx, req: RouteRequest, deps: RouteDeps, session: () => Promise<AuthCtx>): Promise<unknown>;
}
export interface PartnerRoute extends RouteBase {
  auth: 'partner';
  spec: ApiSpec;
  call(c: ApiCallCtx, req: RouteRequest): Promise<{ status?: number; body: unknown }>;
}
export type RouteDef = SessionRoute | OpenRoute | PartnerRoute;

/** `METHOD /path`: the key of a route (mock knobs, tests). */
export const routeKey = (r: Pick<RouteDef, 'method' | 'path'>): string => `${r.method} ${r.path}`;

type SCall = SessionRoute['call'];
interface Opts {
  result?: ResultKind;
  writes?: true;
}

const S = (method: Method, path: string, body: BodyKind, call: SCall, o: Opts = {}): SessionRoute => ({ method, path, auth: 'session', body, result: o.result ?? 'json', call, ...(o.writes ? { writes: o.writes } : {}) });
const get = (path: string, call: SCall, o?: Opts) => S('GET', path, 'none', call, o);
/** POST/PATCH/PUT/DELETE without a body. */
const act = (method: Method, path: string, call: SCall, o?: Opts) => S(method, path, 'none', call, o);
/** POST/PATCH/PUT/DELETE with a JSON body. */
const send = (method: Method, path: string, call: SCall, o?: Opts) => S(method, path, 'json', call, o);
const open = (method: Method, path: string, body: BodyKind, call: OpenRoute['call'], o: Opts = {}): OpenRoute => ({ method, path, auth: 'none', body, result: o.result ?? 'json', call });

const CREATED: Opts = { result: 201 };
const RAW: Opts = { result: 'raw' };
const ANSWERS = ['confirm', 'reschedule', 'decline'] as const;

// ------------------------------------------------------------------------------------------------ raw answers

function fileAnswer(f: claims.FileContent, deps: RouteDeps): Promise<RawResult> {
  return (async () => ({
    status: 200,
    headers: {
      'Content-Type': f.mime,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(f.download ? { 'Content-Disposition': `attachment; filename="${f.download}"` } : {}),
    },
    body: f.bytes ?? (await deps.receiptPng(f.seedText ?? [])),
  }))();
}

function csvAnswer(csv: string, fileName: string): RawResult {
  return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' }, body: csv };
}

const apiAnswer = (a: ApiAnswer): RawResult => ({ status: a.status, headers: a.headers, body: a.body });

// ------------------------------------------------------------------------------------------------ forms

/** The insured person's multipart forms, read only when the service gets to them. */
const meForm =
  (req: RouteRequest): me.ReadForm =>
  async () =>
    requireForm(req);

/** «Documents for a letter» (400 when the body is not multipart). */
async function documentsForm(req: RouteRequest): Promise<{ comment: string | null; files: clinicPortal.UploadedFile[] }> {
  const form = await requireForm(req);
  return { comment: formText(form, 'comment'), files: formFiles(form, 'files') };
}

/** A signed scan of a contract or an endorsement; null when the body is not a readable form. */
async function scanForm(req: RouteRequest): Promise<contracts.ScanForm | null> {
  const form = await req.form();
  if (!form) return null;
  return { side: formText(form, 'side'), file: formFile(form, 'file') };
}

// ------------------------------------------------------------------------------------------------ partner settings

/** Integration settings of a partner (keys, webhooks, deliveries, log): clinics and assistance companies alike. */
function partnerSettings(base: string, scopeOf: (ctx: AuthCtx) => Promise<partnerIntegration.PartnerScope>): SessionRoute[] {
  const scoped =
    (fn: (ctx: AuthCtx, scope: partnerIntegration.PartnerScope, req: RouteRequest) => Promise<unknown>): SCall =>
    async (ctx, req) =>
      fn(ctx, await scopeOf(ctx), req);
  return [
    get(`${base}/overview`, scoped((c, s) => partnerIntegration.overview(c, s))),
    get(`${base}/keys`, scoped((c, s) => partnerIntegration.listKeys(c, s))),
    send('POST', `${base}/keys`, scoped(async (c, s, req) => partnerIntegration.createKey(c, s, await req.json()))),
    act('POST', `${base}/keys/:id/revoke`, scoped((c, s, req) => partnerIntegration.revokePartnerKey(c, s, req.id('id')))),
    get(`${base}/webhooks`, scoped((c, s) => partnerIntegration.listWebhooks(c, s))),
    send('POST', `${base}/webhooks`, scoped(async (c, s, req) => partnerIntegration.createWebhook(c, s, await req.json()))),
    act('POST', `${base}/webhooks/:id/test`, scoped((c, s, req) => partnerIntegration.testWebhook(c, s, req.id('id')))),
    get(`${base}/deliveries`, scoped((c, s) => partnerIntegration.listDeliveries(c, s))),
    act('POST', `${base}/deliveries/:id/retry`, scoped((c, s, req) => partnerIntegration.retryDelivery(c, s, req.id('id')))),
    get(`${base}/logs`, scoped((c, s) => partnerIntegration.listLogs(c, s))),
  ];
}

// ------------------------------------------------------------------------------------------------ partner API

export const PARTNER_BASE = '/integration/v1';

/** One endpoint of the partner API: `template` is the logged path (no ids). */
function partner(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  template: string,
  scope: IntegrationScope,
  response: ZodTypeAny | null,
  call: PartnerRoute['call'],
  kind: PartnerType = 'clinic',
): PartnerRoute {
  // `/visits/{visitId}` → `/visits/:visitId`
  const path = PARTNER_BASE + template.replace(/\{(\w+)\}/g, ':$1');
  return { method, path, auth: 'partner', body: method === 'GET' ? 'none' : 'json', result: 'raw', spec: { method, template, scope, response, partner: kind }, call };
}
const assistanceApi = (method: 'GET' | 'POST' | 'PATCH', template: string, scope: IntegrationScope, response: ZodTypeAny | null, call: PartnerRoute['call']) =>
  partner(method, template, scope, response, call, 'assistance');

/** «Documents for a letter» of the partner API, or null when the body is not multipart. */
async function partnerDocumentsForm(req: RouteRequest) {
  const form = await req.form();
  if (!form) return null;
  return { comment: formText(form, 'comment'), files: formFiles(form, 'files') };
}

// ================================================================================================ the table

export const ROUTES: readonly RouteDef[] = [
  // ---------------- sign-in and sessions (services/auth.ts) ----------------
  open('POST', '/auth/login', 'json', async (ctx, req) => auth.login(ctx, await req.json())),
  open('POST', '/auth/resend', 'json', async (ctx, req) => auth.resend(ctx, await req.json())),
  open('POST', '/auth/otp', 'json', async (ctx, req) => auth.otp(ctx, await req.json())),
  open('POST', '/auth/phone', 'json', async (ctx, req) => auth.phoneLogin(ctx, await req.json())),
  open('POST', '/auth/phone/verify', 'json', async (ctx, req) => auth.phoneVerify(ctx, await req.json())),
  open('POST', '/auth/logout', 'none', async (_ctx, req, _deps, session) => auth.logout(await session().catch(() => null), req.query.get('all') === '1')),
  get('/auth/me', (ctx) => auth.me(ctx)),

  // ---------------- the staff dashboard (services/dashboard.ts) ----------------
  get('/dashboard', (ctx) => dashboard.dashboard(ctx)),
  get('/queue', (ctx, req) => dashboard.queue(ctx, req.query)),
  get('/dashboard/medical-access', (ctx) => dashboard.medicalAccess(ctx)),
  get('/integrations/status', (ctx) => dashboard.integrationsStatus(ctx)),

  // ---------------- tasks and notifications (services/tasks.ts) ----------------
  send('POST', '/tasks', async (ctx, req) => tasks.askTask(ctx, await req.json())),
  send('POST', '/tasks/request-hr', async (ctx, req) => tasks.requestHr(ctx, await req.json())),
  get('/tasks', (ctx, req) => tasks.listTasks(ctx, req.query.get('status'))),
  get('/tasks/mine', (ctx) => tasks.myTasks(ctx)),
  get('/tasks/about', (ctx, req) => tasks.tasksAbout(ctx, req.query.get('subjectType'), req.query.get('subjectId') ?? '')),
  act('POST', '/tasks/:id/take', (ctx, req) => tasks.take(ctx, req.id('id'))),
  send('POST', '/tasks/:id/done', async (ctx, req) => tasks.markDone(ctx, req.id('id'), await req.json())),
  send('POST', '/tasks/:id/reject', async (ctx, req) => tasks.reject(ctx, req.id('id'), await req.json())),
  act('POST', '/tasks/:id/remind', (ctx, req) => tasks.remind(ctx, req.id('id'))),
  get('/notifications', (ctx) => tasks.listNotifications(ctx)),
  act('POST', '/notifications/read', (ctx) => tasks.readAllNotifications(ctx)),
  act('POST', '/notifications/:id/read', (ctx, req) => tasks.readNotification(ctx, req.id('id'))),
  get('/clients/:id/pipeline', (ctx, req) => tasks.pipeline(ctx, req.id('id'))),

  // ---------------- policy issuance and insured-list changes (services/policies.ts) ----------------
  S('POST', '/clients/:id/policies/check', 'text', async (ctx, req) => policies.checkPolicyList(ctx, req.id('id'), await req.text())),
  send('POST', '/clients/:id/policies', async (ctx, req) => policies.issuePolicy(ctx, req.id('id'), await req.json())),
  get('/policy-changes', (ctx, req) => policies.listPolicyChanges(ctx, req.query)),
  send('POST', '/policy-changes/decision', async (ctx, req) => policies.decidePolicyChanges(ctx, await req.json())),

  // ---------------- clients and policies (services/clients.ts) ----------------
  get('/clients', (ctx, req) => clients.listClients(ctx, req.query)),
  send('POST', '/clients', async (ctx, req) => clients.createClient(ctx, await req.json())),
  get('/clients/:id/loss-stats', (ctx, req) => clients.lossStats(ctx, req.id('id'))),
  get('/clients/:id', (ctx, req) => clients.clientDetail(ctx, req.id('id'))),
  send('PATCH', '/clients/:id', async (ctx, req) => clients.patchClient(ctx, req.id('id'), await req.json())),
  get('/clients/:id/insured', (ctx, req) => clients.clientInsured(ctx, req.id('id'), req.query)),
  get('/clients/:id/documents', (ctx, req) => clients.clientDocuments(ctx, req.id('id'))),
  get('/clients/:id/history', (ctx, req) => clients.clientHistory(ctx, req.id('id'))),
  // The letter's text is read and dropped (imitation).
  S('POST', '/clients/:id/hr-letter', 'text', async (ctx, req) => {
    const id = req.id('id');
    await req.text();
    return clients.hrLetter(ctx, id);
  }),
  get('/policies', (ctx, req) => clients.listPolicies(ctx, req.query)),
  get('/policies/:id', (ctx, req) => clients.policyDetail(ctx, req.id('id'))),

  // ---------------- insured persons in the staff portal (services/insured.ts) ----------------
  get('/insured', (ctx, req) => insured.list(ctx, req.url)),
  get('/insured/:id', (ctx, req) => insured.detail(ctx, req.id('id'))),
  get('/insured/:id/limits', (ctx, req) => insured.limits(ctx, req.id('id'))),
  get('/insured/:id/claims', (ctx, req) => insured.claims(ctx, req.id('id'))),
  get('/insured/:id/documents', (ctx, req) => insured.documents(ctx, req.id('id'))),
  get('/insured/:id/access-log', (ctx, req) => insured.accessLog(ctx, req.id('id'))),
  send('POST', '/insured/:id/reveal', async (ctx, req) => insured.reveal(ctx, req.id('id'), await req.json())),
  send('POST', '/insured/:id/reveal-copied', async (ctx, req) => insured.revealCopied(ctx, req.id('id'), await req.json())),
  send('POST', '/insured/:id/medical-access', async (ctx, req) => insured.medicalAccess(ctx, req.id('id'), await req.json())),
  get('/insured/:id/medical', (ctx, req) => insured.medical(ctx, req.id('id'), req.header('x-medical-grant') ?? '')),
  send('POST', '/insured/:id/guarantee-letters', async (ctx, req) => insured.issueGuaranteeLetter(ctx, req.id('id'), await req.json())),

  // ---------------- claims, files, the operator's appointments (services/claims.ts) ----------------
  get('/claims', (ctx, req) => claims.listClaims(ctx, req.query)),
  get('/claims/:id', (ctx, req) => claims.claimDetail(ctx, req.id('id'))),
  send('POST', '/claims/:id/transition', async (ctx, req) => claims.transition(ctx, req.id('id'), await req.json())),
  S('POST', '/claims', 'form', async (ctx, req) => {
    const form = await requireForm(req);
    const fields = {
      insuredId: formText(form, 'insuredId'),
      intakeChannel: formText(form, 'intakeChannel'),
      category: formText(form, 'category'),
      amount: formText(form, 'amount'),
      serviceDate: formText(form, 'serviceDate'),
      providerName: formText(form, 'providerName'),
    };
    return claims.createClaim(ctx, fields, formFiles(form, 'files'));
  }),
  get('/files/:id', async (ctx, req, deps) => fileAnswer(await claims.getFile(ctx, req.id('id')), deps), RAW),
  get('/appointments', (ctx, req) => claims.listAppointments(ctx, req.query)),
  act('POST', '/appointments/:id/confirm', (ctx, req) => claims.confirmAppointment(ctx, req.id('id'))),
  send('POST', '/appointments/:id/decline', async (ctx, req) => claims.declineAppointment(ctx, req.id('id'), await req.json())),
  send('POST', '/appointments', async (ctx, req) => claims.createAppointment(ctx, await req.json())),

  // ---------------- clinics, limit requests, reports, exports, audit, staff users (services/staffMisc.ts) ----------------
  get('/clinics', (ctx, req) => misc.clinics(ctx, req.url)),
  get('/clinics/nearby', (ctx, req) => misc.nearby(ctx, req.url)),
  get('/clinics/:id/slots', (ctx, req) => misc.slots(ctx, req.id('id'), req.query.get('date'))),
  get('/limit-requests', (ctx, req) => misc.limitRequests(ctx, req.query.get('status'))),
  send('POST', '/limit-requests', async (ctx, req) => misc.requestLimitChange(ctx, await req.json())),
  act('POST', '/limit-requests/:id/approve', (ctx, req) => misc.decideLimitChange(ctx, req.id('id'), 'approve', undefined)),
  send('POST', '/limit-requests/:id/reject', async (ctx, req) => misc.decideLimitChange(ctx, req.id('id'), 'reject', await req.json())),
  get('/reports/loss-ratio-by-client', (ctx) => misc.lossRatio(ctx)),
  get('/reports/claims-by-category', (ctx, req) => misc.claimsByCategory(ctx, req.query.get('from'), req.query.get('to'))),
  get('/reports/premium-by-month', (ctx) => misc.premiumByMonth(ctx)),
  send(
    'POST',
    '/exports',
    async (ctx, req) => {
      const { csv, kind } = await misc.exportCsv(ctx, await req.json());
      return csvAnswer(`\ufeff${csv}`, exportFileName(kind));
    },
    RAW,
  ),
  get('/audit', (ctx, req) => misc.auditLog(ctx, req.url)),
  get('/admin/users', (ctx) => misc.staffUsers(ctx)),
  send('POST', '/admin/users', async (ctx, req) => misc.inviteStaffUser(ctx, await req.json()), CREATED),
  send('PATCH', '/admin/users/:id', async (ctx, req) => misc.updateStaffUser(ctx, req.id('id'), await req.json())),

  // ---------------- commercial offers (services/kp.ts) ----------------
  get('/clients/:id/kp-defaults', (ctx, req) => kp.kpDefaults(ctx, req.id('id'), req.query)),
  get('/clients/:id/kp', (ctx, req) => kp.listClientKp(ctx, req.id('id'))),
  send('POST', '/clients/:id/kp', async (ctx, req) => kp.createKp(ctx, req.id('id'), req.query, await req.json())),
  get('/kp/:id', (ctx, req) => kp.getKp(ctx, req.id('id'))),
  send('PATCH', '/kp/:id', async (ctx, req) => kp.patchKp(ctx, req.id('id'), await req.json())),
  act('POST', '/kp/:id/send', (ctx, req) => kp.sendKp(ctx, req.id('id'))),
  act('POST', '/kp/:id/revoke', (ctx, req) => kp.revokeKp(ctx, req.id('id'))),
  act('POST', '/kp/:id/downloaded', (ctx, req) => kp.kpDownloaded(ctx, req.id('id'))),

  // ---------------- the clinic cabinet (services/clinicPortal.ts) ----------------
  get('/clinic/overview', (ctx) => clinicPortal.overview(ctx)),
  send('POST', '/clinic/check', async (ctx, req) => clinicPortal.check(ctx, await req.json())),
  get('/clinic/visits', (ctx, req) => clinicPortal.visits(ctx, req.query)),
  get('/clinic/visits/:id/coverage', (ctx, req) => clinicPortal.visitCoverage(ctx, req.id('id'))),
  get('/clinic/appointments', (ctx, req) => clinicPortal.appointments(ctx, req.query)),
  get('/clinic/slots', (ctx, req) => clinicPortal.slots(ctx, req.query)),
  ...ANSWERS.map((kind) =>
    S('POST', `/clinic/appointments/:id/${kind}`, kind === 'confirm' ? 'none' : 'json', async (ctx, req) =>
      clinicPortal.answerAppointment(ctx, kind, req.id('id'), kind === 'confirm' ? undefined : await req.json()),
    ),
  ),
  get('/clinic/guarantees', (ctx, req) => clinicPortal.listGuarantees(ctx, req.query.get('status'))),
  get('/clinic/guarantees/:id', (ctx, req) => clinicPortal.getGuarantee(ctx, req.id('id'))),
  send('POST', '/clinic/guarantees', async (ctx, req) => clinicPortal.requestGuarantee(ctx, await req.json())),
  S('POST', '/clinic/guarantees/:id/documents', 'form', async (ctx, req) => clinicPortal.guaranteeDocuments(ctx, req.id('id'), await documentsForm(req))),
  get('/clinic/price-list', (ctx, req) => clinicPortal.priceList(ctx, req.query.get('visitId'))),
  get('/clinic/registries', (ctx) => clinicPortal.listRegistries(ctx)),
  get('/clinic/registries/:id', (ctx, req) => clinicPortal.getRegistry(ctx, req.id('id'))),
  send('POST', '/clinic/registries/build', async (ctx, req) => clinicPortal.buildRegistry(ctx, await req.json())),
  S('POST', '/clinic/registries/import', 'form', async (ctx, req) => {
    const form = await requireForm(req);
    const file = form.files.file?.[0];
    const input: clinicPortal.RegistryCsvInput = { period: formText(form, 'period'), file: file ? { size: file.bytes.length, text: new TextDecoder().decode(file.bytes) } : null };
    return clinicPortal.importRegistry(ctx, input, req.query.get('commit') === '1');
  }),
  send('POST', '/clinic/registries/:id/lines', async (ctx, req) => clinicPortal.addRegistryLine(ctx, req.id('id'), await req.json())),
  act('DELETE', '/clinic/registries/:id/lines/:lineId', (ctx, req) => clinicPortal.removeRegistryLine(ctx, req.id('id'), req.id('lineId'))),
  act('POST', '/clinic/registries/:id/submit', (ctx, req) => clinicPortal.sendRegistry(ctx, req.id('id'))),
  send('POST', '/clinic/registries/:id/lines/:lineId/dispute', async (ctx, req) => clinicPortal.disputeRegistryLine(ctx, req.id('id'), req.id('lineId'), await req.json())),
  get('/clinic/documents', (ctx) => clinicPortal.documents(ctx)),
  get('/clinic/users', (ctx) => clinicPortal.listUsers(ctx)),
  send('POST', '/clinic/users', async (ctx, req, deps) => clinicPortal.inviteUser(ctx, await req.json(), deps.invitePassword)),
  send('PATCH', '/clinic/users/:id', async (ctx, req) => clinicPortal.patchUser(ctx, req.id('id'), await req.json())),
  ...partnerSettings('/clinic/integration', clinicPortal.integrationScope),

  // ---------------- the partner API of clinic systems (services/integration.ts) ----------------
  open('POST', `${PARTNER_BASE}/oauth/token`, 'form', async (ctx, req) => {
    // The client credentials come as a form or as JSON.
    const form = (req.header('content-type') ?? '').includes('application/x-www-form-urlencoded');
    const text = await req.text();
    return apiAnswer(await issueToken(ctx, () => (form ? Object.fromEntries(new URLSearchParams(text)) : parseJsonBody(text)), req.startedAt));
  }, RAW),
  partner('POST', '/coverage/check', 'coverage:check', coverageCheckResult, integration.coverageCheck),
  partner('GET', '/visits/{visitId}', 'coverage:check', visitSchema, integration.getVisit),
  partner('GET', '/appointments', 'appointments:read', appointmentList, integration.listAppointments),
  ...ANSWERS.map((kind) => partner('POST', `/appointments/{id}/${kind}`, 'appointments:write', integrationAppointment, (c) => integration.answerAppointment(c, kind))),
  partner('PUT', '/slots', 'slots:write', slotsPutResult, integration.putSlots),
  partner('POST', '/guarantees', 'guarantees:write', guaranteeLetter, integration.requestGuarantee),
  partner('GET', '/guarantees/{id}', 'guarantees:read', guaranteeLetter, integration.getGuarantee),
  { ...partner('POST', '/guarantees/{id}/documents', 'guarantees:write', guaranteeLetter, async (c, req) => {
    c.pathParam('id');
    return integration.guaranteeDocuments(c, await partnerDocumentsForm(req));
  }), body: 'form' },
  partner('POST', '/registries', 'registries:write', registrySchema, integration.createRegistry),
  partner('GET', '/registries/{id}', 'registries:read', registrySchema, integration.getRegistry),
  partner('POST', '/registries/{id}/lines/{lineId}/dispute', 'registries:write', registrySchema, integration.disputeRegistryLine),
  partner('GET', '/payments', 'payments:read', paymentList, integration.payments),

  // ---------------- the partner API of assistance companies (services/integrationAssistance.ts) ----------------
  assistanceApi('GET', '/assistance/roster', 'roster:read', rosterPage, integrationAssistance.roster),
  assistanceApi('GET', '/assistance/insured/{id}/limits', 'roster:read', insuredLimits, integrationAssistance.insuredLimits),
  assistanceApi('POST', '/assistance/cases', 'cases:write', assistanceCase, integrationAssistance.createCase),
  assistanceApi('PATCH', '/assistance/cases/{id}', 'cases:write', assistanceCase, integrationAssistance.updateCase),
  assistanceApi('GET', '/assistance/appointments', 'appointments:write', appointmentList, integrationAssistance.listAppointments),
  ...ANSWERS.map((kind) =>
    assistanceApi('POST', `/assistance/appointments/{id}/${kind}`, 'appointments:write', integrationAppointment, (c) => integrationAssistance.answerAppointment(c, kind)),
  ),
  assistanceApi('GET', '/assistance/guarantees', 'guarantees:decide', guaranteeList, integrationAssistance.listGuarantees),
  assistanceApi('POST', '/assistance/guarantees/{id}/decide', 'guarantees:decide', guaranteeLetter, integrationAssistance.decideGuarantee),
  assistanceApi('GET', '/assistance/registries', 'registries:review', registryList, integrationAssistance.listRegistries),
  assistanceApi('POST', '/assistance/registries/{id}/lines/{lineId}/decide', 'registries:review', registrySchema, integrationAssistance.decideRegistryLine),
  assistanceApi('POST', '/assistance/registries/{id}/payments', 'payments:write', registrySchema, integrationAssistance.payRegistry),
  assistanceApi('POST', '/assistance/rebills', 'rebills:write', rebillSchema, integrationAssistance.createRebill),
  assistanceApi('GET', '/assistance/rebills/{id}', 'rebills:write', rebillSchema, integrationAssistance.getRebill),
  assistanceApi('POST', '/assistance/rebills/{id}/lines/{lineId}/dispute', 'rebills:write', rebillSchema, integrationAssistance.disputeLine),

  // ---------------- MIG side of clinics (services/staffClinics.ts) ----------------
  get('/clinics/:id/card', (ctx, req) => staffClinics.card(ctx, req.id('id'))),
  send('POST', '/clinics', async (ctx, req) => staffClinics.createClinic(ctx, await req.json())),
  send('PATCH', '/clinics/:id', async (ctx, req) => staffClinics.setMode(ctx, req.id('id'), await req.json())),
  send('POST', '/clinics/:id/admins', async (ctx, req, deps) => staffClinics.inviteAdmin(ctx, req.id('id'), await req.json(), deps.invitePassword)),
  act('POST', '/clinics/:id/keys/:keyId/revoke', (ctx, req) => staffClinics.revokeClinicKey(ctx, req.id('id'), req.id('keyId'))),
  get('/guarantees', (ctx, req) => staffClinics.listGuarantees(ctx, req.query)),
  get('/guarantees/:id', (ctx, req) => staffClinics.getGuarantee(ctx, req.id('id'))),
  send('POST', '/guarantees/:id/decision', async (ctx, req) => staffClinics.decideGuarantee(ctx, req.id('id'), await req.json())),
  get('/registries', (ctx, req) => staffClinics.listRegistries(ctx, req.query)),
  get('/registries/:id', (ctx, req) => staffClinics.getRegistry(ctx, req.id('id'))),
  send('POST', '/registries/:id/lines/:lineId/decision', async (ctx, req) => staffClinics.decideLine(ctx, req.id('id'), req.id('lineId'), await req.json())),
  act('POST', '/registries/:id/pay', (ctx, req) => staffClinics.payRegistry(ctx, req.id('id'))),

  // ---------------- the HR cabinet (services/hr.ts) ----------------
  get('/hr/overview', (ctx) => hr.overview(ctx)),
  get('/hr/employees', (ctx, req) => hr.listEmployees(ctx, req.query)),
  get('/hr/employees/:id', (ctx, req) => hr.getEmployee(ctx, req.id('id'))),
  send('POST', '/hr/employees', async (ctx, req) => hr.addEmployee(ctx, await req.json())),
  send('DELETE', '/hr/employees/:id', async (ctx, req) => hr.excludeEmployee(ctx, req.id('id'), await req.json())),
  S('POST', '/hr/employees/import', 'text', async (ctx, req) => hr.importEmployees(ctx, await req.text(), req.query.get('commit') === '1')),
  send('POST', '/hr/employees/invite', async (ctx, req) => hr.inviteEmployees(ctx, await req.json())),
  get('/hr/documents', (ctx) => hr.documents(ctx)),
  get('/hr/invoices', (ctx) => hr.invoices(ctx)),
  get('/hr/family', (ctx, req) => hr.familyList(ctx, req.query.get('employeeId') ?? undefined)),
  send('POST', '/hr/family', async (ctx, req) => hr.addFamilyMember(ctx, await req.json())),
  get('/hr/family-requests', (ctx, req) => hr.familyRequests(ctx, req.query.get('status'))),
  send('POST', '/hr/family-requests/:id/decision', async (ctx, req) => hr.decideFamilyRequest(ctx, req.id('id'), await req.json())),
  get('/hr/stats', (ctx) => hr.stats(ctx)),

  // ---------------- the insured person's app (services/me.ts) ----------------
  get('/me', (ctx) => me.profile(ctx)),
  send('POST', '/me/consent', async (ctx, req) => me.giveConsent(ctx, await req.json())),
  get('/me/policy', (ctx, req) => me.policy(ctx, personIdParam(req.url))),
  get('/me/limits', (ctx, req) => me.limits(ctx, personIdParam(req.url))),
  get('/me/family', (ctx) => me.family(ctx)),
  send('POST', '/me/family/consent', async (ctx, req) => me.setFamilyConsent(ctx, await req.json())),
  send('POST', '/me/payout-card', async (ctx, req) => me.setPayoutCard(ctx, await req.json())),
  get('/me/family/requests', (ctx) => me.familyRequests(ctx)),
  send('POST', '/me/family/requests', async (ctx, req) => me.createFamilyRequest(ctx, await req.json())),
  // A GET that writes: the code shown on screen is stored.
  get('/me/card-token', (ctx, req) => me.cardToken(ctx, personIdParam(req.url)), { writes: true }),
  get('/me/claims', (ctx, req) => me.claims(ctx, personIdParam(req.url))),
  get('/me/claims/:id', (ctx, req) => me.claim(ctx, req.id('id'))),
  S('POST', '/me/claims/recognize', 'form', (ctx, req) => me.recognize(ctx, meForm(req))),
  S('POST', '/me/claims', 'form', (ctx, req) => me.submitClaim(ctx, personIdParam(req.url), meForm(req))),
  get('/me/appointments', (ctx, req) => me.appointments(ctx, personIdParam(req.url))),
  send('POST', '/me/appointments', async (ctx, req) => me.requestAppointment(ctx, personIdParam(req.url), await req.json())),
  act('POST', '/me/appointments/:id/cancel', (ctx, req) => me.cancelAppointment(ctx, req.id('id'))),
  act('POST', '/me/appointments/:id/accept-proposal', (ctx, req) => me.acceptProposal(ctx, req.id('id'))),
  // «Ваш ассистанс 24/7» on the home screen; null — MIG serves the client.
  get('/me/assistance', (ctx) => me.assistance(ctx)),
  get('/me/chat', (ctx) => me.chat(ctx)),
  send('POST', '/me/chat', async (ctx, req) => me.sendChat(ctx, await req.json())),

  // ---------------- the assistance company portal (services/assistPortal.ts) ----------------
  get('/assist/overview', (ctx) => assistPortal.overview(ctx)),
  get('/assist/insured', (ctx, req) => assistPortal.searchInsured(ctx, req.query)),
  get('/assist/insured/:id', (ctx, req) => assistPortal.insuredDetail(ctx, req.id('id'))),
  send('POST', '/assist/insured/:id/reveal', async (ctx, req) => assistPortal.revealPii(ctx, req.id('id'), await req.json())),
  send('POST', '/assist/insured/:id/reveal-copied', async (ctx, req) => assistPortal.revealCopied(ctx, req.id('id'), await req.json())),
  send('POST', '/assist/insured/:id/medical-access', async (ctx, req) => assistPortal.medicalAccess(ctx, req.id('id'), await req.json())),
  get('/assist/insured/:id/medical', (ctx, req) => assistPortal.medical(ctx, req.id('id'), req.header('x-medical-grant') ?? '')),
  get('/assist/cases', (ctx, req) => assistPortal.listCases(ctx, req.query)),
  get('/assist/cases/:id', (ctx, req) => assistPortal.getCase(ctx, req.id('id'))),
  send('POST', '/assist/cases', async (ctx, req) => assistPortal.createCase(ctx, await req.json())),
  send('PATCH', '/assist/cases/:id', async (ctx, req) => assistPortal.updateCase(ctx, req.id('id'), await req.json())),
  get('/assist/appointments', (ctx, req) => assistPortal.listAppointments(ctx, req.query.get('view'))),
  send('POST', '/assist/appointments', async (ctx, req) => assistPortal.createAssistAppointment(ctx, await req.json())),
  ...ANSWERS.map((kind) =>
    S('POST', `/assist/appointments/:id/${kind}`, kind === 'confirm' ? 'none' : 'json', async (ctx, req) =>
      assistPortal.answerAppointment(ctx, kind, req.id('id'), kind === 'confirm' ? undefined : await req.json()),
    ),
  ),
  get('/assist/chat', (ctx) => assistPortal.chatThreads(ctx)),
  get('/assist/chat/:insuredId', (ctx, req) => assistPortal.chatMessages(ctx, req.id('insuredId'))),
  send('POST', '/assist/chat/:insuredId', async (ctx, req) => assistPortal.sendChat(ctx, req.id('insuredId'), await req.json())),
  get('/assist/guarantees', (ctx, req) => assistPortal.listGuarantees(ctx, req.query.get('status'))),
  send('POST', '/assist/guarantees', async (ctx, req) => assistPortal.requestGuaranteeOnCall(ctx, await req.json())),
  get('/assist/guarantees/:id', (ctx, req) => assistPortal.getGuarantee(ctx, req.id('id'))),
  send('POST', '/assist/guarantees/:id/decision', async (ctx, req) => assistPortal.decideGuarantee(ctx, req.id('id'), await req.json())),
  get('/assist/registries', (ctx) => assistPortal.listRegistries(ctx)),
  get('/assist/registries/:id', (ctx, req) => assistPortal.getRegistry(ctx, req.id('id'))),
  send('POST', '/assist/registries/:id/lines/:lineId/decision', async (ctx, req) => assistPortal.decideRegistryLine(ctx, req.id('id'), req.id('lineId'), await req.json())),
  send('POST', '/assist/registries/:id/payments', async (ctx, req) => assistPortal.payRegistry(ctx, req.id('id'), await req.json())),
  get('/assist/rebills', (ctx) => assistPortal.listRebills(ctx)),
  get('/assist/rebills/:id', (ctx, req) => assistPortal.getRebill(ctx, req.id('id'))),
  send('POST', '/assist/rebills', async (ctx, req) => assistPortal.createRebill(ctx, await req.json())),
  act('POST', '/assist/rebills/:id/submit', (ctx, req) => assistPortal.sendRebill(ctx, req.id('id'))),
  send('POST', '/assist/rebills/:id/lines/:lineId/dispute', async (ctx, req) => assistPortal.disputeLine(ctx, req.id('id'), req.id('lineId'), await req.json())),
  get('/assist/clinics', (ctx) => assistPortal.clinics(ctx)),
  get('/assist/users', (ctx) => assistPortal.listUsers(ctx)),
  send('POST', '/assist/users', async (ctx, req, deps) => assistPortal.inviteUser(ctx, await req.json(), { initialPassword: deps.invitePassword })),
  send('PATCH', '/assist/users/:id', async (ctx, req) => assistPortal.patchUser(ctx, req.id('id'), await req.json())),
  ...partnerSettings('/assist/integration', assistPortal.integrationScope),

  // ---------------- MIG side of assistance companies (services/staffAssistance.ts) ----------------
  get('/assistance', (ctx, req) => staffAssistance.listAssistances(ctx, req.query)),
  send('POST', '/assistance', async (ctx, req, deps) => staffAssistance.createAssistance(ctx, await req.json(), { initialPassword: deps.invitePassword })),
  get('/assistance/:id/card', (ctx, req) => staffAssistance.card(ctx, req.id('id'))),
  get('/assistance/:id/cases', (ctx, req) => staffAssistance.listCases(ctx, req.id('id'), req.query)),
  send('POST', '/assistance/:id/cases/:caseId/complaint', async (ctx, req) => staffAssistance.resolveComplaint(ctx, req.id('id'), req.id('caseId'), await req.json())),
  send('PATCH', '/assistance/:id/contract', async (ctx, req) => staffAssistance.updateContract(ctx, req.id('id'), await req.json())),
  act('POST', '/assistance/:id/keys/:keyId/revoke', (ctx, req) => staffAssistance.revokeAssistanceKey(ctx, req.id('id'), req.id('keyId'))),
  get('/policies/:id/assistance', (ctx, req) => staffAssistance.policyAssignments(ctx, req.id('id'))),
  send('POST', '/policies/:id/assistance', async (ctx, req) => staffAssistance.assignPolicy(ctx, req.id('id'), await req.json())),
  get('/rebills', (ctx, req) => staffAssistance.listRebills(ctx, req.query)),
  get('/rebills/:id', (ctx, req) => staffAssistance.getRebill(ctx, req.id('id'))),
  send('POST', '/rebills/:id/lines/:lineId/decision', async (ctx, req) => staffAssistance.decideRebillLine(ctx, req.id('id'), req.id('lineId'), await req.json())),
  act('POST', '/rebills/:id/pay', (ctx, req) => staffAssistance.payRebill(ctx, req.id('id'))),
  get('/qa', (ctx, req) => staffAssistance.qaQueue(ctx, req.query)),
  send('POST', '/qa/:id/review', async (ctx, req) => staffAssistance.reviewQa(ctx, req.id('id'), await req.json())),
  get('/reports/by-assistance', (ctx) => staffAssistance.reportByAssistanceFor(ctx)),

  // ---------------- DMS parameters, four eyes (services/params.ts) ----------------
  get('/params/values', (ctx) => params.paramValuesFor(ctx)),
  get('/params', (ctx) => params.paramsScreen(ctx)),
  send('POST', '/params/changes', async (ctx, req) => params.proposeParamChange(ctx, await req.json()), CREATED),
  act('POST', '/params/changes/:id/approve', (ctx, req) => params.approveParamChange(ctx, req.id('id'))),
  send('POST', '/params/changes/:id/reject', async (ctx, req) => params.rejectParamChange(ctx, req.id('id'), await req.json())),

  // ---------------- sales: authority, leads, deals, census, quotes, offers (services/deals.ts) ----------------
  get('/staff/directory', (ctx) => deals.staffDirectory(ctx)),
  get('/admin/authority-changes', (ctx) => deals.listAuthorityChanges(ctx)),
  send('POST', '/admin/users/:id/authority', async (ctx, req) => deals.proposeAuthority(ctx, req.id('id'), await req.json()), CREATED),
  act('POST', '/admin/authority-changes/:id/approve', (ctx, req) => deals.decideAuthority(ctx, req.id('id'), 'approve')),
  send('POST', '/admin/authority-changes/:id/reject', async (ctx, req) => deals.decideAuthority(ctx, req.id('id'), 'reject', await req.json())),
  get('/leads', (ctx) => deals.listLeads(ctx)),
  send('POST', '/leads', async (ctx, req) => deals.createLead(ctx, await req.json()), CREATED),
  get('/deals', (ctx, req) => deals.listDeals(ctx, req.query)),
  get('/deals/:id', (ctx, req) => deals.getDeal(ctx, req.id('id'))),
  send('PATCH', '/deals/:id', async (ctx, req) => deals.patchDeal(ctx, req.id('id'), await req.json())),
  send('POST', '/deals/:id/stage', async (ctx, req) => deals.loseDeal(ctx, req.id('id'), await req.json())),
  S('POST', '/deals/:id/census', 'text', async (ctx, req) => deals.uploadCensus(ctx, req.id('id'), await req.text())),
  send('POST', '/quotes', async (ctx, req) => deals.createQuote(ctx, await req.json()), CREATED),
  get('/quotes/:id', (ctx, req) => deals.getQuote(ctx, req.id('id'))),
  send('PATCH', '/quotes/:id', async (ctx, req) => deals.patchQuote(ctx, req.id('id'), await req.json())),
  act('POST', '/quotes/:id/submit', (ctx, req) => deals.submitQuote(ctx, req.id('id'))),
  send('POST', '/quotes/:id/approve', async (ctx, req) => deals.approveQuote(ctx, req.id('id'), await req.json())),
  send('POST', '/quotes/:id/reject', async (ctx, req) => deals.rejectQuote(ctx, req.id('id'), await req.json())),
  act('POST', '/deals/:id/kp', (ctx, req) => deals.sendDealKp(ctx, req.id('id')), CREATED),
  act('POST', '/kp/:id/accept', (ctx, req) => deals.respondKp(ctx, req.id('id'), 'accept')),
  send('POST', '/kp/:id/decline', async (ctx, req) => deals.respondKp(ctx, req.id('id'), 'decline', await req.json())),

  // ---------------- contracts and endorsements, signing, invoices, payments (services/contracts.ts) ----------------
  get('/contracts', (ctx, req) => contracts.listContracts(ctx, req.query)),
  get('/contracts/:id', (ctx, req) => contracts.getContract(ctx, req.id('id'))),
  send('POST', '/contracts', async (ctx, req) => contracts.createContract(ctx, await req.json()), CREATED),
  send('PATCH', '/contracts/:id', async (ctx, req) => contracts.patchContract(ctx, req.id('id'), await req.json())),
  act('POST', '/contracts/:id/finance-approve', (ctx, req) => contracts.financeApprove(ctx, req.id('id'))),
  act('POST', '/contracts/:id/new-version', (ctx, req) => contracts.newVersion(ctx, req.id('id'))),
  S('POST', '/contracts/:id/insured-list', 'text', async (ctx, req) => contracts.uploadInsuredList(ctx, req.id('id'), await req.text())),
  send('POST', '/contracts/:id/terminate', async (ctx, req) => contracts.terminate(ctx, req.id('id'), await req.json()), CREATED),
  ...signingRoutes('contract'),
  get('/invoices', (ctx, req) => contracts.listInvoices(ctx, req.query)),
  send('POST', '/payments', async (ctx, req) => contracts.createPayment(ctx, await req.json()), CREATED),
  S('POST', '/payments/import-1c', 'text', async (ctx, req) => contracts.importStatement(ctx, await req.text())),
  get('/payments/queue', (ctx, req) => contracts.paymentQueue(ctx, req.query)),
  send('POST', '/payments/queue/:id/allocate', async (ctx, req) => contracts.allocatePayment(ctx, req.id('id'), await req.json())),
  get('/policies/:id/certificates', (ctx, req) => contracts.policyCertificates(ctx, req.id('id'))),
  get('/me/certificate', (ctx, req) => contracts.myCertificate(ctx, req.query.get('personId'))),
  get('/change-requests', (ctx, req) => contracts.listChangeRequests(ctx, req.query)),
  send('POST', '/change-requests', async (ctx, req) => contracts.createChangeRequest(ctx, await req.json()), CREATED),
  get('/endorsements', (ctx, req) => contracts.listEndorsements(ctx, req.query)),
  get('/endorsements/:id', (ctx, req) => contracts.getEndorsement(ctx, req.id('id'))),
  send('POST', '/endorsements', async (ctx, req) => contracts.createEndorsements(ctx, await req.json()), CREATED),
  send('PATCH', '/endorsements/:id', async (ctx, req) => contracts.patchEndorsement(ctx, req.id('id'), await req.json())),
  act('POST', '/endorsements/:id/approve-amounts', (ctx, req) => contracts.approveAmounts(ctx, req.id('id'))),
  ...signingRoutes('endorsement'),

  // ---------------- claims settlement (services/settlementApi.ts) ----------------
  send('POST', '/claims/:id/request-opinion', async (ctx, req) => settlement.requestOpinion(ctx, req.id('id'), await req.json())),
  send('POST', '/claims/:id/opinion', async (ctx, req) => settlement.giveOpinion(ctx, req.id('id'), await req.json())),
  send('POST', '/claims/:id/decide', async (ctx, req) => settlement.decide(ctx, req.id('id'), await req.json())),
  act('POST', '/claims/:id/decision/approve', (ctx, req) => settlement.approveDecision(ctx, req.id('id'))),
  send('POST', '/claims/:id/decision/reject', async (ctx, req) => settlement.rejectDecision(ctx, req.id('id'), await req.json())),
  send('PATCH', '/claims/:id/reserve', async (ctx, req) => settlement.changeReserve(ctx, req.id('id'), await req.json())),
  send('POST', '/claims/:id/flags/:flagId/dismiss', async (ctx, req) => settlement.dismissFlag(ctx, req.id('id'), req.id('flagId'), await req.json())),
  send('POST', '/claims/:id/appeal/resolve', async (ctx, req) => settlement.resolveAppeal(ctx, req.id('id'), await req.json())),
  get('/claims/:id/letter', (ctx, req) => settlement.claimLetter(ctx, req.id('id'))),
  send('POST', '/me/claims/:id/appeal', async (ctx, req) => settlement.appeal(ctx, req.id('id'), await req.json())),
  get('/me/claims/:id/letter', (ctx, req) => settlement.myClaimLetter(ctx, req.id('id'))),
  get('/reports/reserves', (ctx, req) => settlement.reserveReport(ctx, req.query)),
  get(
    '/reports/claims-register',
    async (ctx, req) => {
      const { csv, fileName } = await settlement.claimsRegister(ctx, req.query);
      return csvAnswer(csv, fileName);
    },
    RAW,
  ),

  // ---------------- AI coverage check (services/ai.ts) ----------------
  get('/ai/status', (ctx) => ai.status(ctx)),
  send('POST', '/ai/coverage-check', async (ctx, req, deps) => ai.coverageCheck(ctx, deps.aiProvider(), personIdParam(req.url), await req.json())),
  send('POST', '/ai/feedback', async (ctx, req) => ai.feedback(ctx, await req.json())),
  act('POST', '/rebills/:id/ai-precheck', (ctx, req, deps) => ai.rebillPrecheck(ctx, deps.aiProvider(), req.id('id'))),
  get('/ai/admin', (ctx) => ai.admin(ctx)),
  send('POST', '/ai/admin/changes', async (ctx, req) => ai.proposeChange(ctx, await req.json()), CREATED),
  send('POST', '/ai/admin/changes/:id/:decision', async (ctx, req) => ai.decideChange(ctx, req.id('id'), req.params.decision ?? '', await req.json())),
  act('POST', '/ai/admin/eval', (ctx) => ai.runEval(ctx)),

  // ---------------- transfer of the existing portfolio (services/migrationApi.ts) ----------------
  get('/admin/migration/batches', (ctx) => migration.listBatches(ctx)),
  send('POST', '/admin/migration/batches', async (ctx, req) => migration.createBatch(ctx, await req.json()), CREATED),
  get('/admin/migration/batches/:id', (ctx, req) => migration.getBatch(ctx, req.id('id'))),
  act('DELETE', '/admin/migration/batches/:id', (ctx, req) => migration.discardBatch(ctx, req.id('id'))),
  send('POST', '/admin/migration/batches/:id/steps/:step', async (ctx, req) => migration.uploadStep(ctx, req.id('id'), req.params.step, await req.json())),
  send('POST', '/admin/migration/batches/:id/steps/:step/confirm', async (ctx, req) => migration.confirmStep(ctx, req.id('id'), req.params.step, await req.json())),
  act('POST', '/admin/migration/batches/:id/steps/:step/skip', (ctx, req) => migration.skipStep(ctx, req.id('id'), req.params.step)),
  act('POST', '/admin/migration/batches/:id/submit', (ctx, req) => migration.submitBatch(ctx, req.id('id'))),
  act('POST', '/admin/migration/batches/:id/approve', (ctx, req) => migration.approveBatch(ctx, req.id('id'))),
  send('POST', '/admin/migration/batches/:id/reject', async (ctx, req) => migration.rejectBatch(ctx, req.id('id'), await req.json())),
  send('POST', '/admin/migration/batches/:id/rollback', async (ctx, req) => migration.rollback(ctx, req.id('id'), await req.json())),
  send('POST', '/admin/migration/manual', async (ctx, req) => migration.manualContract(ctx, await req.json()), CREATED),
  // The signed scan of a transferred contract, attached later (the upload rules of contract scans).
  S('POST', '/contracts/:id/migrated-scan', 'form', async (ctx, req) => migration.attachMigratedScan(ctx, req.id('id'), await scanForm(req))),

  // ---------------- help (services/help.ts) ----------------
  get('/help/toc', (ctx, req, deps) => help.toc(ctx, deps.help, req.query.get('locale'))),
  get('/help', (ctx, req, deps) => help.guide(ctx, deps.help, req.query.get('locale'))),
  get('/help/glossary', (ctx, req, deps) => help.glossary(ctx, deps.help, req.query.get('locale'))),
  get('/help/search', (ctx, req, deps) => help.search(ctx, deps.help, req.query.get('q'), req.query.get('locale'))),
  get('/help/articles/:anchor', (ctx, req, deps) => help.article(ctx, deps.help, req.params.anchor ?? '', req.query.get('locale'))),
  send('POST', '/ai/help-answer', async (ctx, req, deps) => help.answer(ctx, deps.help, await req.json())),
  send('POST', '/ai/help-answer/:id/feedback', async (ctx, req) => help.feedback(ctx, req.id('id'), await req.json())),
  get('/ai/admin/help-questions', (ctx) => help.adminQuestions(ctx)),
];

/** Signing routes shared by contracts and endorsements (LIFECYCLE_SPEC §8: the same rules and methods). */
function signingRoutes(kind: contracts.DocKind): SessionRoute[] {
  const base = `/${kind === 'contract' ? 'contracts' : 'endorsements'}/:id`;
  return [
    send('POST', `${base}/sign`, async (ctx, req) => contracts.sign(ctx, kind, req.id('id'), await req.json())),
    send('POST', `${base}/edo`, async (ctx, req) => contracts.sendToEdo(ctx, kind, req.id('id'), await req.json())),
    S('POST', `${base}/scan`, 'form', async (ctx, req) => contracts.uploadScan(ctx, kind, req.id('id'), await scanForm(req))),
    send('POST', `${base}/scan/verify`, async (ctx, req) => contracts.verifyScan(ctx, kind, req.id('id'), await req.json())),
    send('POST', `${base}/originals`, async (ctx, req) => contracts.originals(ctx, kind, req.id('id'), await req.json())),
    act('POST', `${base}/submit-legal`, (ctx, req) => contracts.submitLegal(ctx, kind, req.id('id'))),
    send('POST', `${base}/legal-approve`, async (ctx, req) => contracts.legalApprove(ctx, kind, req.id('id'), await req.json())),
    send('POST', `${base}/legal-return`, async (ctx, req) => contracts.legalReturn(ctx, kind, req.id('id'), await req.json())),
    act('POST', `${base}/send`, (ctx, req) => contracts.sendToClient(ctx, kind, req.id('id'))),
  ];
}
