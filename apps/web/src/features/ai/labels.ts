/* Plain-language verdicts of the coverage check (AI_COVERAGE_SPEC §4.1). */
import type { CoverageVerdictDecision } from '@mig/contracts';
import { defineLabels, t } from '@/i18n';

const DECISIONS: readonly CoverageVerdictDecision[] = ['covered', 'needs_guarantee', 'excluded', 'limit_exhausted', 'policy_inactive', 'unknown'];

export const VERDICT_LABEL: Readonly<Record<CoverageVerdictDecision, string>> = defineLabels('ai.verdict', DECISIONS);

/** Short verdicts for staff screens. */
export const VERDICT_SHORT: Readonly<Record<CoverageVerdictDecision, string>> = defineLabels('ai.verdictShort', DECISIONS);

export const VERDICT_CHIP: Record<CoverageVerdictDecision, string> = {
  covered: 'success',
  needs_guarantee: 'warning',
  excluded: 'danger',
  limit_exhausted: 'danger',
  policy_inactive: 'danger',
  unknown: 'neutral',
};

export const LIMIT_STATUS_LABEL = defineLabels('ai.limit', ['available', 'low', 'exhausted'] as const);

/** Read in the current language. */
export function preliminaryNote(): string {
  return t('ai.preliminary');
}
