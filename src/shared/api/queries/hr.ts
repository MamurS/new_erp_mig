import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HrEmployeePayload } from '@/shared/schemas/forms';
import { request } from '../client';
import * as S from '../schemas';
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
        body: new Blob([v.csv], { type: 'text/csv' }),
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
