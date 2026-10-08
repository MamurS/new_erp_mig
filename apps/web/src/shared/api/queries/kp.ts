import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { KpDocument, KpParams } from '@mig/contracts';
import { request } from '../client';
import * as S from '@mig/contracts/schemas';
import { qk } from './keys';

export const useClientKp = (clientId: string, enabled = true) =>
  useQuery({ queryKey: qk.clientKp(clientId), queryFn: () => request(`/clients/${clientId}/kp`, { schema: S.kpDocuments }), enabled });

export const useKpDefaults = (clientId: string | undefined, policyId: string | undefined) =>
  useQuery({
    queryKey: qk.kpDefaults(clientId ?? '', policyId ?? ''),
    queryFn: () => request(`/clients/${clientId}/kp-defaults`, { query: { policyId }, schema: S.kpDefaults }),
    enabled: !!clientId,
    // Defaults are a starting point for a new form; never serve a stale prefill.
    gcTime: 0,
    staleTime: 0,
  });

export const useKp = (id: string | undefined) =>
  useQuery({ queryKey: qk.kp(id ?? ''), queryFn: () => request(`/kp/${id}`, { schema: S.kpDocument }), enabled: !!id });

function invalidateKp(qc: QueryClient, kp: KpDocument) {
  qc.setQueryData(qk.kp(kp.id), kp);
  void qc.invalidateQueries({ queryKey: qk.clientKp(kp.clientId) });
  void qc.invalidateQueries({ queryKey: qk.client(kp.clientId), exact: true });
  void qc.invalidateQueries({ queryKey: ['clients'] });
  void qc.invalidateQueries({ queryKey: ['queue'] });
  void qc.invalidateQueries({ queryKey: qk.dashboard });
}

export function useCreateKp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { clientId: string; policyId?: string; params: KpParams }) =>
      request(`/clients/${v.clientId}/kp`, { method: 'POST', query: { policyId: v.policyId }, body: v.params, schema: S.kpDocument }),
    onSuccess: (kp) => invalidateKp(qc, kp),
  });
}

export function useUpdateKp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; params: KpParams }) => request(`/kp/${v.id}`, { method: 'PATCH', body: v.params, schema: S.kpDocument }),
    onSuccess: (kp) => invalidateKp(qc, kp),
  });
}

export function useKpAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: 'send' | 'revoke' }) => request(`/kp/${v.id}/${v.action}`, { method: 'POST', schema: S.kpDocument }),
    onSuccess: (kp) => invalidateKp(qc, kp),
  });
}

/** Audit-only call made when the user opens the print dialog to save a PDF. */
export function useKpDownloaded() {
  return useMutation({ mutationFn: (id: string) => request(`/kp/${id}/downloaded`, { method: 'POST' }) });
}
