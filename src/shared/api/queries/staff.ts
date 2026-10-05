import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClaimStatus, LimitCategory, PiiField, Specialty, StaffRole } from '@/shared/types';
import { request } from '../client';
import * as S from '../schemas';
import { qk, type Params } from './keys';

const list = { placeholderData: keepPreviousData };

// ---- dashboard ----
export const useDashboard = () => useQuery({ queryKey: qk.dashboard, queryFn: () => request('/dashboard', { schema: S.dashboard }) });
export const useQueue = (type: string, p: Record<string, string> = {}) =>
  // No placeholder from another tab: an action button must never belong to a row of the previous tab.
  useQuery({ queryKey: qk.queue(type, p), queryFn: () => request('/queue', { query: { ...p, type }, schema: S.queueItems }) });
export const useMedicalAccessFeed = (enabled: boolean) =>
  useQuery({ queryKey: qk.medicalFeed, queryFn: () => request('/dashboard/medical-access', { schema: S.auditList }), enabled });
export const useIntegrations = () =>
  useQuery({ queryKey: qk.integrations, queryFn: () => request('/integrations/status', { schema: S.integrations }) });

// ---- clients ----
export const useClients = (p: Params, enabled = true) =>
  useQuery({ queryKey: qk.clients(p), queryFn: () => request('/clients', { query: p, schema: S.clientList }), enabled, ...list });
export const useClient = (id: string | undefined) =>
  useQuery({ queryKey: qk.client(id ?? ''), queryFn: () => request(`/clients/${id}`, { schema: S.clientDetail }), enabled: !!id });
export const useClientLossStats = (id: string | undefined) =>
  useQuery({ queryKey: ['client-loss', id ?? ''], queryFn: () => request(`/clients/${id}/loss-stats`, { schema: S.clientLossStats }), enabled: !!id });
export const useClientInsured = (id: string, p: Params) =>
  useQuery({
    queryKey: qk.clientInsured(id, p),
    queryFn: () => request(`/clients/${id}/insured`, { query: p, schema: S.insuredPage }),
    ...list,
  });
export const useClientDocuments = (id: string) =>
  useQuery({ queryKey: qk.clientDocuments(id), queryFn: () => request(`/clients/${id}/documents`, { schema: S.clientDocuments }) });
export const useClientHistory = (id: string) =>
  useQuery({ queryKey: qk.clientHistory(id), queryFn: () => request(`/clients/${id}/history`, { schema: S.auditList }) });
export function useHrLetter() {
  return useMutation({
    mutationFn: (v: { clientId: string; subject: string; text: string }) =>
      request(`/clients/${v.clientId}/hr-letter`, { method: 'POST', body: { subject: v.subject, text: v.text }, schema: S.ok }),
  });
}
export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { legalForm: string; name: string; inn: string; status: string }) =>
      request('/clients', { method: 'POST', body, schema: S.client }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

// ---- policies ----
export const usePolicies = (p: Params, enabled = true) =>
  useQuery({ queryKey: qk.policies(p), queryFn: () => request('/policies', { query: p, schema: S.policyPage }), enabled, ...list });
export const usePolicy = (id: string | undefined) =>
  useQuery({ queryKey: qk.policy(id ?? ''), queryFn: () => request(`/policies/${id}`, { schema: S.policyDetail }), enabled: !!id });
// ---- insured ----
export const useInsuredList = (p: Params, enabled = true) =>
  useQuery({ queryKey: qk.insuredList(p), queryFn: () => request('/insured', { query: p, schema: S.insuredPage }), enabled, ...list });
export const useInsured = (id: string | undefined) =>
  useQuery({ queryKey: qk.insured(id ?? ''), queryFn: () => request(`/insured/${id}`, { schema: S.insuredDetail }), enabled: !!id });
export const useInsuredLimits = (id: string) =>
  useQuery({ queryKey: qk.insuredLimits(id), queryFn: () => request(`/insured/${id}/limits`, { schema: S.limitUsages }) });
export const useInsuredClaims = (id: string) =>
  useQuery({ queryKey: qk.insuredClaims(id), queryFn: () => request(`/insured/${id}/claims`, { schema: S.insuredClaims }) });
export const useInsuredDocuments = (id: string) =>
  useQuery({ queryKey: qk.insuredDocuments(id), queryFn: () => request(`/insured/${id}/documents`, { schema: S.insuredDocuments }) });
export const useInsuredAccessLog = (id: string) =>
  useQuery({ queryKey: qk.insuredAccessLog(id), queryFn: () => request(`/insured/${id}/access-log`, { schema: S.auditList }) });

/** Reveal is a mutation on purpose: the value never enters the query cache. */
export function useReveal(base = '/insured') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { insuredId: string; field: PiiField; reason: string }) =>
      request(`${base}/${v.insuredId}/reveal`, { method: 'POST', body: { field: v.field, reason: v.reason }, schema: S.reveal }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: qk.insuredAccessLog(v.insuredId) }),
  });
}
export function useRevealCopied(base = '/insured') {
  return useMutation({
    mutationFn: (v: { insuredId: string; field: PiiField }) =>
      request(`${base}/${v.insuredId}/reveal-copied`, { method: 'POST', body: { field: v.field }, schema: S.ok }),
  });
}
export function useMedicalAccess(base = '/insured') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { insuredId: string; reason: string }) =>
      request(`${base}/${v.insuredId}/medical-access`, { method: 'POST', body: { reason: v.reason }, schema: S.medicalGrant }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: qk.insuredAccessLog(v.insuredId) }),
  });
}
export const useMedicalRecords = (insuredId: string, grantId: string | null, base = '/insured') =>
  useQuery({
    queryKey: [...qk.medical(insuredId, grantId ?? ''), base],
    queryFn: () =>
      request(`${base}/${insuredId}/medical`, { headers: { 'X-Medical-Grant': grantId ?? '' }, schema: S.medicalRecords }),
    enabled: !!grantId,
    gcTime: 0,
    staleTime: 0,
  });
export function useGuaranteeLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { insuredId: string; clinicId: string; service: string }) =>
      request(`/insured/${v.insuredId}/guarantee-letters`, {
        method: 'POST',
        body: { clinicId: v.clinicId, service: v.service },
        schema: S.idResult,
      }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: qk.insuredDocuments(v.insuredId) }),
  });
}

// ---- claims ----
export const useClaims = (p: Params, enabled = true) =>
  useQuery({ queryKey: qk.claims(p), queryFn: () => request('/claims', { query: p, schema: S.claimPage }), enabled, ...list });
export const useClaim = (id: string | undefined) =>
  useQuery({ queryKey: qk.claim(id ?? ''), queryFn: () => request(`/claims/${id}`, { schema: S.claimDetail }), enabled: !!id });
export function useTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { claimId: string; to: ClaimStatus; amountApproved?: number; comment?: string }) =>
      request(`/claims/${v.claimId}/transition`, {
        method: 'POST',
        body: { to: v.to, amountApproved: v.amountApproved, comment: v.comment },
        schema: S.claimDetail,
      }),
    onSuccess: (data) => {
      qc.setQueryData(qk.claim(data.id), data);
      void qc.invalidateQueries({ queryKey: ['claims'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: ['insured'] });
    },
  });
}
export function useCreateClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { insuredId: string; category: string; amount: number; serviceDate: string; providerName: string }) =>
      request('/claims', { method: 'POST', body, schema: S.idResult }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['claims'] });
      void qc.invalidateQueries({ queryKey: qk.insuredClaims(v.insuredId) });
    },
  });
}

// ---- appointments ----
export const useAppointments = (p: Params, enabled = true) =>
  useQuery({
    queryKey: qk.appointments(p),
    queryFn: () => request('/appointments', { query: p, schema: S.appointmentPage }),
    enabled,
    ...list,
  });
function useApptInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
    void qc.invalidateQueries({ queryKey: ['queue'] });
    void qc.invalidateQueries({ queryKey: qk.dashboard });
  };
}
export function useConfirmAppointment() {
  const inv = useApptInvalidate();
  return useMutation({
    mutationFn: (id: string) => request(`/appointments/${id}/confirm`, { method: 'POST', schema: S.appointment }),
    onSuccess: inv,
  });
}
export function useDeclineAppointment() {
  const inv = useApptInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      request(`/appointments/${v.id}/decline`, { method: 'POST', body: { reason: v.reason }, schema: S.appointment }),
    onSuccess: inv,
  });
}
export function useCreateAppointment() {
  const inv = useApptInvalidate();
  return useMutation({
    mutationFn: (body: { insuredId: string; clinicId: string; specialty: Specialty; startsAt: string }) =>
      request('/appointments', { method: 'POST', body, schema: S.appointment }),
    onSuccess: inv,
  });
}

// ---- clinics ----
export const useClinics = (p: Params, enabled = true) =>
  useQuery({ queryKey: qk.clinics(p), queryFn: () => request('/clinics', { query: p, schema: S.clinics }), enabled, ...list });
export const useSlots = (clinicId: string | null, date: string) =>
  useQuery({
    queryKey: qk.slots(clinicId ?? '', date),
    queryFn: () => request(`/clinics/${clinicId}/slots`, { query: { date }, schema: S.slots }),
    enabled: !!clinicId,
  });

// ---- limit requests ----
export const useLimitRequests = (p: Params) =>
  useQuery({ queryKey: qk.limitRequests(p), queryFn: () => request('/limit-requests', { query: p, schema: S.limitRequests }) });
export function useCreateLimitRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { policyId: string; insuredId?: string; category: LimitCategory; to: number; justification: string }) =>
      request('/limit-requests', { method: 'POST', body, schema: S.limitRequest }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['limit-requests'] }),
  });
}
export function useDecideLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject'; comment?: string }) =>
      request(`/limit-requests/${v.id}/${v.decision}`, {
        method: 'POST',
        body: v.decision === 'reject' ? { comment: v.comment } : undefined,
        schema: S.limitRequest,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['limit-requests'] }),
  });
}

// ---- reports ----
export const useLossRatioReport = () =>
  useQuery({ queryKey: qk.report('loss'), queryFn: () => request('/reports/loss-ratio-by-client', { schema: S.lossRatioRows }) });
export const useClaimsByCategoryReport = (p: Params) =>
  useQuery({
    queryKey: qk.report('cat', p),
    queryFn: () => request('/reports/claims-by-category', { query: p, schema: S.claimsByCategoryRows }),
    ...list,
  });
export const usePremiumReport = () =>
  useQuery({ queryKey: qk.report('premium'), queryFn: () => request('/reports/premium-by-month', { schema: S.premiumByMonthRows }) });

export type ExportType =
  | 'clients'
  | 'claims_financial'
  | 'policies'
  | 'hr_employees'
  | 'loss_ratio'
  | 'claims_by_category'
  | 'premium_by_month';
export function useExport() {
  return useMutation({
    mutationFn: (type: ExportType) => request('/exports', { method: 'POST', body: { type }, as: 'text' }) as Promise<string>,
  });
}

// ---- audit & admin ----
export const useAudit = (p: Params) =>
  useQuery({ queryKey: qk.audit(p), queryFn: () => request('/audit', { query: p, schema: S.auditPage }), ...list });
export const useAdminUsers = (enabled = true) =>
  useQuery({ queryKey: qk.adminUsers, queryFn: () => request('/admin/users', { schema: S.staffUsers }), enabled });
export function usePatchUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; role?: StaffRole; active?: boolean }) =>
      request(`/admin/users/${v.id}`, { method: 'PATCH', body: { role: v.role, active: v.active }, schema: S.staffUser }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.adminUsers }),
  });
}

