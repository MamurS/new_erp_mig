/* Portfolio transfer (/staff/admin/migration): batches, files, four-eyes, rollback. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MigrationStep } from '@mig/contracts/migration';
import { request } from '../client';
import * as M from '@mig/contracts/schemas-migration';

const mk = {
  all: ['migration'] as const,
  list: ['migration', 'list'] as const,
  batch: (id: string) => ['migration', 'batch', id] as const,
};

export const useMigrationBatches = () => useQuery({ queryKey: mk.list, queryFn: () => request('/admin/migration/batches', { schema: M.migrationBatchList }) });
export const useMigrationBatch = (id: string) => useQuery({ queryKey: mk.batch(id), queryFn: () => request(`/admin/migration/batches/${id}`, { schema: M.migrationBatchView }) });

/** Applying or rolling back a batch changes clients, contracts, policies, insured persons, claims and invoices. */
function useMigrationMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mk.all });
      for (const key of ['lifecycle', 'clients', 'client', 'policies', 'policy', 'insured', 'claims', 'claim', 'dashboard', 'queue', 'audit'])
        void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useCreateMigrationBatch = () => useMigrationMutation((migrationDate: string) => request('/admin/migration/batches', { method: 'POST', body: { migrationDate }, schema: M.migrationBatchView }));
export const useDiscardMigrationBatch = () => useMigrationMutation((id: string) => request(`/admin/migration/batches/${id}`, { method: 'DELETE' }));
export const useUploadMigrationStep = () =>
  useMigrationMutation((v: { id: string; step: MigrationStep; csv: string }) => request(`/admin/migration/batches/${v.id}/steps/${v.step}`, { method: 'POST', body: { csv: v.csv }, schema: M.migrationBatchView }));
export const useConfirmMigrationStep = () =>
  useMigrationMutation((v: { id: string; step: MigrationStep; excludeErrors: boolean }) =>
    request(`/admin/migration/batches/${v.id}/steps/${v.step}/confirm`, { method: 'POST', body: { excludeErrors: v.excludeErrors }, schema: M.migrationBatchView }),
  );
export const useSkipMigrationStep = () => useMigrationMutation((v: { id: string; step: MigrationStep }) => request(`/admin/migration/batches/${v.id}/steps/${v.step}/skip`, { method: 'POST', schema: M.migrationBatchView }));
export const useMigrationAction = () =>
  useMigrationMutation((v: { id: string; action: 'submit' | 'approve' }) => request(`/admin/migration/batches/${v.id}/${v.action}`, { method: 'POST', schema: M.migrationBatchView }));
export const useMigrationReasonAction = () =>
  useMigrationMutation((v: { id: string; action: 'reject' | 'rollback'; reason: string }) => request(`/admin/migration/batches/${v.id}/${v.action}`, { method: 'POST', body: { reason: v.reason }, schema: M.migrationBatchView }));
export const useManualMigration = () =>
  useMigrationMutation((v: { migrationDate: string; row: Record<string, string> }) => request('/admin/migration/manual', { method: 'POST', body: v, schema: M.migrationBatchView }));
export const useAttachMigratedScan = () =>
  useMigrationMutation((v: { contractId: string; file: File }) => {
    const form = new FormData();
    form.set('side', 'client');
    form.set('file', v.file);
    return request(`/contracts/${v.contractId}/migrated-scan`, { method: 'POST', body: form, schema: M.migratedScan });
  });
