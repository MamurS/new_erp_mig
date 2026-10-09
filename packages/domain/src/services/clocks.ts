/*
 * Lazy server clocks (BACKEND_SPEC §10, docs/PRIVILEGED_AUDIT.md): state that changes with time alone — an approved
 * guarantee letter past its validity expires, an unpaid invoice past its due date becomes overdue — is saved by
 * whoever reads it first, as a background job would. The reader may not update the row (a clinic's letter read by
 * MIG, an invoice read by HR), so the save is the system's: this module is on the allowlist of the lint rule
 * against privileged access (eslint.config.js) together with the jobs, the portfolio transfer and the demo routes.
 */
import type { Invoice } from '@mig/contracts';
import { systemRepos, type BaseCtx } from './kernel';

/** An approved letter past its validity is saved as expired. */
export async function saveGuaranteeExpiry(ctx: BaseCtx, id: string): Promise<void> {
  await systemRepos(ctx, 'guarantee status by time (the lazy server clock, a job run on read)').guarantees.update(id, { status: 'expired' });
}

/** The status of an invoice by date (overdue, paid) is saved. */
export async function saveInvoiceStatus(ctx: BaseCtx, id: string, status: Invoice['status']): Promise<void> {
  await systemRepos(ctx, 'invoice status by date (the lazy server clock, a job run on read)').invoices.update(id, { status });
}
