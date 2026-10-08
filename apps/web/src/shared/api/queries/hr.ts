import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HrEmployeePayload, HrFamilyMemberInput } from '@mig/contracts/forms';
import { request } from '../client';
import * as S from '@mig/contracts/schemas';
import { qk, type Params } from './keys';

export const useHrOverview = () => useQuery({ queryKey: qk.hrOverview, queryFn: () => request('/hr/overview', { schema: S.hrOverview }) });
export const useHrEmployees = (p: Params) =>
  useQuery({
    queryKey: qk.hrEmployees(p),
    queryFn: () => request('/hr/employees', { query: p, schema: S.hrEmployeePage }),
    placeholderData: keepPreviousData,
  });
export const useHrDocuments = () => useQuery({ queryKey: qk.hrDocuments, queryFn: () => request('/hr/documents', { schema: S.clientDocuments }) });
export const useHrInvoices = () => useQuery({ queryKey: qk.hrInvoices, queryFn: () => request('/hr/invoices', { schema: S.invoices }) });
export const useHrStats = () => useQuery({ queryKey: qk.hrStats, queryFn: () => request('/hr/stats', { schema: S.hrStats }) });

function useHrInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['hr'] });
  };
}

export function useAddEmployee() {
  const inv = useHrInvalidate();
  return useMutation({
    mutationFn: (body: HrEmployeePayload) => request('/hr/employees', { method: 'POST', body, schema: S.hrEmployee }),
    onSuccess: inv,
  });
}
export function useExcludeEmployee() {
  const inv = useHrInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; excludeFrom: string }) =>
      request(`/hr/employees/${v.id}`, { method: 'DELETE', body: { excludeFrom: v.excludeFrom }, schema: S.hrEmployee }),
    onSuccess: inv,
  });
}
export function useImportEmployees() {
  const inv = useHrInvalidate();
  return useMutation({
    mutationFn: (v: { csv: string; commit: boolean }) =>
      request('/hr/employees/import', {
        method: 'POST',
        query: { commit: v.commit ? 1 : undefined },
        body: v.csv,
        headers: { 'Content-Type': 'text/csv' },
        schema: S.hrImportResult,
      }),
    onSuccess: (_d, v) => {
      if (v.commit) inv();
    },
  });
}
export function useInvite() {
  const inv = useHrInvalidate();
  return useMutation({
    mutationFn: (ids: string[] | 'all_not_in_app') =>
      request('/hr/employees/invite', { method: 'POST', body: { ids }, schema: S.inviteResult }),
    onSuccess: inv,
  });
}

// ---- family members (FAMILY_SPEC) ----
/** Family members of the company's employees (one employee with `employeeId`), with HR's requests not yet approved. */
export const useHrFamily = (employeeId?: string) =>
  useQuery({ queryKey: qk.hrFamily(employeeId), queryFn: () => request('/hr/family', { query: { employeeId }, schema: S.hrFamilyMembers }) });
/** HR adds a family member of an employee: a change request for MIG (endorsement, premium by the age group). */
export function useAddFamilyMember() {
  const inv = useHrInvalidate();
  return useMutation({
    mutationFn: (body: HrFamilyMemberInput) => request('/hr/family', { method: 'POST', body, schema: S.policyChange }),
    onSuccess: inv,
  });
}
/** Requests of employees from the app (`status`: 'pending', 'approved', 'rejected', comma-separated). */
export const useHrFamilyRequests = (status?: string) =>
  useQuery({ queryKey: qk.hrFamilyRequests(status), queryFn: () => request('/hr/family-requests', { query: { status }, schema: S.familyRequests }) });
/** Approve (→ change request from `startDate`, the next day by default) or reject (`reason`) an app request. */
export function useDecideFamilyRequest() {
  const inv = useHrInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject'; startDate?: string; reason?: string }) =>
      request(`/hr/family-requests/${v.id}/decision`, { method: 'POST', body: { decision: v.decision, startDate: v.startDate, reason: v.reason }, schema: S.familyRequest }),
    onSuccess: inv,
  });
}
