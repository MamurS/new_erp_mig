/* Plain-language verdicts of the coverage check (AI_COVERAGE_SPEC §4.1). */
import type { CoverageVerdictDecision } from '@/shared/types';

export const VERDICT_LABEL: Record<CoverageVerdictDecision, string> = {
  covered: 'Скорее всего покрывается',
  needs_guarantee: 'Нужно гарантийное письмо, его запросит клиника',
  excluded: 'Не покрывается программой',
  limit_exhausted: 'Лимит исчерпан',
  policy_inactive: 'Полис не действует на эту дату',
  unknown: 'Нужна проверка специалиста',
};

/** Short verdicts for staff screens. */
export const VERDICT_SHORT: Record<CoverageVerdictDecision, string> = {
  covered: 'Покрывается',
  needs_guarantee: 'Нужно ГП',
  excluded: 'Не покрывается',
  limit_exhausted: 'Лимит исчерпан',
  policy_inactive: 'Полис не действует',
  unknown: 'Нужна проверка специалиста',
};

export const VERDICT_CHIP: Record<CoverageVerdictDecision, string> = {
  covered: 'success',
  needs_guarantee: 'warning',
  excluded: 'danger',
  limit_exhausted: 'danger',
  policy_inactive: 'danger',
  unknown: 'neutral',
};

export const LIMIT_STATUS_LABEL = { available: 'Лимит доступен', low: 'Лимит на исходе', exhausted: 'Лимит исчерпан' } as const;

export const PRELIMINARY = 'Это предварительная оценка. Окончательное решение принимается при рассмотрении.';
