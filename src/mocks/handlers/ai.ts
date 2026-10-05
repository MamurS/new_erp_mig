/*
 * AI coverage check gateway (AI_COVERAGE_SPEC §3.3, §4, §5). The contract is the one the backend will
 * serve: POST /api/ai/coverage-check. Scope is always resolved on the server: the insured person only
 * through the session, clinics through an open visit or their own registry, assistances through the
 * assignment of the policy, MIG through the claim, letter or line. Settings change by four eyes.
 */
import { msg } from '@/i18n/core';
import { http, HttpResponse } from 'msw';
import type { AiCallLog, AiScenario, AiSettings, SessionUser } from '@/shared/types';
import type { AiAdminView, AiCheckItem, AiCheckResult, AiStatus } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole } from '@/shared/domain/labels';
import { catalogItem } from '@/features/coverage/catalog';
import { COVERAGE_RULES } from '@/features/coverage/rules';
import { limitStatus, type CoverageContext } from '@/features/coverage/engine';
import { runCoverageCheck } from '@/features/ai/pipeline';
import { PROMPT_VERSION } from '@/features/ai/prompts';
import { runGolden } from '@/features/ai/eval/run';
import { AI_PROVIDERS_AVAILABLE, AI_SCENARIOS, aiEnabled } from '@/features/ai/settings';
import { aiCheckRequestSchema, aiFeedbackSchema, aiRejectSchema, aiSettingsChangeSchema } from '@/shared/schemas/forms';
import { db, type Db, type InsuredRow } from '../db';
import { API, audit, body, conflict, forbidden, HttpError, notFound, param, requirePermission, requireSession, route } from '../http';
import { createMockProvider } from '../ai-provider';
import { mockConfig } from '../config';
import { dmsParam } from '../params';
import { findRegistryLine, insuredOfVisit } from '../assistance-core';
import { registryOfClinic, requireVisit } from '../clinic-core';
import { randomId } from '../rng';
import { sha256Hex } from '../settlement-core';
import { isoDay, tzIso } from '../time';
import { limitsFor } from '../views';

const provider = () => createMockProvider({ latency: mockConfig.latency[1] > 0 });

function contextOf(d: Db, i: InsuredRow): CoverageContext {
  const p = d.policies.find((x) => x.id === i.policyId);
  if (!p) throw notFound();
  return {
    program: p.program,
    policy: { id: p.id, status: p.status, startDate: p.startDate, endDate: p.endDate },
    insured: { id: i.id, insuredFrom: i.insuredFrom, excludedFrom: i.excludedFrom, status: i.status },
    limits: limitsFor(d, i),
    rules: COVERAGE_RULES,
    catalog: catalogItem,
  };
}

interface Job {
  insured: InsuredRow;
  text?: string;
  serviceCode?: string;
  icd10?: string;
  amount?: number;
  serviceDate: string;
  subject?: AiCallLog['subject'];
  subjectId?: string;
}

async function check(d: Db, user: SessionUser, scenario: AiScenario, job: Job, opts: { clinic?: boolean; lang?: 'ru' | 'uz'; receipt?: boolean }): Promise<AiCheckItem> {
  const settings = d.ai.settings;
  const ctx = contextOf(d, job.insured);
  const started = Date.now();
  const out = await runCoverageCheck(
    { scenario, text: job.text, serviceCode: job.serviceCode, icd10: job.icd10, amount: job.amount, serviceDate: job.serviceDate, lang: opts.lang },
    ctx,
    // Redaction before any provider except a local one; the mock is treated like an external one.
    { provider: provider(), threshold: settings.confidenceThreshold, knownNames: [job.insured.fullName], redact: settings.scenarios[scenario].provider !== 'local' },
  );
  const logId = randomId();
  const input = job.text ?? job.serviceCode ?? '';
  d.ai.logs.unshift({
    id: logId,
    at: tzIso(Date.now()),
    scenario,
    promptVersion: out.promptVersion,
    provider: settings.scenarios[scenario].provider,
    model: provider().model,
    inputHash: await sha256Hex(new TextEncoder().encode(input)),
    inputRedacted: out.redacted || input,
    output: { codes: out.matches.map((m) => m.code), decision: out.needsSpecialist ? 'unknown' : out.verdict.decision, needsSpecialist: out.needsSpecialist },
    confidence: out.confidence,
    latencyMs: Date.now() - started,
    userId: user.id,
    userRole: user.role,
    ...(job.subject ? { subject: job.subject } : {}),
    suspicious: out.suspicious,
  });
  if (d.ai.logs.length > 2000) d.ai.logs.length = 2000;
  const verdict = opts.clinic ? { ...out.verdict, limit: null } : out.verdict;
  const item: AiCheckItem = {
    logId,
    input,
    ...(job.amount !== undefined ? { amount: job.amount } : {}),
    ...(job.subjectId ? { subjectId: job.subjectId } : {}),
    matches: out.matches,
    confidence: out.confidence,
    needsSpecialist: out.needsSpecialist,
    verdict,
    clauses: out.clauses,
    explanation: out.explanation,
    suspicious: out.suspicious,
  };
  if (opts.clinic) item.limitStatus = limitStatus(out.verdict.limit, ctx.limits, dmsParam('limitLowShare'));
  if (opts.receipt) item.receiptLabel = out.needsSpecialist ? 'check' : out.verdict.decision === 'covered' ? 'refund' : out.verdict.decision === 'needs_guarantee' || out.verdict.decision === 'unknown' ? 'check' : 'no_refund';
  return item;
}

const OFF: AiCheckResult = { available: false, items: [], suspicious: false };

function metrics(d: Db): AiAdminView['metrics'] {
  return AI_SCENARIOS.map((scenario) => {
    const logs = d.ai.logs.filter((l) => l.scenario === scenario);
    const rated = logs.filter((l) => l.feedback);
    return {
      scenario,
      calls: logs.length,
      rated: rated.length,
      agreeShare: rated.length ? rated.filter((l) => l.feedback!.agree).length / rated.length : null,
      specialistShare: logs.length ? logs.filter((l) => l.output.needsSpecialist).length / logs.length : null,
      avgLatencyMs: logs.length ? Math.round(logs.reduce((s, l) => s + l.latencyMs, 0) / logs.length) : null,
    };
  });
}

function adminView(d: Db): AiAdminView {
  return {
    settings: d.ai.settings,
    changes: d.ai.changes.slice(0, 20),
    metrics: metrics(d),
    disagreements: d.ai.logs
      .filter((l) => l.feedback && !l.feedback.agree)
      .slice(0, 10)
      .map((l) => ({ id: l.id, at: l.feedback!.at, scenario: l.scenario, input: l.inputRedacted, decision: l.output.decision, comment: l.feedback!.comment ?? '', byName: l.feedback!.byName })),
    promptVersion: PROMPT_VERSION,
    providersAvailable: [...AI_PROVIDERS_AVAILABLE],
  };
}

const describe = (s: AiSettings) => `${AI_SCENARIOS.filter((x) => s.scenarios[x].enabled).length}/4 сценариев, порог ${Math.round(s.confidenceThreshold * 100)}%${s.killSwitch ? ', ИИ отключён везде' : ''}`;

export const aiHandlers = [
  http.get(
    `${API}/ai/status`,
    route(({ request }) => {
      requireSession(request);
      const s = db().ai.settings;
      const out: AiStatus = { killSwitch: s.killSwitch, scenarios: Object.fromEntries(AI_SCENARIOS.map((x) => [x, aiEnabled(s, x)])) as AiStatus['scenarios'] };
      return out;
    }),
  ),
  http.post(
    `${API}/ai/coverage-check`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      const input = await body(request, aiCheckRequestSchema);
      const d = db();
      const today = isoDay(Date.now());
      const scenario = input.scenario;

      // ---- the insured person: only their own policy, never by id ----
      if (scenario === 'insured') {
        if (user.role !== 'insured' || !user.insuredId || !can(user, 'ai.coverage.self', { insuredId: user.insuredId })) throw forbidden();
        const me = d.insured.find((i) => i.id === user.insuredId);
        if (!me) throw notFound();
        if (!aiEnabled(d.ai.settings, 'insured')) return OFF;
        const lang = input.lang ?? 'ru';
        if (input.items?.length) {
          const items: AiCheckItem[] = [];
          for (const [k, it] of input.items.entries()) items.push(await check(d, user, 'insured', { insured: me, text: it.text, amount: it.amount, serviceDate: today, subject: { type: 'receipt_item' }, subjectId: String(k) }, { lang, receipt: true }));
          const limit = items.find((x) => x.verdict.limit)?.verdict.limit;
          const refundable = items.filter((x) => x.receiptLabel === 'refund').reduce((s, x) => s + (x.amount ?? 0), 0);
          return { available: true, items, suspicious: items.some((x) => x.suspicious), expectedReimbursement: limit ? Math.min(refundable, limit.remaining) : refundable } satisfies AiCheckResult;
        }
        if (!input.query) throw new HttpError(422, 'validation', 'srv.ai.queryRequired', { fields: { query: msg('srv.ai.queryRequired') } });
        const item = await check(d, user, 'insured', { insured: me, text: input.query, serviceDate: today, subject: { type: 'query' } }, { lang });
        return { available: true, items: [item], suspicious: item.suspicious } satisfies AiCheckResult;
      }

      // ---- clinics: through an open visit or their own registry; no sums of limits ----
      if (scenario === 'clinic') {
        if (!user.clinicId || !can(user, 'ai.coverage.clinic', { clinicId: user.clinicId })) throw forbidden();
        if (input.subject?.type === 'visit') {
          const visit = requireVisit(d, user.clinicId, input.subject.id);
          const who = d.insured.find((i) => i.id === visit.insuredId);
          if (!who) throw notFound();
          if (!aiEnabled(d.ai.settings, 'clinic')) return OFF;
          const item = await check(d, user, 'clinic', { insured: who, text: input.query, serviceCode: input.serviceCode, icd10: input.icd10, amount: input.amount, serviceDate: today, subject: { type: 'guarantee' } }, { clinic: true });
          return { available: true, items: [item], suspicious: item.suspicious } satisfies AiCheckResult;
        }
        if (input.subject?.type === 'registry') {
          const r = registryOfClinic(d, user.clinicId, input.subject.id);
          if (!aiEnabled(d.ai.settings, 'clinic')) return OFF;
          const items: AiCheckItem[] = [];
          for (const l of r.lines) {
            const who = insuredOfVisit(d, l.visitId);
            if (!who) continue;
            items.push(await check(d, user, 'clinic', { insured: who, serviceCode: l.serviceCode, icd10: l.icd10, amount: l.amount, serviceDate: l.serviceDate, subject: { type: 'registry_line', id: l.id }, subjectId: l.id }, { clinic: true }));
          }
          return { available: true, items, suspicious: false } satisfies AiCheckResult;
        }
        throw notFound();
      }

      // ---- hints for decisions: MIG by the record, assistances by the assignment ----
      if (scenario === 'decision') {
        const mig = isStaffRole(user.role) && can(user, 'ai.coverage.mig');
        const asst = !!user.assistanceId && can(user, 'ai.coverage.assist', { assistanceId: user.assistanceId });
        if (!mig && !asst) throw forbidden();
        const s = input.subject;
        if (!s) throw notFound();
        let job: Job | null = null;
        if (s.type === 'claim' && mig) {
          const c = d.claims.find((x) => x.id === s.id);
          const who = c && d.insured.find((i) => i.id === c.insuredId);
          if (!c || !who) throw notFound();
          job = { insured: who, text: input.query ?? `${c.providerName}: ${c.category}`, amount: c.amountClaimed, serviceDate: c.serviceDate, subject: { type: 'claim', id: c.id } };
          if (!input.query) {
            const cat = { medicines: 'лекарства по назначению', doctor_visit: 'прием терапевта', diagnostics: 'узи брюшной полости', dental: 'лечение кариеса', inpatient: 'госпитализация' }[c.category];
            job.text = cat;
          }
        } else if (s.type === 'guarantee') {
          const g = d.guarantees.find((x) => x.id === s.id);
          if (!g || (!mig && g.assistanceId !== user.assistanceId)) throw notFound();
          const who = d.insured.find((i) => i.id === g.insuredId);
          if (!who) throw notFound();
          job = { insured: who, serviceCode: g.serviceCode, icd10: g.icd10, amount: g.estimatedCost, serviceDate: g.createdAt.slice(0, 10), subject: { type: 'guarantee', id: g.id } };
        } else if (s.type === 'registry_line') {
          const found = findRegistryLine(d, s.id);
          if (!found || (!mig && found.l.payer !== user.assistanceId)) throw notFound();
          const who = insuredOfVisit(d, found.l.visitId);
          if (!who) throw notFound();
          job = { insured: who, serviceCode: found.l.serviceCode, icd10: found.l.icd10, amount: found.l.amount, serviceDate: found.l.serviceDate, subject: { type: 'registry_line', id: found.l.id }, subjectId: found.l.id };
        }
        if (!job) throw notFound();
        if (!aiEnabled(d.ai.settings, 'decision')) return OFF;
        const item = await check(d, user, 'decision', job, {});
        return { available: true, items: [item], suspicious: item.suspicious } satisfies AiCheckResult;
      }
      throw notFound();
    }),
  ),
  http.post(
    `${API}/ai/feedback`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      if (!can(user, 'ai.feedback') && !(user.assistanceId && can(user, 'ai.feedback', { assistanceId: user.assistanceId }))) throw forbidden();
      const input = await body(request, aiFeedbackSchema);
      const d = db();
      const log = d.ai.logs.find((l) => l.id === input.logId);
      if (!log) throw notFound();
      log.feedback = { agree: input.agree, ...(input.comment ? { comment: input.comment } : {}), byName: user.displayName, at: tzIso(Date.now()) };
      audit(user, 'ai_feedback', { targetType: 'ai', targetId: log.id, targetLabel: `${input.agree ? 'согласен' : 'не согласен'}: ${log.output.decision}`, reason: input.comment });
      return { ok: true as const };
    }),
  ),
  http.post(
    `${API}/rebills/:id/ai-precheck`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'rebills.review');
      requirePermission(user, 'ai.coverage.mig');
      const d = db();
      const b = d.rebills.find((x) => x.id === param(ctx, 'id'));
      if (!b) throw notFound();
      if (!aiEnabled(d.ai.settings, 'rebill')) throw conflict('srv.ai.unavailable');
      let flagged = 0;
      for (const line of b.lines) {
        const found = findRegistryLine(d, line.registryLineId);
        const who = found && insuredOfVisit(d, found.l.visitId);
        if (!found || !who) continue;
        const g = found.l.guaranteeNumber ? d.guarantees.find((x) => x.number === found.l.guaranteeNumber) : undefined;
        const item = await check(d, user, 'rebill', { insured: who, serviceCode: found.l.serviceCode, icd10: found.l.icd10, amount: found.l.amount, serviceDate: found.l.serviceDate, subject: { type: 'rebill_line', id: line.id } }, {});
        const v = item.verdict.decision;
        const disputed = item.needsSpecialist || v === 'excluded' || v === 'limit_exhausted' || v === 'policy_inactive' || v === 'unknown' || (v === 'needs_guarantee' && !(g && (g.status === 'approved' || g.status === 'used')));
        if (disputed) {
          flagged += 1;
          d.ai.rebillFlags[found.l.id] = `ИИ: ${item.explanation}`.slice(0, 300);
          line.checks = [...line.checks.filter((c) => c.code !== 'ai_disagrees'), { code: 'ai_disagrees', message: d.ai.rebillFlags[found.l.id]! }];
        } else {
          delete d.ai.rebillFlags[found.l.id];
          line.checks = line.checks.filter((c) => c.code !== 'ai_disagrees');
        }
      }
      return { checked: b.lines.length, flagged };
    }),
  ),

  // ---- administration: settings by four eyes, metrics, golden cases ----
  http.get(
    `${API}/ai/admin`,
    route(({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'ai.admin');
      return adminView(db());
    }),
  ),
  http.post(
    `${API}/ai/admin/changes`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'ai.admin');
      const { to, reason } = await body(request, aiSettingsChangeSchema);
      const d = db();
      for (const x of AI_SCENARIOS) if (!AI_PROVIDERS_AVAILABLE.includes(to.scenarios[x].provider)) throw new HttpError(422, 'validation', 'srv.ai.providerLater', { fields: { provider: msg('srv.ai.mockOnly') } });
      const from = d.ai.settings;
      const at = tzIso(Date.now());
      // The kill switch turns AI off at once (the safe direction); everything else waits for a second admin.
      const onlyKill = !from.killSwitch && to.killSwitch && JSON.stringify({ ...to, killSwitch: false }) === JSON.stringify({ ...from, killSwitch: false });
      if (onlyKill) {
        d.ai.settings = { ...from, killSwitch: true };
        const c = { id: randomId(), to, from, reason, status: 'applied' as const, proposedById: user.id, proposedByName: user.displayName, proposedAt: at, decidedByName: user.displayName, decidedAt: at };
        d.ai.changes.unshift(c);
        audit(user, 'ai_kill_switch', { targetType: 'ai', targetId: c.id, targetLabel: 'ИИ отключён везде', reason });
        return HttpResponse.json(c, { status: 201 });
      }
      if (JSON.stringify(to) === JSON.stringify(from)) throw conflict('srv.ai.unchanged');
      if (d.ai.changes.some((c) => c.status === 'pending')) throw conflict('srv.ai.alreadyPending');
      const c = { id: randomId(), to, from, reason, status: 'pending' as const, proposedById: user.id, proposedByName: user.displayName, proposedAt: at };
      d.ai.changes.unshift(c);
      audit(user, 'ai_settings_proposed', { targetType: 'ai', targetId: c.id, targetLabel: `${describe(from)} → ${describe(to)}`, reason });
      return HttpResponse.json(c, { status: 201 });
    }),
  ),
  http.post(
    `${API}/ai/admin/changes/:id/:decision`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      const d = db();
      const c = d.ai.changes.find((x) => x.id === param(ctx, 'id'));
      if (!c) throw notFound();
      if (!can(user, 'ai.admin', { createdById: c.proposedById })) throw new HttpError(403, 'forbidden', 'srv.ai.fourEyes');
      if (c.status !== 'pending') throw conflict('srv.change.alreadyReviewed');
      const decision = String(ctx.params.decision ?? '');
      const at = tzIso(Date.now());
      if (decision === 'approve') {
        if (JSON.stringify(d.ai.settings) !== JSON.stringify(c.from)) throw conflict('srv.ai.stale');
        d.ai.settings = c.to;
        Object.assign(c, { status: 'applied', decidedByName: user.displayName, decidedAt: at });
        audit(user, 'ai_settings_changed', { targetType: 'ai', targetId: c.id, targetLabel: `${describe(c.from)} → ${describe(c.to)}`, reason: `Предложил ${c.proposedByName}: ${c.reason}` });
        return c;
      }
      if (decision !== 'reject') throw notFound();
      const { reason } = await body(ctx.request, aiRejectSchema);
      Object.assign(c, { status: 'rejected', decidedByName: user.displayName, decidedAt: at, rejectReason: reason });
      audit(user, 'ai_settings_rejected', { targetType: 'ai', targetId: c.id, targetLabel: describe(c.to), reason });
      return c;
    }),
  ),
  http.post(
    `${API}/ai/admin/eval`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'ai.admin');
      return runGolden(createMockProvider(), db().ai.settings.confidenceThreshold, isoDay(Date.now()));
    }),
  ),
];
