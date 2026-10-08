/*
 * Clinic cabinet API (/api/clinic/...). Every handler resolves the clinic from the session, never
 * from the request; objects of other clinics answer 404 (CLINIC_SPEC §9.9).
 */
import { msg, tm } from '@mig/i18n';
import { http } from 'msw';
import Papa from 'papaparse';
import { z } from 'zod';
import type { Action } from '@mig/domain/auth/permissions';
import type { SessionUser } from '@mig/contracts';
import type {
  ClinicDocuments,
  ClinicOverview,
  ClinicUserView,
  ClinicVisitView,
  RegistryImportResult,
} from '@mig/contracts/dto';
import {
  clinicUserInviteSchema,
  clinicUserPatchSchema,
  guaranteeAnswerSchema,
  registryBuildSchema,
} from '@mig/contracts/forms';
import {
  coverageCheckRequest,
  declineRequest,
  disputeRequest,
  guaranteeCreateRequest,
  registryLineInput,
  rescheduleRequest,
} from '@mig/contracts/integration';
import {
  guaranteeNumber,
  REGISTRY_CSV_MAX_BYTES,
  REGISTRY_CSV_MAX_ROWS,
} from '@mig/domain/clinics';
import { readAttachment, readForm } from '../uploads';
import { db, type ClinicUserRow, type Db, type GuaranteeRow, type IntegrationClientRow } from '../db';
import { API, audit, body, conflict, forbidden, HttpError, notFound, param, requirePermission, requireSession, route, validate } from '../http';
import { randomId } from '@mig/seed/rng';
import { DAY, isoDay, parseIso, tzIso } from '@mig/seed/time';
import { DEMO_PASSWORD } from '@mig/seed/credentials';
import { clinicSlots } from './staff-misc';
import { partnerIntegrationHandlers } from './partner-integration';
import { assistanceOn } from '@mig/domain/assistance';
import { assistanceName, notifyAssistance, payerOfLine } from '../assistance-core';
import {
  actorOf,
  appointmentOfClinic,
  buildLine,
  checkPatient,
  clinicOf,
  coverageFor,
  isOverdueRequest,
  lineProblems,
  priceListOf,
  pushEvent,
  recomputeRegistry,
  registryOfClinic,
  requireVisit,
  respondToAppointment,
  submitRegistry,
  toGuaranteeView,
  toRegistrySummary,
  toRegistryView,
  visitOfClinic,
  type ClinicActor,
} from '../clinic-core';
import { nextDocNumber, numbering } from '../params';

const C = `${API}/clinic`;

function requireClinic(request: Request, action: Action): { user: SessionUser; actor: ClinicActor; d: Db } {
  const { user } = requireSession(request);
  if (user.role !== 'clinic_registrar' && user.role !== 'clinic_admin') throw forbidden();
  requirePermission(user, action, { clinicId: user.clinicId });
  return { user, actor: actorOf(user), d: db() };
}

const toUserView = (u: ClinicUserRow): ClinicUserView => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt });

export async function attachGuaranteeFiles(d: Db, g: GuaranteeRow, form: FormData): Promise<void> {
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (g.attachments.length + files.length > 10) throw new HttpError(422, 'validation', 'srv.file.max10', { fields: { files: msg('srv.file.max10') } });
  for (const file of files) {
    const { bytes, mime } = await readAttachment(file);
    const id = randomId();
    const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
    const fileName = `document-${g.attachments.length + 1}.${ext}`;
    d.files.push({ id, mime, bytes, guaranteeId: g.id, clinicId: g.clinicId, fileName });
    g.attachments.push({ id, kind: 'referral', fileName, mime, sizeBytes: bytes.length, url: `/api/files/${id}` });
  }
}

function monthStartIso(now = Date.now()): string {
  return isoDay(now).slice(0, 7);
}

export const clinicHandlers = [
  // ---- overview ----
  http.get(
    `${C}/overview`,
    route(({ request }) => {
      const { actor, d } = requireClinic(request, 'clinic.check_patient');
      const clinic = clinicOf(d, actor.clinicId);
      const today = isoDay(Date.now());
      const mine = d.appointments.filter((a) => a.clinicId === clinic.id);
      const unanswered = mine.filter((a) => a.status === 'requested' && !a.proposedStartsAt);
      const current = d.registries
        .filter((r) => r.clinicId === clinic.id && r.period === monthStartIso())
        .sort((a, b) => (a.status === 'draft' ? -1 : b.status === 'draft' ? 1 : 0))[0];
      const out: ClinicOverview = {
        clinicName: clinic.name,
        clinicLegalForm: clinic.legalForm,
        integrationMode: clinic.integrationMode,
        appointmentsToday: mine.filter((a) => isoDay(parseIso(a.startsAt)) === today && (a.status === 'confirmed' || a.status === 'requested')).length,
        unanswered: unanswered.length,
        unansweredOverdue: unanswered.filter((a) => isOverdueRequest(d, a)).length,
        guaranteesPending: d.guarantees.filter((g) => g.clinicId === clinic.id && (g.status === 'requested' || g.status === 'info_requested')).length,
        currentRegistry: current ? { id: current.id, period: current.period, status: current.status, claimed: current.totals.claimed } : null,
        events: d.clinicEvents.filter((e) => e.clinicId === clinic.id).slice(0, 12).map(({ clinicId: _c, ...e }) => e),
      };
      return out;
    }),
  ),
  // ---- patient check & visits ----
  http.post(
    `${C}/check`,
    route(async ({ request }) => {
      const { actor, d } = requireClinic(request, 'clinic.check_patient');
      const input = await body(request, coverageCheckRequest);
      const result = checkPatient(input, actor, 'portal');
      pushEvent(d, actor.clinicId, 'Проверен пациент, открыт визит');
      return result;
    }),
  ),
  http.get(
    `${C}/visits`,
    route(({ request, url }) => {
      const { actor, d } = requireClinic(request, 'clinic.check_patient');
      const scope = url.searchParams.get('scope');
      const periodParam = url.searchParams.get('period');
      const now = Date.now();
      let list = d.visits.filter((v) => v.clinicId === actor.clinicId);
      if (scope === 'active') list = list.filter((v) => parseIso(v.expiresAt) > now);
      else if (periodParam && /^\d{4}-\d{2}$/.test(periodParam)) list = list.filter((v) => v.openedAt.startsWith(periodParam));
      else list = list.filter((v) => isoDay(parseIso(v.openedAt)) === isoDay(now));
      return list
        .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
        .map((v): ClinicVisitView => ({
          id: v.id,
          insuredName: d.insured.find((i) => i.id === v.insuredId)?.fullName ?? '—',
          method: v.method,
          openedAt: v.openedAt,
          expiresAt: v.expiresAt,
        }));
    }),
  ),
  http.get(
    `${C}/visits/:id/coverage`,
    route((ctx) => {
      const { actor, d } = requireClinic(ctx.request, 'clinic.check_patient');
      const v = requireVisit(d, actor.clinicId, param(ctx, 'id'));
      return coverageFor(d, v);
    }),
  ),
  // ---- appointments ----
  http.get(
    `${C}/appointments`,
    route(({ request, url }) => {
      const { actor, d } = requireClinic(request, 'clinic.appointments.manage');
      const view = url.searchParams.get('view') ?? 'requests';
      let list = d.appointments.filter((a) => a.clinicId === actor.clinicId);
      if (view === 'requests') {
        list = list.filter((a) => a.status === 'requested').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      } else {
        const from = url.searchParams.get('from') ?? isoDay(Date.now());
        const days = Math.min(14, Math.max(1, Number(url.searchParams.get('days')) || 1));
        const fromMs = parseIso(from);
        list = list
          .filter((a) => (a.status === 'confirmed' || a.status === 'requested' || a.status === 'completed') && parseIso(a.startsAt) >= fromMs && parseIso(a.startsAt) < fromMs + days * DAY)
          .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
      }
      return list.map((a) => ({ ...a, overdue: isOverdueRequest(d, a) }));
    }),
  ),
  http.get(
    `${C}/slots`,
    route(({ request, url }) => {
      const { actor, d } = requireClinic(request, 'clinic.appointments.manage');
      const clinic = clinicOf(d, actor.clinicId);
      const date = url.searchParams.get('date') ?? isoDay(Date.now());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      const taken = new Set(d.appointments.filter((a) => a.clinicId === clinic.id && a.status !== 'cancelled' && a.status !== 'declined').map((a) => a.startsAt));
      return clinicSlots(clinic, date).filter((s) => !taken.has(s.startsAt));
    }),
  ),
  ...(['confirm', 'reschedule', 'decline'] as const).map((kind) =>
    http.post(
      `${C}/appointments/:id/${kind}`,
      route(async (ctx) => {
        const { actor, d } = requireClinic(ctx.request, 'clinic.appointments.manage');
        const a = appointmentOfClinic(d, actor.clinicId, param(ctx, 'id'));
        if (kind === 'confirm') respondToAppointment(a, 'clinic', { kind });
        else if (kind === 'reschedule') respondToAppointment(a, 'clinic', { kind, startsAt: (await body(ctx.request, rescheduleRequest)).startsAt });
        else respondToAppointment(a, 'clinic', { kind, reason: (await body(ctx.request, declineRequest)).reason });
        pushEvent(d, actor.clinicId, kind === 'confirm' ? 'Запись подтверждена' : kind === 'reschedule' ? 'Пациенту предложено другое время' : 'Заявка на запись отклонена');
        return a;
      }),
    ),
  ),
  // ---- guarantees ----
  http.get(
    `${C}/guarantees`,
    route(({ request, url }) => {
      const { actor, d } = requireClinic(request, 'guarantees.read');
      const status = url.searchParams.get('status');
      return d.guarantees
        .filter((g) => g.clinicId === actor.clinicId && (!status || status.split(',').includes(g.status)))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((g) => toGuaranteeView(d, g));
    }),
  ),
  http.get(
    `${C}/guarantees/:id`,
    route((ctx) => {
      const { actor, d } = requireClinic(ctx.request, 'guarantees.read');
      const g = d.guarantees.find((x) => x.id === param(ctx, 'id') && x.clinicId === actor.clinicId);
      if (!g) throw notFound();
      return toGuaranteeView(d, g);
    }),
  ),
  http.post(
    `${C}/guarantees`,
    route(async ({ request }) => {
      const { user, actor, d } = requireClinic(request, 'guarantees.request');
      const input = await body(request, guaranteeCreateRequest);
      return toGuaranteeView(d, createGuarantee(d, actor, input, user.displayName));
    }),
  ),
  http.post(
    `${C}/guarantees/:id/documents`,
    route(async (ctx) => {
      const { actor, d } = requireClinic(ctx.request, 'guarantees.request');
      const g = d.guarantees.find((x) => x.id === param(ctx, 'id') && x.clinicId === actor.clinicId);
      if (!g) throw notFound();
      if (g.status !== 'requested' && g.status !== 'info_requested') throw conflict('srv.guarantee.alreadyDecided');
      const form = await readForm(ctx.request);
      const commentRaw = form.get('comment');
      await attachGuaranteeFiles(d, g, form);
      if (g.status === 'info_requested') {
        const { comment } = validate(guaranteeAnswerSchema, { comment: typeof commentRaw === 'string' ? commentRaw : '' });
        g.infoComment = comment;
        g.status = 'requested';
        pushEvent(d, actor.clinicId, `По ${g.number} отправлены документы`);
      }
      return toGuaranteeView(d, g);
    }),
  ),
  http.get(
    `${C}/price-list`,
    route(({ request, url }) => {
      const { actor, d } = requireClinic(request, 'clinic.check_patient');
      // With a visit: the prices of the patient's payer — the pair «clinic + assistance» or MIG (ASSISTANCE_SPEC §5.3).
      const visitId = url.searchParams.get('visitId');
      if (!visitId) return priceListOf(d, actor.clinicId);
      if (!/^[0-9a-f-]{36}$/i.test(visitId)) throw notFound();
      const v = visitOfClinic(d, actor.clinicId, visitId);
      return priceListOf(d, actor.clinicId, payerOfLine(d, { visitId: v.id, serviceDate: isoDay(Date.now()) }));
    }),
  ),
  // ---- registries (clinic_admin) ----
  http.get(
    `${C}/registries`,
    route(({ request }) => {
      const { actor, d } = requireClinic(request, 'registries.submit');
      return d.registries
        .filter((r) => r.clinicId === actor.clinicId)
        .sort((a, b) => (a.period === b.period ? (a.submittedAt ?? '9') < (b.submittedAt ?? '9') ? 1 : -1 : a.period < b.period ? 1 : -1))
        .map((r) => toRegistrySummary(d, r));
    }),
  ),
  http.get(
    `${C}/registries/:id`,
    route((ctx) => {
      const { actor, d } = requireClinic(ctx.request, 'registries.submit');
      return toRegistryView(d, registryOfClinic(d, actor.clinicId, param(ctx, 'id')));
    }),
  ),
  http.post(
    `${C}/registries/build`,
    route(async ({ request }) => {
      const { actor, d } = requireClinic(request, 'registries.submit');
      const { period } = await body(request, registryBuildSchema);
      let r = d.registries.find((x) => x.clinicId === actor.clinicId && x.period === period && x.status === 'draft');
      if (!r) {
        r = { id: randomId(), clinicId: actor.clinicId, period, status: 'draft', source: 'portal', lines: [], totals: { claimed: 0, accepted: 0, rejected: 0, paid: 0 } };
        d.registries.push(r);
      }
      const inRegistries = new Set(d.registries.filter((x) => x.clinicId === actor.clinicId).flatMap((x) => x.lines.map((l) => l.visitId)));
      const visits = d.visits.filter((v) => v.clinicId === actor.clinicId && v.openedAt.startsWith(period) && !inRegistries.has(v.id));
      for (const v of visits) {
        const approved = d.guarantees.find((g) => g.visitId === v.id && g.status === 'approved');
        r.lines.push(buildLine(d, actor.clinicId, { visitId: v.id, serviceDate: isoDay(parseIso(v.openedAt)), serviceCode: 'TH-101', icd10: 'Z00.0', quantity: 1 }));
        if (approved) {
          r.lines.push(
            buildLine(d, actor.clinicId, {
              visitId: v.id,
              serviceDate: isoDay(parseIso(v.openedAt)),
              serviceCode: approved.serviceCode,
              icd10: approved.icd10,
              quantity: 1,
              price: Math.min(approved.approvedAmount ?? approved.estimatedCost, priceListOf(d, actor.clinicId).find((p) => p.code === approved.serviceCode)?.price ?? 0),
              guaranteeNumber: approved.number,
            }),
          );
        }
      }
      recomputeRegistry(r);
      return toRegistryView(d, r);
    }),
  ),
  http.post(
    `${C}/registries/import`,
    route(async ({ request, url }) => {
      const { actor, d } = requireClinic(request, 'registries.submit');
      const form = await readForm(request);
      const file = form.get('file');
      const { period } = validate(registryBuildSchema, { period: form.get('period') });
      if (!(file instanceof File)) throw new HttpError(422, 'validation', 'srv.file.chooseCsv', { fields: { file: msg('srv.file.chooseCsv') } });
      if (file.size > REGISTRY_CSV_MAX_BYTES) throw new HttpError(422, 'validation', 'srv.file.tooLarge5mb', { fields: { file: msg('srv.file.tooLarge5mb') } });
      const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
      if (parsed.data.length > REGISTRY_CSV_MAX_ROWS) throw new HttpError(422, 'validation', 'srv.registry.maxRows', { params: { max: REGISTRY_CSV_MAX_ROWS }, fields: { file: msg('srv.registry.tooManyRows') } });
      const required = ['visit_id', 'service_date', 'service_code', 'icd10', 'quantity', 'price'];
      const missing = required.filter((c) => !(parsed.meta.fields ?? []).includes(c));
      if (missing.length) throw new HttpError(422, 'validation', 'srv.registry.missingColumns', { params: { columns: missing.join(', ') }, fields: { file: msg('srv.registry.useTemplate') } });
      const errors: RegistryImportResult['errors'] = [];
      const lines = [];
      for (const [k, row] of parsed.data.entries()) {
        const rowNo = k + 2;
        const candidate = {
          visitId: (row.visit_id ?? '').trim(),
          serviceDate: (row.service_date ?? '').trim(),
          serviceCode: (row.service_code ?? '').trim(),
          icd10: (row.icd10 ?? '').trim(),
          quantity: Number((row.quantity ?? '').trim()),
          price: Number((row.price ?? '').replace(/\s/g, '')),
          ...(row.guarantee_number?.trim() ? { guaranteeNumber: row.guarantee_number.trim() } : {}),
        };
        const r = registryLineInput.safeParse(candidate);
        if (!r.success) {
          errors.push({ row: rowNo, message: r.error.issues.map((i) => `${i.path.join('.')}: ${tm(i.message)}`).join('; ') });
          continue;
        }
        if (!r.data.serviceDate.startsWith(period)) {
          errors.push({ row: rowNo, message: msg('srv.registry.outOfPeriod', { period }) });
          continue;
        }
        let line;
        try {
          line = buildLine(d, actor.clinicId, r.data);
        } catch {
          errors.push({ row: rowNo, message: msg('srv.registry.visitNotInClinic') });
          continue;
        }
        const problems = lineProblems(d, actor.clinicId, line);
        if (problems.length) errors.push({ row: rowNo, message: problems.length === 1 ? problems[0]! : problems.map((p) => tm(p)).join('; ') });
        else lines.push(line);
      }
      const out: RegistryImportResult = { total: parsed.data.length, valid: lines.length, errors };
      if (url.searchParams.get('commit') === '1') {
        if (!lines.length) throw new HttpError(422, 'validation', 'srv.registry.noValidRows');
        const reg = { id: randomId(), clinicId: actor.clinicId, period, status: 'draft' as const, source: 'csv' as const, lines, totals: { claimed: 0, accepted: 0, rejected: 0, paid: 0 } };
        recomputeRegistry(reg);
        d.registries.push(reg);
        out.registryId = reg.id;
      }
      return out;
    }),
  ),
  http.post(
    `${C}/registries/:id/lines`,
    route(async (ctx) => {
      const { actor, d } = requireClinic(ctx.request, 'registries.submit');
      const r = registryOfClinic(d, actor.clinicId, param(ctx, 'id'));
      if (r.status !== 'draft') throw conflict('srv.registry.draftOnly');
      r.lines.push(buildLine(d, actor.clinicId, await body(ctx.request, registryLineInput)));
      recomputeRegistry(r);
      return toRegistryView(d, r);
    }),
  ),
  http.delete(
    `${C}/registries/:id/lines/:lineId`,
    route((ctx) => {
      const { actor, d } = requireClinic(ctx.request, 'registries.submit');
      const r = registryOfClinic(d, actor.clinicId, param(ctx, 'id'));
      if (r.status !== 'draft') throw conflict('srv.registry.draftOnly');
      const lineId = param(ctx, 'lineId');
      if (!r.lines.some((l) => l.id === lineId)) throw notFound();
      r.lines = r.lines.filter((l) => l.id !== lineId);
      recomputeRegistry(r);
      return toRegistryView(d, r);
    }),
  ),
  http.post(
    `${C}/registries/:id/submit`,
    route((ctx) => {
      const { actor, d } = requireClinic(ctx.request, 'registries.submit');
      const r = registryOfClinic(d, actor.clinicId, param(ctx, 'id'));
      submitRegistry(d, r, actor);
      return toRegistryView(d, r);
    }),
  ),
  http.post(
    `${C}/registries/:id/lines/:lineId/dispute`,
    route(async (ctx) => {
      const { actor, d } = requireClinic(ctx.request, 'registries.submit');
      const r = registryOfClinic(d, actor.clinicId, param(ctx, 'id'));
      const line = r.lines.find((l) => l.id === param(ctx, 'lineId'));
      if (!line) throw notFound();
      if (line.status !== 'rejected' || r.status === 'paid') throw conflict('srv.registry.disputeRejectedUnpaid');
      line.disputeComment = (await body(ctx.request, disputeRequest)).comment;
      line.status = 'disputed';
      pushEvent(d, actor.clinicId, `Оспорена строка реестра за ${r.period}`);
      return toRegistryView(d, r);
    }),
  ),
  // ---- documents ----
  http.get(
    `${C}/documents`,
    route(({ request }) => {
      const { actor, d } = requireClinic(request, 'clinic.check_patient');
      const clinic = clinicOf(d, actor.clinicId);
      const out: ClinicDocuments = {
        contract: { number: nextDocNumber('clinicContract', { code: clinic.id.slice(0, 4) }), signedAt: isoDay(parseIso(clinic.contractUntil) - 365 * DAY), validUntil: clinic.contractUntil },
        acts: d.registries
          .filter((r) => r.clinicId === clinic.id && r.status !== 'draft' && r.status !== 'submitted')
          .sort((a, b) => (a.period < b.period ? 1 : -1))
          .map((r) => ({ registryId: r.id, period: r.period, claimed: r.totals.claimed, accepted: r.totals.accepted, paid: r.totals.paid, paidAt: r.paidAt })),
      };
      return out;
    }),
  ),
  // ---- users (clinic_admin) ----
  http.get(
    `${C}/users`,
    route(({ request }) => {
      const { actor, d } = requireClinic(request, 'clinic.users.manage');
      return d.clinicUsers.filter((u) => u.clinicId === actor.clinicId).map(toUserView);
    }),
  ),
  http.post(
    `${C}/users`,
    route(async ({ request }) => {
      const { actor, d } = requireClinic(request, 'clinic.users.manage');
      const input = await body(request, clinicUserInviteSchema);
      if (d.clinicUsers.some((u) => u.email === input.email) || d.staff.some((s) => s.email === input.email) || d.hrUsers.some((h) => h.email === input.email)) {
        throw new HttpError(409, 'conflict', 'srv.users.emailTaken', { fields: { email: msg('srv.users.emailInUse') } });
      }
      const row: ClinicUserRow = { id: randomId(), ...input, password: DEMO_PASSWORD, clinicId: actor.clinicId, active: true, createdAt: tzIso(Date.now()) };
      d.clinicUsers.push(row);
      audit(actor, 'role_change', { targetType: 'user', targetId: row.id, targetLabel: row.fullName });
      return toUserView(row);
    }),
  ),
  http.patch(
    `${C}/users/:id`,
    route(async (ctx) => {
      const { actor, d } = requireClinic(ctx.request, 'clinic.users.manage');
      const u = d.clinicUsers.find((x) => x.id === param(ctx, 'id') && x.clinicId === actor.clinicId);
      if (!u) throw notFound();
      const patch = await body(ctx.request, clinicUserPatchSchema);
      if (u.id === actor.id && (patch.active === false || patch.role === 'clinic_registrar')) throw conflict('srv.clinicUsers.selfChange');
      if (patch.role) u.role = patch.role;
      if (patch.active !== undefined) {
        u.active = patch.active;
        if (!patch.active) d.sessions = d.sessions.filter((s) => s.userId !== u.id);
      }
      audit(actor, patch.active === false ? 'user_deactivate' : 'role_change', { targetType: 'user', targetId: u.id, targetLabel: u.fullName });
      return toUserView(u);
    }),
  ),
  // ---- integration (clinic_admin): the partner framework shared with assistance companies ----
  ...partnerIntegrationHandlers(`${C}/integration`, (request) => {
    const { actor, d } = requireClinic(request, 'clinic.integration.manage');
    return { actor, partnerId: actor.clinicId, partnerType: 'clinic' as const, mode: clinicOf(d, actor.clinicId).integrationMode, d };
  }),
];

export function createGuarantee(
  d: Db,
  actor: ClinicActor,
  input: z.infer<typeof guaranteeCreateRequest>,
  byName: string,
): GuaranteeRow {
  const v = requireVisit(d, actor.clinicId, input.visitId);
  const svc = priceListOf(d, actor.clinicId).find((p) => p.code === input.serviceCode);
  if (!svc) throw new HttpError(422, 'validation', 'srv.registry.serviceNotInPrice', { fields: { serviceCode: msg('srv.registry.chooseService') } });
  const who = d.insured.find((i) => i.id === v.insuredId)!;
  // The letter goes to the assistance of the insured person on the date of the request (ASSISTANCE_SPEC §5.2).
  const assistanceId = assistanceOn(d.assignments, who.policyId, isoDay(Date.now()));
  d.guaranteeSeq += 1;
  const g: GuaranteeRow = {
    id: randomId(),
    number: guaranteeNumber(new Date().getFullYear(), d.guaranteeSeq, numbering()),
    clinicId: actor.clinicId,
    visitId: v.id,
    insuredId: who.id,
    insuredName: who.fullName,
    serviceCode: svc.code,
    serviceName: svc.name,
    icd10: input.icd10,
    estimatedCost: input.estimatedCost,
    status: 'requested',
    approvals: [],
    comment: input.comment || undefined,
    attachments: [],
    createdAt: tzIso(Date.now()),
    policyId: who.policyId,
    assistanceId,
    ...(assistanceId ? { assistanceName: assistanceName(d, assistanceId) ?? undefined } : {}),
  };
  d.guarantees.unshift(g);
  audit(actor, 'guarantee_requested', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number });
  void notifyAssistance(d, assistanceId, 'guarantee.requested', g.id);
  pushEvent(d, actor.clinicId, `Запрошено гарантийное письмо ${g.number} (${byName})`);
  return g;
}

export function revokeKey(d: Db, k: IntegrationClientRow, actor: { id: string; displayName: string; role: SessionUser['role'] }): void {
  if (k.revokedAt) throw conflict('srv.apiKeys.alreadyRevoked');
  k.revokedAt = tzIso(Date.now());
  // Already issued tokens stop working immediately.
  d.accessTokens = d.accessTokens.filter((t) => t.clientRowId !== k.id);
  audit(actor, 'integration_key_revoked', { targetType: 'integration', targetId: k.id, targetLabel: k.name });
  pushEvent(d, k.clinicId, `Ключ API «${k.name}» отозван`);
}
