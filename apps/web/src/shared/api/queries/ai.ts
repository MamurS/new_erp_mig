/* AI coverage check (AI_COVERAGE_SPEC): status, checks, feedback, administration. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { AiSettings } from '@mig/contracts';
import type { aiCheckRequestSchema } from '@mig/contracts/forms';
import { useSession } from '@/shared/auth/session';
import { request } from '../client';
import * as A from '@mig/contracts/schemas-ai';

export type AiCheckRequest = z.input<typeof aiCheckRequestSchema>;

const ak = {
  all: ['ai'] as const,
  status: ['ai', 'status'] as const,
  admin: ['ai', 'admin'] as const,
  hint: (type: string, id: string) => ['ai', 'hint', type, id] as const,
};

/** Which scenarios are on; the kill switch hides every AI block. */
export function useAiStatus() {
  const session = useSession();
  return useQuery({ queryKey: ak.status, queryFn: () => request('/ai/status', { schema: A.aiStatus }), enabled: !!session, staleTime: 15_000 });
}

/** `personId`: the insured scenario for a person of the family (FAMILY_SPEC; the server answers 404 for anyone else). */
export const useAiCheck = () =>
  useMutation({
    mutationFn: ({ personId, ...v }: AiCheckRequest & { personId?: string }) =>
      request('/ai/coverage-check', { method: 'POST', body: v, query: personId ? { personId } : undefined, schema: A.aiCheckResult }),
  });

/** A decision hint for one record: asked once per screen visit (every answer is logged). */
export const useAiHint = (subject: { type: 'claim' | 'guarantee' | 'registry_line'; id: string }, enabled: boolean) =>
  useQuery({
    queryKey: ak.hint(subject.type, subject.id),
    queryFn: () => request('/ai/coverage-check', { method: 'POST', body: { scenario: 'decision', subject }, schema: A.aiCheckResult }),
    enabled,
    staleTime: Infinity,
    retry: false,
  });

export function useAiFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { logId: string; agree: boolean; comment?: string }) => request('/ai/feedback', { method: 'POST', body: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ak.admin }),
  });
}

export function useRebillPrecheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rebillId: string) => request(`/rebills/${rebillId}/ai-precheck`, { method: 'POST' }) as Promise<{ checked: number; flagged: number }>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-assistance'] });
    },
  });
}

export const useAiAdmin = () => useQuery({ queryKey: ak.admin, queryFn: () => request('/ai/admin', { schema: A.aiAdminView }) });

function useAdminMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ak.all }) });
}
export const useProposeAiSettings = () => useAdminMutation((v: { to: AiSettings; reason: string }) => request('/ai/admin/changes', { method: 'POST', body: v, schema: A.aiChange }));
export const useDecideAiSettings = () =>
  useAdminMutation((v: { id: string; decision: 'approve' | 'reject'; reason?: string }) =>
    request(`/ai/admin/changes/${v.id}/${v.decision}`, { method: 'POST', body: v.decision === 'reject' ? { reason: v.reason } : undefined, schema: A.aiChange }),
  );
export const useRunGolden = () => useMutation({ mutationFn: () => request('/ai/admin/eval', { method: 'POST', schema: A.aiGoldenResult }) });

/** Clinic: the coverage of a chosen service for the patient of an open visit (no sums of limits). */
export const useClinicCoverage = (visitId: string, serviceCode: string, icd10: string, enabled: boolean) =>
  useQuery({
    queryKey: ['ai', 'clinic', visitId, serviceCode, icd10] as const,
    queryFn: () => request('/ai/coverage-check', { method: 'POST', body: { scenario: 'clinic', subject: { type: 'visit', id: visitId }, serviceCode, icd10: icd10 || undefined }, schema: A.aiCheckResult }),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

/** Clinic: «Проверить строки» of a registry before it is sent. */
export const useRegistryAiCheck = () => useMutation({ mutationFn: (registryId: string) => request('/ai/coverage-check', { method: 'POST', body: { scenario: 'clinic', subject: { type: 'registry', id: registryId } }, schema: A.aiCheckResult }) });
