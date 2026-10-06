/* Transfer of the existing portfolio from the previous system (/staff/admin/migration). Part of the API contract. */
import type { ISODate, ISODateTime, Money, UUID } from './index';

/** Load order: every step may refer to rows of the earlier ones (and to the database). */
export type MigrationStep = 'clients' | 'contracts' | 'insured' | 'limits' | 'claims' | 'invoices';

/**
 * `empty` — no file yet; `validated` — the dry run is done, nothing is written; `confirmed` — the
 * administrator accepted the report (rows with errors are excluded explicitly); `skipped` — nothing to load.
 */
export type MigrationStepStatus = 'empty' | 'validated' | 'confirmed' | 'skipped';

/** `draft` → `pending_approval` → `applied` (→ `rolled_back`) or `rejected`; a draft can be discarded. */
export type MigrationBatchStatus = 'draft' | 'pending_approval' | 'applied' | 'rejected' | 'rolled_back' | 'discarded';

/** One problem of a row: the CSV row number (header is row 1), the column and a message key. No values: they may be personal data. */
export interface MigrationIssue {
  row: number;
  field: string;
  level: 'error' | 'warning';
  /** Packed message key (msg()). */
  message: string;
}

/** Control figures of a step, computed from rows. */
export interface MigrationTotals {
  rows: number;
  /** Premiums (contracts), used limits (limits), reserves (claims), outstanding amounts (invoices). */
  amount: Money;
}

export interface MigrationStepView {
  step: MigrationStep;
  status: MigrationStepStatus;
  /** Data rows of the file (without the header). */
  total: number;
  valid: number;
  errorRows: number;
  warningRows: number;
  /** Rows with errors are excluded explicitly by the administrator (never written). */
  excludeErrors: boolean;
  /** At most 500 issues (the counters above are complete). */
  issues: MigrationIssue[];
  /** Figures of the whole file and of the rows that will be written. */
  fileTotals: MigrationTotals;
  validTotals: MigrationTotals;
  uploadedAt?: ISODateTime;
  uploadedByName?: string;
}

export type MigrationMetric = 'clients' | 'contracts' | 'insured' | 'premium' | 'limitsUsed' | 'claims' | 'reserves' | 'invoices' | 'invoicesOutstanding';

/** Reconciliation after the load: what the files say against what is in the system. */
export interface MigrationReconRow {
  metric: MigrationMetric;
  /** Money metrics are sums, the others counts. */
  money: boolean;
  /** Computed from the files (every row). */
  file: number;
  /** Rows with errors excluded from the load. */
  excluded: number;
  /** Computed from the records of the batch in the system now. */
  loaded: number;
  /** loaded === file. */
  match: boolean;
}

export interface MigrationRollbackBlocker {
  /** What happened to the transferred data. */
  kind: 'audit' | 'claim' | 'payment' | 'endorsement' | 'change_request' | 'policy_change' | 'appointment' | 'guarantee' | 'visit' | 'invoice' | 'contract' | 'insured' | 'consent' | 'chat' | 'file' | 'limit_request' | 'case' | 'kp' | 'deal';
  /** Number or label of the record (no personal data). */
  label: string;
  at?: ISODateTime;
  actorName?: string;
  /** Audit action, when the blocker is an audit event. */
  action?: string;
}

export interface MigrationBatchSummary {
  id: UUID;
  seq: number;
  kind: 'csv' | 'manual';
  status: MigrationBatchStatus;
  migrationDate: ISODate;
  createdAt: ISODateTime;
  createdById: UUID;
  createdByName: string;
  /** Rows that will be (or were) written, all steps. */
  rows: number;
  submittedAt?: ISODateTime;
  decidedAt?: ISODateTime;
  decidedByName?: string;
}

export interface MigrationBatchView extends MigrationBatchSummary {
  steps: MigrationStepView[];
  rejectReason?: string;
  appliedAt?: ISODateTime;
  rolledBackAt?: ISODateTime;
  rolledBackByName?: string;
  rollbackReason?: string;
  /** The viewer may apply the batch (another administrator, four-eyes). */
  canApprove: boolean;
  /** The viewer prepared the batch. */
  isAuthor: boolean;
  /** Before the load: the files against the rows to be written; after it: against the system. */
  reconciliation: MigrationReconRow[];
  /** Applied batches: can it be rolled back, and if not, why. */
  rollback?: { allowed: boolean; blockers: MigrationRollbackBlocker[] };
  /** Applied batches: transferred contracts (old and new numbers). */
  contracts: { id: UUID; number: string; externalNumber: string; clientName: string }[];
}
