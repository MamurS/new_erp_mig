/* Policy issuance and the queue of insured-list changes (POLICY_SPEC). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PolicyTariff, ProgramCode } from '@/shared/types';
import { request } from '../client';
import * as S from '../schemas';

const pk = {
  changes: (p: Record<string, string>) => ['policy-changes', p] as const,
};

export const usePolicyChanges = (p: Record<string, string>, enabled = true) =>
  useQuery({ queryKey: pk.changes(p), queryFn: () => request('/policy-changes', { query: p, schema: S.policyChanges }), enabled });

export function useCheckPolicyList() {
  return useMutation({
    mutationFn: (v: { clientId: string; csv: string }) =>
      request(`/clients/${v.clientId}/policies/check`, { method: 'POST', body: v.csv, headers: { 'Content-Type': 'text/csv' }, schema: S.policyListCheck }),
  });
}

export interface PolicyIssueBody {
  program: ProgramCode;
  startDate: string;
  endDate: string;
  tariff: PolicyTariff;
  csv: string;
  hr?: { fullName: string; email: string };
}

export function useIssuePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { clientId: string; body: PolicyIssueBody }) => request(`/clients/${v.clientId}/policies`, { method: 'POST', body: v.body, schema: S.policy }),
    onSuccess: (_p, v) => {
      void qc.invalidateQueries({ queryKey: ['client', v.clientId] });
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['policies'] });
    },
  });
}

export function useDecidePolicyChanges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[]; decision: 'approve' | 'reject'; reason?: string }) =>
      request('/policy-changes/decision', { method: 'POST', body, schema: S.policyChangeDecisionResult }),
    onSuccess: () => {
      for (const key of ['policy-changes', 'policy', 'policies', 'client', 'clients', 'queue', 'dashboard']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}
