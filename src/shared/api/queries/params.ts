/* DMS business parameters: values for screens and the /staff/admin/parameters editor. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DmsParamKey } from '@/shared/types';
import { DMS_DEFAULTS } from '@/shared/config/dmsParameters';
import { useSession } from '@/shared/auth/session';
import { request } from '../client';
import * as S from '../schemas';

const pk = {
  all: ['params'] as const,
  values: ['params', 'values'] as const,
  view: ['params', 'view'] as const,
};

/** Current values from the server; falls back to the demo value until they load (or for keys the portal is not given). */
export function useDmsParam(key: DmsParamKey): number {
  const session = useSession();
  const q = useQuery({ queryKey: pk.values, queryFn: () => request('/params/values', { schema: S.dmsParamValues }), enabled: !!session, staleTime: 5 * 60_000 });
  return q.data?.[key] ?? DMS_DEFAULTS[key];
}

/** All current values (the quote calculator previews the tariff with them). */
export function useDmsParamValues(): Record<DmsParamKey, number> {
  const session = useSession();
  const q = useQuery({ queryKey: pk.values, queryFn: () => request('/params/values', { schema: S.dmsParamValues }), enabled: !!session, staleTime: 5 * 60_000 });
  return { ...DMS_DEFAULTS, ...q.data };
}

export const useDmsParams = () => useQuery({ queryKey: pk.view, queryFn: () => request('/params', { schema: S.dmsParamsView }) });

function useParamsMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: pk.all }) });
}

export const useProposeDmsParam = () =>
  useParamsMutation((v: { key: DmsParamKey; value: number; reason: string }) => request('/params/changes', { method: 'POST', body: v, schema: S.dmsParamChange }));
export const useApproveDmsParam = () => useParamsMutation((id: string) => request(`/params/changes/${id}/approve`, { method: 'POST', schema: S.dmsParamChange }));
export const useRejectDmsParam = () =>
  useParamsMutation((v: { id: string; reason: string }) => request(`/params/changes/${v.id}/reject`, { method: 'POST', body: { reason: v.reason }, schema: S.dmsParamChange }));
