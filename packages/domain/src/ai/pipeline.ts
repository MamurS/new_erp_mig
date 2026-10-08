/*
 * One coverage check (AI_COVERAGE_SPEC §3): redact → prompt with data delimiters → provider.normalize →
 * schema check (unknown codes dropped) → confidence threshold → rules engine → provider.explain.
 * The same pipeline serves the mock server, the golden cases and (later) the backend.
 */
import type { AiScenario, CoverageVerdict, Money } from '@mig/contracts';
import { catalogItem } from '../coverage/catalog';
import { evaluateCoverage, type CoverageContext } from '../coverage/engine';
import { clauseLabel } from '../documents/templates/index';
import { detectInjection } from './injection';
import { normalizePrompt, PROMPT_VERSION } from './prompts';
import type { AiProvider } from './provider';
import { redactForAi } from './redact';
import { checkExplainOutput, checkNormalizeOutput } from './schemas';
import { t } from '@mig/i18n';

export interface CheckInput {
  scenario: AiScenario;
  /** Free text, or a known catalog code (registry lines and guarantee letters carry codes). */
  text?: string;
  serviceCode?: string;
  icd10?: string;
  amount?: Money;
  serviceDate: string;
  lang?: 'ru' | 'uz';
}

export interface CheckOutput {
  matches: { code: string; name: string; confidence: number }[];
  confidence: number;
  needsSpecialist: boolean;
  verdict: CoverageVerdict;
  clauses: { ref: string; label: string }[];
  explanation: string;
  suspicious: boolean;
  redacted: string;
  promptVersion: string;
}

const SPECIALIST: CoverageVerdict = { decision: 'unknown', clauseIds: [], limit: null, notes: [] };

export async function runCoverageCheck(
  input: CheckInput,
  ctx: CoverageContext,
  opts: { provider: AiProvider; threshold: number; knownNames?: readonly string[]; redact: boolean },
): Promise<CheckOutput> {
  const text = input.text ?? '';
  const suspicious = detectInjection(text);
  const redacted = opts.redact ? redactForAi(text, { names: opts.knownNames }).text : text;
  let codes: { code: string; confidence: number }[] = [];
  let icd10 = input.icd10 ? [input.icd10] : [];
  if (input.serviceCode && catalogItem(input.serviceCode)) {
    codes = [{ code: input.serviceCode, confidence: 1 }];
  } else if (redacted.trim()) {
    try {
      const raw = await opts.provider.normalize({ scenario: input.scenario, promptVersion: PROMPT_VERSION, prompt: normalizePrompt(redacted), text: redacted });
      const checked = checkNormalizeOutput(raw, (c) => !!catalogItem(c));
      if (checked) {
        codes = checked.codes;
        icd10 = [...new Set([...icd10, ...checked.icd10])];
      }
    } catch {
      codes = [];
    }
  }
  const top = codes[0];
  const confidence = top?.confidence ?? 0;
  // Several codes only when the text names several services; alternatives of one service are not added.
  const chosen = codes.filter((c) => c.confidence >= opts.threshold);
  const needsSpecialist = !top || confidence < opts.threshold;
  const verdict = needsSpecialist
    ? SPECIALIST
    : evaluateCoverage({ policyId: ctx.policy.id, insuredId: ctx.insured.id, serviceCodes: chosen.map((c) => c.code), icd10, serviceDate: input.serviceDate, amount: input.amount }, ctx);
  const clauses = verdict.clauseIds.map((ref) => ({ ref, label: clauseLabel(ref) }));
  const matches = codes.slice(0, 3).map((c) => ({ ...c, name: catalogItem(c.code)!.name }));
  let explanation = '';
  try {
    explanation =
      checkExplainOutput(
        await opts.provider.explain({
          scenario: input.scenario,
          promptVersion: PROMPT_VERSION,
          lang: input.lang ?? 'ru',
          verdict,
          services: chosen.map((c) => ({ code: c.code, name: catalogItem(c.code)!.name })),
          clauses,
          needsSpecialist,
        }),
      ) ?? '';
  } catch {
    explanation = '';
  }
  return { matches, confidence, needsSpecialist, verdict, clauses, explanation: explanation || t('ai.verdict.unknown'), suspicious, redacted, promptVersion: PROMPT_VERSION };
}
