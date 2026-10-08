/*
 * AI coverage check gateway (AI_COVERAGE_SPEC §3.3, §4, §5). The contract is the one the backend will
 * serve: POST /api/ai/coverage-check. Scope is always resolved on the server: the insured person only
 * through the session, clinics through an open visit or their own registry, assistances through the
 * assignment of the policy, MIG through the claim, letter or line. Settings change by four eyes.
 * The provider is passed in by the adapter (the mock with its latency in the browser, a real one on the server).
 */
import { msg } from '@mig/i18n';
import type { AiCallLog, AiScenario, AiSettings, AiSettingsChange } from '@mig/contracts';
import type { AiAdminView, AiCheckItem, AiCheckResult, AiStatus } from '@mig/contracts/dto';
import { aiCheckRequestSchema, aiFeedbackSchema, aiRejectSchema, aiSettingsChangeSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { isStaffRole } from '../labels';
import { catalogItem } from '../coverage/catalog';
import { COVERAGE_RULES } from '../coverage/rules';
import { limitStatus, type CoverageContext } from '../coverage/engine';
import { runCoverageCheck } from '../ai/pipeline';
import { PROMPT_VERSION } from '../ai/prompts';
import type { AiProvider } from '../ai/provider';
import { runGolden, type GoldenResult } from '../ai/eval/run';
import { AI_PROVIDERS_AVAILABLE, AI_SCENARIOS, aiEnabled } from '../ai/settings';
import { createMockProvider } from '../lib/aiProvider';
import { randomId } from '../lib/random';
import { isoDay, tzIso } from '../lib/time';
import type { InsuredRow } from '../store/db';
import { audit, conflict, DomainError, forbidden, notFound, requirePermission, validate, type AuthCtx, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { personFor } from './family';
import { findRegistryLine, insuredOfVisit } from './assistance';
import { registryOfClinic, requireVisit } from './clinic';
import { sha256Hex } from './settlement';
import { limitsFor } from './views';

/** Calls kept in the log (the oldest are dropped). */
const MAX_LOGS = 2000;

async function contextOf(ctx: BaseCtx, i: InsuredRow, P: ParamsView): Promise<CoverageContext> {
  const p = await ctx.repos.policies.get(i.policyId);
  if (!p) throw notFound();
  return {
    program: p.program,
    policy: { id: p.id, status: p.status, startDate: p.startDate, endDate: p.endDate },
    insured: { id: i.id, insuredFrom: i.insuredFrom, excludedFrom: i.excludedFrom, status: i.status },
    limits: await limitsFor(ctx, i, P),
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

/** What one check needs besides the job: the person asking, the settings and the provider of the request. */
interface Run {
  ctx: AuthCtx;
  P: ParamsView;
  settings: AiSettings;
  provider: AiProvider;
}

async function addLog(ctx: BaseCtx, log: AiCallLog): Promise<void> {
  await ctx.repos.aiLogs.insert(log, { at: 'start' });
  if ((await ctx.repos.aiLogs.count()) <= MAX_LOGS) return;
  for (const old of await ctx.repos.aiLogs.list({ offset: MAX_LOGS })) await ctx.repos.aiLogs.remove(old.id);
}

async function check(run: Run, scenario: AiScenario, job: Job, opts: { clinic?: boolean; lang?: 'ru' | 'uz'; receipt?: boolean }): Promise<AiCheckItem> {
  const { ctx, settings, provider } = run;
  const { user } = ctx;
  const cov = await contextOf(ctx, job.insured, run.P);
  const started = ctx.now();
  const out = await runCoverageCheck(
    { scenario, text: job.text, serviceCode: job.serviceCode, icd10: job.icd10, amount: job.amount, serviceDate: job.serviceDate, lang: opts.lang },
    cov,
    // Redaction before any provider except a local one; the mock is treated like an external one.
    { provider, threshold: settings.confidenceThreshold, knownNames: [job.insured.fullName], redact: settings.scenarios[scenario].provider !== 'local' },
  );
  const logId = randomId();
  const input = job.text ?? job.serviceCode ?? '';
  await addLog(ctx, {
    id: logId,
    at: tzIso(ctx.now()),
    scenario,
    promptVersion: out.promptVersion,
    provider: settings.scenarios[scenario].provider,
    model: provider.model,
    inputHash: await sha256Hex(new TextEncoder().encode(input)),
    inputRedacted: out.redacted || input,
    output: { codes: out.matches.map((m) => m.code), decision: out.needsSpecialist ? 'unknown' : out.verdict.decision, needsSpecialist: out.needsSpecialist },
    confidence: out.confidence,
    latencyMs: ctx.now() - started,
    userId: user.id,
    userRole: user.role,
    ...(job.subject ? { subject: job.subject } : {}),
    suspicious: out.suspicious,
  });
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
  if (opts.clinic) item.limitStatus = limitStatus(out.verdict.limit, cov.limits, run.P.dmsParam('limitLowShare'));
  if (opts.receipt) item.receiptLabel = out.needsSpecialist ? 'check' : out.verdict.decision === 'covered' ? 'refund' : out.verdict.decision === 'needs_guarantee' || out.verdict.decision === 'unknown' ? 'check' : 'no_refund';
  return item;
}

const OFF: AiCheckResult = { available: false, items: [], suspicious: false };

async function metrics(ctx: BaseCtx): Promise<AiAdminView['metrics']> {
  const allLogs = await ctx.repos.aiLogs.list();
  const qs = await ctx.repos.helpQuestions.list();
  return AI_SCENARIOS.map((scenario) => {
    if (scenario === 'help') {
      // «Задать вопрос»: rated = with «Полезно / Не полезно», agreement = «Полезно», «specialist» = no answer.
      const rated = qs.filter((q) => q.feedback);
      return {
        scenario,
        calls: qs.length,
        rated: rated.length,
        agreeShare: rated.length ? rated.filter((q) => q.feedback!.helpful).length / rated.length : null,
        specialistShare: qs.length ? qs.filter((q) => q.status === 'no_answer').length / qs.length : null,
        avgLatencyMs: null,
      };
    }
    const logs = allLogs.filter((l) => l.scenario === scenario);
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

async function adminView(ctx: BaseCtx): Promise<AiAdminView> {
  return {
    settings: await ctx.repos.one.aiSettings(),
    changes: await ctx.repos.aiChanges.list({ limit: 20 }),
    metrics: await metrics(ctx),
    disagreements: (await ctx.repos.aiLogs.list())
      .filter((l) => l.feedback && !l.feedback.agree)
      .slice(0, 10)
      .map((l) => ({ id: l.id, at: l.feedback!.at, scenario: l.scenario, input: l.inputRedacted, decision: l.output.decision, comment: l.feedback!.comment ?? '', byName: l.feedback!.byName })),
    promptVersion: PROMPT_VERSION,
    providersAvailable: [...AI_PROVIDERS_AVAILABLE],
  };
}

const describe = (s: AiSettings) => `${AI_SCENARIOS.filter((x) => s.scenarios[x].enabled).length}/${AI_SCENARIOS.length} сценариев, порог ${Math.round(s.confidenceThreshold * 100)}%${s.killSwitch ? ', ИИ отключён везде' : ''}`;

// ---------------------------------------------------------------- endpoints

export async function status(ctx: AuthCtx): Promise<AiStatus> {
  const s = await ctx.repos.one.aiSettings();
  return { killSwitch: s.killSwitch, scenarios: Object.fromEntries(AI_SCENARIOS.map((x) => [x, aiEnabled(s, x)])) as AiStatus['scenarios'] };
}

/** `personId`: `?personId=` of the insured scenario (a family member whose medical data the person may see). */
export async function coverageCheck(ctx: AuthCtx, provider: AiProvider, personId: string | null, body: unknown): Promise<AiCheckResult> {
  const { user } = ctx;
  const input = validate(aiCheckRequestSchema, body);
  const r = ctx.repos;
  const settings = await r.one.aiSettings();
  const run: Run = { ctx, P: await loadParams(ctx), settings, provider };
  const today = isoDay(ctx.now());
  const scenario = input.scenario;

  // ---- the insured person: only their own policy, never by id ----
  if (scenario === 'insured') {
    if (user.role !== 'insured' || !user.insuredId || !can(user, 'ai.coverage.self', { insuredId: user.insuredId })) throw forbidden();
    const viewer = await r.insured.get(user.insuredId);
    if (!viewer) throw notFound();
    // `?personId=`: a person of the family whose medical data the signed-in person may see (FAMILY_SPEC).
    const me = (await personFor(ctx, viewer, personId, 'medical')).person;
    if (!aiEnabled(settings, 'insured')) return OFF;
    const lang = input.lang ?? 'ru';
    if (input.items?.length) {
      const items: AiCheckItem[] = [];
      for (const [k, it] of input.items.entries()) items.push(await check(run, 'insured', { insured: me, text: it.text, amount: it.amount, serviceDate: today, subject: { type: 'receipt_item' }, subjectId: String(k) }, { lang, receipt: true }));
      const limit = items.find((x) => x.verdict.limit)?.verdict.limit;
      const refundable = items.filter((x) => x.receiptLabel === 'refund').reduce((s, x) => s + (x.amount ?? 0), 0);
      return { available: true, items, suspicious: items.some((x) => x.suspicious), expectedReimbursement: limit ? Math.min(refundable, limit.remaining) : refundable };
    }
    if (!input.query) throw new DomainError(422, 'validation', 'srv.ai.queryRequired', { fields: { query: msg('srv.ai.queryRequired') } });
    const item = await check(run, 'insured', { insured: me, text: input.query, serviceDate: today, subject: { type: 'query' } }, { lang });
    return { available: true, items: [item], suspicious: item.suspicious };
  }

  // ---- clinics: through an open visit or their own registry; no sums of limits ----
  if (scenario === 'clinic') {
    if (!user.clinicId || !can(user, 'ai.coverage.clinic', { clinicId: user.clinicId })) throw forbidden();
    if (input.subject?.type === 'visit') {
      const visit = await requireVisit(ctx, user.clinicId, input.subject.id);
      const who = await r.insured.get(visit.insuredId);
      if (!who) throw notFound();
      if (!aiEnabled(settings, 'clinic')) return OFF;
      const item = await check(run, 'clinic', { insured: who, text: input.query, serviceCode: input.serviceCode, icd10: input.icd10, amount: input.amount, serviceDate: today, subject: { type: 'guarantee' } }, { clinic: true });
      return { available: true, items: [item], suspicious: item.suspicious };
    }
    if (input.subject?.type === 'registry') {
      const reg = await registryOfClinic(ctx, user.clinicId, input.subject.id);
      if (!aiEnabled(settings, 'clinic')) return OFF;
      const items: AiCheckItem[] = [];
      for (const l of reg.lines) {
        const who = await insuredOfVisit(ctx, l.visitId);
        if (!who) continue;
        items.push(await check(run, 'clinic', { insured: who, serviceCode: l.serviceCode, icd10: l.icd10, amount: l.amount, serviceDate: l.serviceDate, subject: { type: 'registry_line', id: l.id }, subjectId: l.id }, { clinic: true }));
      }
      return { available: true, items, suspicious: false };
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
      const c = await r.claims.get(s.id);
      const who = c && (await r.insured.get(c.insuredId));
      if (!c || !who) throw notFound();
      job = { insured: who, text: input.query ?? `${c.providerName}: ${c.category}`, amount: c.amountClaimed, serviceDate: c.serviceDate, subject: { type: 'claim', id: c.id } };
      if (!input.query) {
        const cat = { medicines: 'лекарства по назначению', doctor_visit: 'прием терапевта', diagnostics: 'узи брюшной полости', dental: 'лечение кариеса', inpatient: 'госпитализация' }[c.category];
        job.text = cat;
      }
    } else if (s.type === 'guarantee') {
      const g = await r.guarantees.get(s.id);
      if (!g || (!mig && g.assistanceId !== user.assistanceId)) throw notFound();
      const who = await r.insured.get(g.insuredId);
      if (!who) throw notFound();
      job = { insured: who, serviceCode: g.serviceCode, icd10: g.icd10, amount: g.estimatedCost, serviceDate: g.createdAt.slice(0, 10), subject: { type: 'guarantee', id: g.id } };
    } else if (s.type === 'registry_line') {
      const found = await findRegistryLine(ctx, s.id);
      if (!found || (!mig && found.l.payer !== user.assistanceId)) throw notFound();
      const who = await insuredOfVisit(ctx, found.l.visitId);
      if (!who) throw notFound();
      job = { insured: who, serviceCode: found.l.serviceCode, icd10: found.l.icd10, amount: found.l.amount, serviceDate: found.l.serviceDate, subject: { type: 'registry_line', id: found.l.id }, subjectId: found.l.id };
    }
    if (!job) throw notFound();
    if (!aiEnabled(settings, 'decision')) return OFF;
    const item = await check(run, 'decision', job, {});
    return { available: true, items: [item], suspicious: item.suspicious };
  }
  throw notFound();
}

export async function feedback(ctx: AuthCtx, body: unknown): Promise<{ ok: true }> {
  const { user } = ctx;
  if (!can(user, 'ai.feedback') && !(user.assistanceId && can(user, 'ai.feedback', { assistanceId: user.assistanceId }))) throw forbidden();
  const input = validate(aiFeedbackSchema, body);
  const log = await ctx.repos.aiLogs.get(input.logId);
  if (!log) throw notFound();
  await ctx.repos.aiLogs.update(log.id, { feedback: { agree: input.agree, ...(input.comment ? { comment: input.comment } : {}), byName: user.displayName, at: tzIso(ctx.now()) } });
  await audit(ctx, user, 'ai_feedback', { targetType: 'ai', targetId: log.id, targetLabel: `${input.agree ? 'согласен' : 'не согласен'}: ${log.output.decision}`, reason: input.comment });
  return { ok: true as const };
}

/** «Предпроверка ИИ» of an assistance bill: disputed lines get the `ai_disagrees` check. */
export async function rebillPrecheck(ctx: AuthCtx, provider: AiProvider, id: string): Promise<{ checked: number; flagged: number }> {
  const { user } = ctx;
  requirePermission(user, 'rebills.review');
  requirePermission(user, 'ai.coverage.mig');
  const r = ctx.repos;
  const b = await r.rebills.get(id);
  if (!b) throw notFound();
  const settings = await r.one.aiSettings();
  if (!aiEnabled(settings, 'rebill')) throw conflict('srv.ai.unavailable');
  const run: Run = { ctx, P: await loadParams(ctx), settings, provider };
  let flagged = 0;
  for (const line of b.lines) {
    const found = await findRegistryLine(ctx, line.registryLineId);
    const who = found && (await insuredOfVisit(ctx, found.l.visitId));
    if (!found || !who) continue;
    const g = found.l.guaranteeNumber ? await r.guarantees.first({ where: { number: found.l.guaranteeNumber } }) : null;
    const item = await check(run, 'rebill', { insured: who, serviceCode: found.l.serviceCode, icd10: found.l.icd10, amount: found.l.amount, serviceDate: found.l.serviceDate, subject: { type: 'rebill_line', id: line.id } }, {});
    const v = item.verdict.decision;
    const disputed = item.needsSpecialist || v === 'excluded' || v === 'limit_exhausted' || v === 'policy_inactive' || v === 'unknown' || (v === 'needs_guarantee' && !(g && (g.status === 'approved' || g.status === 'used')));
    if (disputed) {
      flagged += 1;
      const reason = `ИИ: ${item.explanation}`.slice(0, 300);
      await r.aiRebillFlags.set(found.l.id, reason);
      line.checks = [...line.checks.filter((c) => c.code !== 'ai_disagrees'), { code: 'ai_disagrees', message: reason }];
    } else {
      await r.aiRebillFlags.delete(found.l.id);
      line.checks = line.checks.filter((c) => c.code !== 'ai_disagrees');
    }
    await r.rebills.update(b.id, { lines: b.lines });
  }
  return { checked: b.lines.length, flagged };
}

// ---- administration: settings by four eyes, metrics, golden cases ----

export async function admin(ctx: AuthCtx): Promise<AiAdminView> {
  requirePermission(ctx.user, 'ai.admin');
  return adminView(ctx);
}

/** A proposed change (the adapter answers 201); turning AI off everywhere applies at once. */
export async function proposeChange(ctx: AuthCtx, body: unknown): Promise<AiSettingsChange> {
  const { user } = ctx;
  requirePermission(user, 'ai.admin');
  const { to, reason } = validate(aiSettingsChangeSchema, body);
  for (const x of AI_SCENARIOS) if (!AI_PROVIDERS_AVAILABLE.includes(to.scenarios[x].provider)) throw new DomainError(422, 'validation', 'srv.ai.providerLater', { fields: { provider: msg('srv.ai.mockOnly') } });
  const from = await ctx.repos.one.aiSettings();
  const at = tzIso(ctx.now());
  // The kill switch turns AI off at once (the safe direction); everything else waits for a second admin.
  const onlyKill = !from.killSwitch && to.killSwitch && JSON.stringify({ ...to, killSwitch: false }) === JSON.stringify({ ...from, killSwitch: false });
  if (onlyKill) {
    await ctx.repos.one.setAiSettings({ ...from, killSwitch: true });
    const c: AiSettingsChange = { id: randomId(), to, from, reason, status: 'applied', proposedById: user.id, proposedByName: user.displayName, proposedAt: at, decidedByName: user.displayName, decidedAt: at };
    await ctx.repos.aiChanges.insert(c, { at: 'start' });
    await audit(ctx, user, 'ai_kill_switch', { targetType: 'ai', targetId: c.id, targetLabel: 'ИИ отключён везде', reason });
    return c;
  }
  if (JSON.stringify(to) === JSON.stringify(from)) throw conflict('srv.ai.unchanged');
  if (await ctx.repos.aiChanges.exists({ status: 'pending' })) throw conflict('srv.ai.alreadyPending');
  const c: AiSettingsChange = { id: randomId(), to, from, reason, status: 'pending', proposedById: user.id, proposedByName: user.displayName, proposedAt: at };
  await ctx.repos.aiChanges.insert(c, { at: 'start' });
  await audit(ctx, user, 'ai_settings_proposed', { targetType: 'ai', targetId: c.id, targetLabel: `${describe(from)} → ${describe(to)}`, reason });
  return c;
}

/** `decision`: `approve` or `reject` (another admin than the author). */
export async function decideChange(ctx: AuthCtx, id: string, decision: string, body: unknown): Promise<AiSettingsChange> {
  const { user } = ctx;
  const c = await ctx.repos.aiChanges.get(id);
  if (!c) throw notFound();
  if (!can(user, 'ai.admin', { createdById: c.proposedById })) throw new DomainError(403, 'forbidden', 'srv.ai.fourEyes');
  if (c.status !== 'pending') throw conflict('srv.change.alreadyReviewed');
  const at = tzIso(ctx.now());
  if (decision === 'approve') {
    if (JSON.stringify(await ctx.repos.one.aiSettings()) !== JSON.stringify(c.from)) throw conflict('srv.ai.stale');
    await ctx.repos.one.setAiSettings(c.to);
    const out = await ctx.repos.aiChanges.update(c.id, { status: 'applied', decidedByName: user.displayName, decidedAt: at });
    await audit(ctx, user, 'ai_settings_changed', { targetType: 'ai', targetId: c.id, targetLabel: `${describe(c.from)} → ${describe(c.to)}`, reason: `Предложил ${c.proposedByName}: ${c.reason}` });
    return out;
  }
  if (decision !== 'reject') throw notFound();
  const { reason } = validate(aiRejectSchema, body);
  const out = await ctx.repos.aiChanges.update(c.id, { status: 'rejected', decidedByName: user.displayName, decidedAt: at, rejectReason: reason });
  await audit(ctx, user, 'ai_settings_rejected', { targetType: 'ai', targetId: c.id, targetLabel: describe(c.to), reason });
  return out;
}

/** Golden cases with the mock provider (no latency) and the threshold in force. */
export async function runEval(ctx: AuthCtx): Promise<GoldenResult> {
  requirePermission(ctx.user, 'ai.admin');
  return runGolden(createMockProvider(), (await ctx.repos.one.aiSettings()).confidenceThreshold, isoDay(ctx.now()));
}
