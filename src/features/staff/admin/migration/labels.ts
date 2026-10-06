/* Labels of the portfolio transfer screens, read in the current language. */
import { defineLabels } from '@/i18n';
import { MIGRATION_STEPS } from '@/shared/domain/migration';
import type { MigrationBatchStatus } from '@/shared/types/migration';

export const STEP_LABEL = defineLabels('migration.step', MIGRATION_STEPS);
export const STEP_HINT = defineLabels('migration.stepHint', MIGRATION_STEPS);
export const STEP_STATUS_LABEL = defineLabels('migration.stepStatus', ['empty', 'validated', 'confirmed', 'skipped'] as const);
export const BATCH_STATUS_LABEL = defineLabels('migration.status', ['draft', 'pending_approval', 'applied', 'rejected', 'rolled_back', 'discarded'] as const);
export const KIND_LABEL = defineLabels('migration.kind', ['csv', 'manual'] as const);
export const LEVEL_LABEL = defineLabels('migration.level', ['error', 'warning'] as const);
export const METRIC_LABEL = defineLabels('migration.metric', ['clients', 'contracts', 'premium', 'insured', 'limitsUsed', 'claims', 'reserves', 'invoices', 'invoicesOutstanding'] as const);
export const BLOCKER_LABEL = defineLabels('migration.blocker', [
  'audit',
  'claim',
  'payment',
  'endorsement',
  'change_request',
  'policy_change',
  'appointment',
  'guarantee',
  'visit',
  'invoice',
  'contract',
  'insured',
  'consent',
  'chat',
  'file',
  'limit_request',
  'case',
  'kp',
  'deal',
] as const);
export const FREQUENCY_LABEL = defineLabels('migration.frequency', ['single', 'quarterly', 'monthly'] as const);

export const BATCH_STATUS_CHIP: Record<MigrationBatchStatus, string> = {
  draft: 'neutral',
  pending_approval: 'warning',
  applied: 'success',
  rejected: 'danger',
  rolled_back: 'neutral',
  discarded: 'neutral',
};
export const STEP_STATUS_CHIP: Record<string, string> = { empty: 'neutral', validated: 'warning', confirmed: 'success', skipped: 'neutral' };
