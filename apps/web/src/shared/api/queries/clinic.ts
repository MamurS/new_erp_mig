/* Queries of the clinic cabinet (/api/clinic/...) and of the staff clinic screens. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { IntegrationMode } from '@mig/contracts';
import type { guaranteeCreateRequest, registryLineInput } from '@mig/contracts/integration';
import { request } from '../client';
import * as S from '@mig/contracts/schemas';
import * as C from '@mig/contracts/schemas-clinic';

const ck = {
  all: ['clinic'] as const,
  overview: ['clinic', 'overview'] as const,
  visits: (scope: string) => ['clinic', 'visits', scope] as const,
  coverage: (id: string) => ['clinic', 'coverage', id] as const,
  appointments: (view: string, from: string, days: number) => ['clinic', 'appointments', view, from, days] as const,
  slots: (date: string) => ['clinic', 'slots', date] as const,
  guarantees: ['clinic', 'guarantees'] as const,
  priceList: ['clinic', 'price-list'] as const,
  registries: ['clinic', 'registries'] as const,
  registry: (id: string) => ['clinic', 'registry', id] as const,
  documents: ['clinic', 'documents'] as const,
  users: ['clinic', 'users'] as const,
};

// ---------------- cabinet ----------------
export const useClinicOverview = () => useQuery({ queryKey: ck.overview, queryFn: () => request('/clinic/overview', { schema: C.clinicOverview }) });
export const useClinicVisits = (scope: 'today' | 'active' | string = 'today') =>
  useQuery({
    queryKey: ck.visits(scope),
    queryFn: () => request('/clinic/visits', { query: scope === 'today' || scope === 'active' ? { scope } : { period: scope }, schema: C.clinicVisits }),
  });
export const useVisitCoverage = (visitId: string | undefined) =>
  useQuery({ queryKey: ck.coverage(visitId ?? ''), queryFn: () => request(`/clinic/visits/${visitId}/coverage`, { schema: C.coverage }), enabled: !!visitId, retry: false });

export function useCheckPatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { qrToken: string } | { policyNumber: string; pinfl: string }) => request('/clinic/check', { method: 'POST', body, schema: C.coverage }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clinic', 'visits'] });
      void qc.invalidateQueries({ queryKey: ck.overview });
    },
  });
}

export const useClinicAppointments = (view: 'requests' | 'schedule', from: string, days: number) =>
  useQuery({
    queryKey: ck.appointments(view, from, days),
    queryFn: () => request('/clinic/appointments', { query: { view, from, days }, schema: C.clinicAppointments }),
  });
export const useClinicSlots = (date: string, enabled: boolean) =>
  useQuery({ queryKey: ck.slots(date), queryFn: () => request('/clinic/slots', { query: { date }, schema: S.slots }), enabled });
export function useRespondAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; kind: 'confirm' } | { id: string; kind: 'reschedule'; startsAt: string } | { id: string; kind: 'decline'; reason: string }) =>
      request(`/clinic/appointments/${v.id}/${v.kind}`, {
        method: 'POST',
        body: v.kind === 'reschedule' ? { startsAt: v.startsAt } : v.kind === 'decline' ? { reason: v.reason } : undefined,
        schema: C.clinicAppointment,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ck.all }),
  });
}

export const useClinicGuarantees = () => useQuery({ queryKey: ck.guarantees, queryFn: () => request('/clinic/guarantees', { schema: C.guaranteeViews }) });
/** Without a visit — the MIG price list; with a visit — the prices of the patient's payer. */
export const useClinicPriceList = (visitId?: string) =>
  useQuery({ queryKey: [...ck.priceList, visitId ?? ''], queryFn: () => request('/clinic/price-list', { query: { visitId }, schema: C.priceList }), staleTime: 5 * 60_000 });
export function useRequestGuarantee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { input: z.input<typeof guaranteeCreateRequest>; files: File[] }) => {
      const g = await request('/clinic/guarantees', { method: 'POST', body: v.input, schema: C.guaranteeView });
      if (!v.files.length) return g;
      const form = new FormData();
      for (const f of v.files) form.append('files', f);
      return request(`/clinic/guarantees/${g.id}/documents`, { method: 'POST', body: form, schema: C.guaranteeView });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ck.all }),
  });
}
export function useAnswerGuarantee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; comment: string; files: File[] }) => {
      const form = new FormData();
      form.append('comment', v.comment);
      for (const f of v.files) form.append('files', f);
      return request(`/clinic/guarantees/${v.id}/documents`, { method: 'POST', body: form, schema: C.guaranteeView });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ck.all }),
  });
}

export const useClinicRegistries = () => useQuery({ queryKey: ck.registries, queryFn: () => request('/clinic/registries', { schema: C.registrySummaries }) });
export const useClinicRegistry = (id: string | undefined) =>
  useQuery({ queryKey: ck.registry(id ?? ''), queryFn: () => request(`/clinic/registries/${id}`, { schema: C.registryView }), enabled: !!id });
function useRegistryMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ck.all }) });
}
export const useBuildRegistry = () => useRegistryMutation((period: string) => request('/clinic/registries/build', { method: 'POST', body: { period }, schema: C.registryView }));
export const useAddRegistryLine = () =>
  useRegistryMutation((v: { id: string; line: z.input<typeof registryLineInput> }) => request(`/clinic/registries/${v.id}/lines`, { method: 'POST', body: v.line, schema: C.registryView }));
export const useDeleteRegistryLine = () =>
  useRegistryMutation((v: { id: string; lineId: string }) => request(`/clinic/registries/${v.id}/lines/${v.lineId}`, { method: 'DELETE', schema: C.registryView }));
export const useSubmitRegistry = () => useRegistryMutation((id: string) => request(`/clinic/registries/${id}/submit`, { method: 'POST', schema: C.registryView }));
export const useDisputeLine = () =>
  useRegistryMutation((v: { id: string; lineId: string; comment: string }) =>
    request(`/clinic/registries/${v.id}/lines/${v.lineId}/dispute`, { method: 'POST', body: { comment: v.comment }, schema: C.registryView }),
  );
export function useImportRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { file: File; period: string; commit: boolean }) => {
      const form = new FormData();
      form.append('file', v.file);
      form.append('period', v.period);
      return request('/clinic/registries/import', { method: 'POST', body: form, query: v.commit ? { commit: 1 } : undefined, schema: C.registryImport });
    },
    onSuccess: (r) => {
      if (r.registryId) void qc.invalidateQueries({ queryKey: ck.all });
    },
  });
}

export const useClinicDocuments = () => useQuery({ queryKey: ck.documents, queryFn: () => request('/clinic/documents', { schema: C.clinicDocuments }) });

export const useClinicUsers = () => useQuery({ queryKey: ck.users, queryFn: () => request('/clinic/users', { schema: C.clinicUsers }) });
export function useInviteClinicUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; fullName: string; role: 'clinic_registrar' | 'clinic_admin' }) => request('/clinic/users', { method: 'POST', body, schema: C.clinicUser }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ck.users }),
  });
}
export function usePatchClinicUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; role?: 'clinic_registrar' | 'clinic_admin'; active?: boolean }) =>
      request(`/clinic/users/${v.id}`, { method: 'PATCH', body: { role: v.role, active: v.active }, schema: C.clinicUser }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ck.users }),
  });
}

// ---- integration (the partner framework: clinic cabinet or assistance portal) ----
const CLINIC_BASE = '/clinic/integration';
const ik = (base: string) => ['integration', base] as const;
export const useIntegrationOverview = (base = CLINIC_BASE) => useQuery({ queryKey: [...ik(base), 'overview'], queryFn: () => request(`${base}/overview`, { schema: C.integrationOverview }) });
export const useIntegrationKeys = (base = CLINIC_BASE) => useQuery({ queryKey: [...ik(base), 'keys'], queryFn: () => request(`${base}/keys`, { schema: C.integrationClients }) });
export const useWebhooks = (base = CLINIC_BASE) => useQuery({ queryKey: [...ik(base), 'webhooks'], queryFn: () => request(`${base}/webhooks`, { schema: C.webhookEndpoints }) });
export const useDeliveries = (base = CLINIC_BASE) => useQuery({ queryKey: [...ik(base), 'deliveries'], queryFn: () => request(`${base}/deliveries`, { schema: C.webhookDeliveries }) });
export const useApiLogs = (base = CLINIC_BASE) => useQuery({ queryKey: [...ik(base), 'logs'], queryFn: () => request(`${base}/logs`, { schema: C.apiLogs }) });
function useIntegrationMutation<V, R>(base: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ik(base) }) });
}
export const useCreateKey = (base = CLINIC_BASE) =>
  useIntegrationMutation(base, (body: { name: string; scopes: string[]; ipAllowlist: string }) => request(`${base}/keys`, { method: 'POST', body, schema: C.keyCreated }));
export const useRevokeKey = (base = CLINIC_BASE) => useIntegrationMutation(base, (id: string) => request(`${base}/keys/${id}/revoke`, { method: 'POST', schema: C.integrationClient }));
export const useCreateWebhook = (base = CLINIC_BASE) =>
  useIntegrationMutation(base, (body: { url: string; events: string[] }) => request(`${base}/webhooks`, { method: 'POST', body, schema: C.webhookCreated }));
export const useTestWebhook = (base = CLINIC_BASE) => useIntegrationMutation(base, (id: string) => request(`${base}/webhooks/${id}/test`, { method: 'POST', schema: C.webhookDelivery }));
export const useRetryDelivery = (base = CLINIC_BASE) => useIntegrationMutation(base, (id: string) => request(`${base}/deliveries/${id}/retry`, { method: 'POST', schema: C.webhookDelivery }));

// ---------------- staff ----------------
const sk = {
  card: (id: string) => ['staff-clinic', 'card', id] as const,
  guarantees: (p: Record<string, string>) => ['staff-clinic', 'guarantees', p] as const,
  registries: (p: Record<string, string>) => ['staff-clinic', 'registries', p] as const,
  registry: (id: string) => ['staff-clinic', 'registry', id] as const,
};
export const useClinicCard = (id: string) => useQuery({ queryKey: sk.card(id), queryFn: () => request(`/clinics/${id}/card`, { schema: C.clinicCard }) });
export const useStaffGuarantees = (p: Record<string, string>, enabled = true) =>
  useQuery({ enabled, queryKey: sk.guarantees(p), queryFn: () => request('/guarantees', { query: p, schema: C.guaranteeViews }) });
export const useStaffRegistries = (p: Record<string, string>, enabled = true) =>
  useQuery({ enabled, queryKey: sk.registries(p), queryFn: () => request('/registries', { query: p, schema: C.registrySummaries }) });
export const useStaffRegistry = (id: string) => useQuery({ queryKey: sk.registry(id), queryFn: () => request(`/registries/${id}`, { schema: C.registryView }) });
function useStaffMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-clinic'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['clinics'] });
    },
  });
}
export const useDecideGuarantee = () =>
  useStaffMutation(
    (v: { id: string; body: { action: 'approve'; amount: number; validUntil: string } | { action: 'reject' | 'request_info'; reason: string } }) =>
      request(`/guarantees/${v.id}/decision`, { method: 'POST', body: v.body, schema: C.guaranteeView }),
  );
export const useDecideLine = () =>
  useStaffMutation((v: { id: string; lineId: string; body: { decision: 'accept' } | { decision: 'reject'; reason: string } }) =>
    request(`/registries/${v.id}/lines/${v.lineId}/decision`, { method: 'POST', body: v.body, schema: C.registryView }),
  );
export const usePayRegistry = () => useStaffMutation((id: string) => request(`/registries/${id}/pay`, { method: 'POST', schema: C.registryView }));
export const useCreateClinic = () =>
  useStaffMutation((body: { name: string; address: string; district: string; specialties: string[]; integrationMode: IntegrationMode }) =>
    request('/clinics', { method: 'POST', body, schema: S.clinic }),
  );
export const useSetClinicMode = () =>
  useStaffMutation((v: { id: string; integrationMode: IntegrationMode }) => request(`/clinics/${v.id}`, { method: 'PATCH', body: { integrationMode: v.integrationMode }, schema: S.clinic }));
export const useInviteClinicAdmin = () =>
  useStaffMutation((v: { id: string; email: string; fullName: string }) => request(`/clinics/${v.id}/admins`, { method: 'POST', body: { email: v.email, fullName: v.fullName }, schema: C.clinicUser }));
export const useStaffRevokeKey = () =>
  useStaffMutation((v: { clinicId: string; keyId: string }) => request(`/clinics/${v.clinicId}/keys/${v.keyId}/revoke`, { method: 'POST', schema: C.integrationClient }));
