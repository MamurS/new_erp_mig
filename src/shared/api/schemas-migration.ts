/* Response schemas of the portfolio transfer (/staff/admin/migration). */
import { z } from 'zod';
import type * as M from '@/shared/types/migration';

const uuid = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().min(10);
const step = z.enum(['clients', 'contracts', 'insured', 'limits', 'claims', 'invoices']);
const totals = z.object({ rows: z.number(), amount: z.number() });

export const migrationBatchSummary: z.ZodType<M.MigrationBatchSummary> = z.object({
  id: uuid,
  seq: z.number(),
  kind: z.enum(['csv', 'manual']),
  status: z.enum(['draft', 'pending_approval', 'applied', 'rejected', 'rolled_back', 'discarded']),
  migrationDate: isoDate,
  createdAt: isoDateTime,
  createdById: uuid,
  createdByName: z.string(),
  rows: z.number(),
  submittedAt: isoDateTime.optional(),
  decidedAt: isoDateTime.optional(),
  decidedByName: z.string().optional(),
});

export const migrationBatchList = z.object({ items: z.array(migrationBatchSummary), assistances: z.array(z.string()) });

const stepView: z.ZodType<M.MigrationStepView> = z.object({
  step,
  status: z.enum(['empty', 'validated', 'confirmed', 'skipped']),
  total: z.number(),
  valid: z.number(),
  errorRows: z.number(),
  warningRows: z.number(),
  excludeErrors: z.boolean(),
  issues: z.array(z.object({ row: z.number(), field: z.string(), level: z.enum(['error', 'warning']), message: z.string() })),
  fileTotals: totals,
  validTotals: totals,
  uploadedAt: isoDateTime.optional(),
  uploadedByName: z.string().optional(),
});

export const migrationBatchView: z.ZodType<M.MigrationBatchView> = z.intersection(
  migrationBatchSummary,
  z.object({
    steps: z.array(stepView),
    rejectReason: z.string().optional(),
    appliedAt: isoDateTime.optional(),
    rolledBackAt: isoDateTime.optional(),
    rolledBackByName: z.string().optional(),
    rollbackReason: z.string().optional(),
    canApprove: z.boolean(),
    isAuthor: z.boolean(),
    reconciliation: z.array(
      z.object({
        metric: z.enum(['clients', 'contracts', 'insured', 'premium', 'limitsUsed', 'claims', 'reserves', 'invoices', 'invoicesOutstanding']),
        money: z.boolean(),
        file: z.number(),
        excluded: z.number(),
        loaded: z.number(),
        match: z.boolean(),
      }),
    ),
    rollback: z
      .object({
        allowed: z.boolean(),
        blockers: z.array(
          z.object({
            kind: z.enum(['audit', 'claim', 'payment', 'endorsement', 'change_request', 'policy_change', 'appointment', 'guarantee', 'visit', 'invoice', 'contract', 'insured', 'consent', 'chat', 'file', 'limit_request', 'case', 'kp', 'deal']),
            label: z.string(),
            at: isoDateTime.optional(),
            actorName: z.string().optional(),
            action: z.string().optional(),
          }),
        ),
      })
      .optional(),
    contracts: z.array(z.object({ id: uuid, number: z.string(), externalNumber: z.string(), clientName: z.string() })),
  }),
);

export const migratedScan = z.object({ migratedScan: z.object({ fileId: uuid, uploadedAt: isoDateTime, uploadedByName: z.string() }) });
