/* Response schemas of the AI coverage check (AI_COVERAGE_SPEC). */
import { z } from 'zod';
import type * as D from './dto';
import type * as T from './index';

const decision = z.enum(['covered', 'needs_guarantee', 'excluded', 'limit_exhausted', 'policy_inactive', 'unknown']);
const scenario = z.enum(['insured', 'clinic', 'decision', 'rebill', 'help']);
const provider = z.enum(['mock', 'local', 'external']);
const limitCategory = z.enum(['outpatient', 'dental', 'medicines', 'inpatient']);

const verdict = z.object({
  decision,
  clauseIds: z.array(z.string()),
  limit: z.object({ category: limitCategory, remaining: z.number(), afterThis: z.number().optional() }).nullable(),
  notes: z.array(z.string()),
});

const item = z.object({
  logId: z.string().uuid(),
  input: z.string(),
  amount: z.number().optional(),
  subjectId: z.string().optional(),
  matches: z.array(z.object({ code: z.string(), name: z.string(), confidence: z.number() })),
  confidence: z.number(),
  needsSpecialist: z.boolean(),
  verdict,
  limitStatus: z.enum(['available', 'low', 'exhausted']).nullable().optional(),
  clauses: z.array(z.object({ ref: z.string(), label: z.string() })),
  explanation: z.string(),
  receiptLabel: z.enum(['refund', 'no_refund', 'check']).optional(),
  suspicious: z.boolean(),
});

export const aiCheckResult: z.ZodType<D.AiCheckResult> = z.object({ available: z.boolean(), items: z.array(item), suspicious: z.boolean(), expectedReimbursement: z.number().optional() });

const scenarios = z.object({ insured: z.boolean(), clinic: z.boolean(), decision: z.boolean(), rebill: z.boolean(), help: z.boolean() });
export const aiStatus: z.ZodType<D.AiStatus> = z.object({ killSwitch: z.boolean(), scenarios });

const scenarioSettings = z.object({ enabled: z.boolean(), provider });
const settings: z.ZodType<T.AiSettings> = z.object({
  scenarios: z.object({ insured: scenarioSettings, clinic: scenarioSettings, decision: scenarioSettings, rebill: scenarioSettings, help: scenarioSettings }),
  confidenceThreshold: z.number(),
  killSwitch: z.boolean(),
});
const change: z.ZodType<T.AiSettingsChange> = z.object({
  id: z.string().uuid(),
  to: settings,
  from: settings,
  reason: z.string(),
  status: z.enum(['pending', 'applied', 'rejected']),
  proposedById: z.string().uuid(),
  proposedByName: z.string(),
  proposedAt: z.string(),
  decidedByName: z.string().optional(),
  decidedAt: z.string().optional(),
  rejectReason: z.string().optional(),
});
export const aiChange = change;

export const aiAdminView: z.ZodType<D.AiAdminView> = z.object({
  settings,
  changes: z.array(change),
  metrics: z.array(z.object({ scenario, calls: z.number(), rated: z.number(), agreeShare: z.number().nullable(), specialistShare: z.number().nullable(), avgLatencyMs: z.number().nullable() })),
  disagreements: z.array(z.object({ id: z.string(), at: z.string(), scenario, input: z.string(), decision, comment: z.string(), byName: z.string() })),
  promptVersion: z.string(),
  providersAvailable: z.array(provider),
});

export const aiGoldenResult: z.ZodType<D.AiGoldenResult> = z.object({
  total: z.number(),
  correct: z.number(),
  accuracy: z.number(),
  errors: z.array(z.object({ text: z.string(), expectedCodes: z.array(z.string()), gotCodes: z.array(z.string()), expectedDecision: decision, gotDecision: decision })),
});
