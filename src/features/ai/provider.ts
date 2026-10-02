/*
 * AI gateway contract (AI_COVERAGE_SPEC §3.3). The provider maps free text to catalog codes and explains
 * a verdict; it never decides. In the prototype only `mock` exists and runs on the mock server: keys of
 * external models must never reach the browser. The backend plugs `local` or `external` behind the same
 * `POST /api/ai/coverage-check`.
 */
import type { AiProviderId, AiScenario, CoverageVerdict } from '@/shared/types';

export interface NormalizeInput {
  scenario: AiScenario;
  promptVersion: string;
  /** The whole prompt: instructions plus the user's text inside data delimiters (see prompts.ts). */
  prompt: string;
  /** The user's text alone, already redacted; providers that do not use prompts read it. */
  text: string;
}

export interface NormalizeOutput {
  codes: { code: string; confidence: number }[];
  icd10: string[];
}

export interface ExplainInput {
  scenario: AiScenario;
  promptVersion: string;
  lang: 'ru' | 'uz';
  verdict: CoverageVerdict;
  services: { code: string; name: string }[];
  clauses: { ref: string; label: string }[];
  needsSpecialist: boolean;
}

export interface ExplainOutput {
  text: string;
}

export interface AiProvider {
  id: AiProviderId;
  model: string;
  normalize(input: NormalizeInput): Promise<NormalizeOutput>;
  explain(input: ExplainInput): Promise<ExplainOutput>;
}
