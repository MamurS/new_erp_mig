/* Queries of the assistance portal (/api/assist/...) and of the MIG assistance screens (ASSISTANCE_SPEC §6–7). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { assistanceCreateSchema, assistGuaranteeDecisionSchema, assistGuaranteeRequestSchema, caseCreateSchema } from '@/shared/schemas/forms';
import type { MedicalRecordEntry } from '@/shared/types';
import { request } from '../client';
import * as S from '../schemas';
import * as A from '../schemas-assist';
import * as C from '../schemas-clinic';

const ak = {
  all: ['assist'] as const,
  overview: ['assist', 'overview'] as const,
  insured: (q: string) => ['assist', 'insured', q] as const,
  person: (id: string) => ['assist', 'person', id] as const,
  cases: (p: Record<string, string>) => ['assist', 'cases', p] as const,
  case: (id: string) => ['assist', 'case', id] as const,
  appointments: (view: string) => ['assist', 'appointments', view] as const,
  threads: ['assist', 'chat'] as const,
  thread: (id: string) => ['assist', 'chat', id] as const,
  guarantees: (status: string) => ['assist', 'guarantees', status] as const,
  guarantee: (id: string) => ['assist', 'guarantee', id] as const,
  registries: ['assist', 'registries'] as const,
  registry: (id: string) => ['assist', 'registry', id] as const,
  rebills: ['assist', 'rebills'] as const,
  rebill: (id: string) => ['assist', 'rebill', id] as const,
  clinics: ['assist', 'clinics'] as const,
  users: ['assist', 'users'] as const,
};

function useAssistMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ak.all }) });
}

// ---------------- portal ----------------
export const useAssistOverview = () => useQuery({ queryKey: ak.overview, queryFn: () => request('/assist/overview', { schema: A.overview }) });
export const useAssistInsured = (q: string) => useQuery({ queryKey: ak.insured(q), queryFn: () => request('/assist/insured', { query: { q }, schema: A.insuredItems }) });
export const useAssistPerson = (id: string) => useQuery({ queryKey: ak.person(id), queryFn: () => request(`/assist/insured/${id}`, { schema: A.insuredDetail }), retry: false });
export const useAssistReveal = () =>
  useMutation({
    mutationFn: (v: { id: string; field: 'pinfl' | 'phone' | 'birthDate' | 'email'; reason: string }) => request(`/assist/insured/${v.id}/reveal`, { method: 'POST', body: { field: v.field, reason: v.reason }, schema: S.reveal }),
  });
export const useAssistMedicalAccess = () =>
  useMutation({ mutationFn: (v: { id: string; reason: string }) => request(`/assist/insured/${v.id}/medical-access`, { method: 'POST', body: { reason: v.reason }, schema: S.medicalGrant }) });
export const useAssistMedical = (id: string, grantId: string | null) =>
  useQuery({
    queryKey: ['assist', 'medical', id, grantId ?? ''],
    queryFn: () => request(`/assist/insured/${id}/medical`, { headers: { 'x-medical-grant': grantId ?? '' }, schema: S.medicalRecords }) as Promise<MedicalRecordEntry[]>,
    enabled: !!grantId,
    gcTime: 0,
    staleTime: 0,
  });

export const useAssistCases = (p: Record<string, string> = {}) => useQuery({ queryKey: ak.cases(p), queryFn: () => request('/assist/cases', { query: p, schema: A.caseViews }) });
export const useAssistCase = (id: string) => useQuery({ queryKey: ak.case(id), queryFn: () => request(`/assist/cases/${id}`, { schema: A.caseView }), retry: false });
export const useCreateCase = () => useAssistMutation((body: z.input<typeof caseCreateSchema>) => request('/assist/cases', { method: 'POST', body, schema: A.caseView }));
export const useUpdateCase = () =>
  useAssistMutation((v: { id: string; status: string; resolution?: string }) => request(`/assist/cases/${v.id}`, { method: 'PATCH', body: { status: v.status, resolution: v.resolution }, schema: A.caseView }));

export const useAssistAppointments = (view: 'requests' | 'all') => useQuery({ queryKey: ak.appointments(view), queryFn: () => request('/assist/appointments', { query: { view }, schema: A.assistAppointments }) });
export const useAssistBook = () =>
  useAssistMutation((body: { insuredId: string; clinicId: string; specialty: string; startsAt: string; caseId?: string }) => request('/assist/appointments', { method: 'POST', body, schema: S.appointment }));
export const useAssistRespond = () =>
  useAssistMutation((v: { id: string; kind: 'confirm' } | { id: string; kind: 'decline'; reason: string }) =>
    request(`/assist/appointments/${v.id}/${v.kind}`, { method: 'POST', body: v.kind === 'decline' ? { reason: v.reason } : undefined }),
  );

export const useAssistThreads = () => useQuery({ queryKey: ak.threads, queryFn: () => request('/assist/chat', { schema: A.chatThreads }), refetchInterval: 10_000 });
export const useAssistThread = (id: string | null) =>
  useQuery({ queryKey: ak.thread(id ?? ''), queryFn: () => request(`/assist/chat/${id}`, { schema: A.chatMessages }), enabled: !!id, refetchInterval: 5_000 });
export const useAssistSend = () => useAssistMutation((v: { id: string; text: string }) => request(`/assist/chat/${v.id}`, { method: 'POST', body: { text: v.text }, schema: A.chatMessage }));

export const useAssistGuarantees = (status = '') => useQuery({ queryKey: ak.guarantees(status), queryFn: () => request('/assist/guarantees', { query: { status }, schema: C.guaranteeViews }) });
export const useAssistGuarantee = (id: string) => useQuery({ queryKey: ak.guarantee(id), queryFn: () => request(`/assist/guarantees/${id}`, { schema: C.guaranteeView }), retry: false });
export const useAssistRequestGuarantee = () =>
  useAssistMutation((body: z.input<typeof assistGuaranteeRequestSchema>) => request('/assist/guarantees', { method: 'POST', body, schema: C.guaranteeView }));
export const useAssistDecideGuarantee = () =>
  useAssistMutation((v: { id: string; body: z.input<typeof assistGuaranteeDecisionSchema> }) => request(`/assist/guarantees/${v.id}/decision`, { method: 'POST', body: v.body, schema: C.guaranteeView }));

export const useAssistRegistries = () => useQuery({ queryKey: ak.registries, queryFn: () => request('/assist/registries', { schema: A.subRegistries }) });
export const useAssistRegistry = (id: string) => useQuery({ queryKey: ak.registry(id), queryFn: () => request(`/assist/registries/${id}`, { schema: A.subRegistry }), retry: false });
export const useAssistDecideLine = () =>
  useAssistMutation((v: { id: string; lineId: string; body: { decision: 'accept' } | { decision: 'reject'; reason: string } }) =>
    request(`/assist/registries/${v.id}/lines/${v.lineId}/decision`, { method: 'POST', body: v.body, schema: A.subRegistry }),
  );
export const useRecordPayment = () =>
  useAssistMutation((v: { id: string; lineIds: string[]; paidAt: string; amount: number; orderNumber: string }) =>
    request(`/assist/registries/${v.id}/payments`, { method: 'POST', body: { lineIds: v.lineIds, paidAt: v.paidAt, amount: v.amount, orderNumber: v.orderNumber }, schema: A.subRegistry }),
  );

export const useAssistRebills = () => useQuery({ queryKey: ak.rebills, queryFn: () => request('/assist/rebills', { schema: A.rebillSummaries }) });
export const useAssistRebill = (id: string) => useQuery({ queryKey: ak.rebill(id), queryFn: () => request(`/assist/rebills/${id}`, { schema: A.rebillView }), retry: false });
export const useBuildRebill = () => useAssistMutation((period: string) => request('/assist/rebills', { method: 'POST', body: { period }, schema: A.rebillView }));
export const useSubmitRebill = () => useAssistMutation((id: string) => request(`/assist/rebills/${id}/submit`, { method: 'POST', schema: A.rebillView }));
export const useDisputeRebillLine = () =>
  useAssistMutation((v: { id: string; lineId: string; comment: string }) => request(`/assist/rebills/${v.id}/lines/${v.lineId}/dispute`, { method: 'POST', body: { comment: v.comment }, schema: A.rebillView }));

export const useAssistClinics = () => useQuery({ queryKey: ak.clinics, queryFn: () => request('/assist/clinics', { schema: A.assistClinics }), staleTime: 5 * 60_000 });
export const useAssistUsers = () => useQuery({ queryKey: ak.users, queryFn: () => request('/assist/users', { schema: A.assistUsers }) });
export const useInviteAssistUser = () =>
  useAssistMutation((body: { email: string; fullName: string; role: string }) => request('/assist/users', { method: 'POST', body, schema: A.assistUserView }));
export const usePatchAssistUser = () =>
  useAssistMutation((v: { id: string; role?: string; active?: boolean }) => request(`/assist/users/${v.id}`, { method: 'PATCH', body: { role: v.role, active: v.active }, schema: A.assistUserView }));

// ---------------- insured app ----------------
export const useMyAssistance = () => useQuery({ queryKey: ['me', 'assistance'], queryFn: () => request('/me/assistance', { schema: A.myAssistance }), staleTime: 5 * 60_000 });

// ---------------- MIG staff ----------------
const sk = {
  all: ['staff-assistance'] as const,
  list: ['staff-assistance', 'list'] as const,
  card: (id: string) => ['staff-assistance', 'card', id] as const,
  assignments: (policyId: string) => ['staff-assistance', 'assignments', policyId] as const,
  rebills: (p: Record<string, string>) => ['staff-assistance', 'rebills', p] as const,
  rebill: (id: string) => ['staff-assistance', 'rebill', id] as const,
  qa: (p: Record<string, string>) => ['staff-assistance', 'qa', p] as const,
  report: ['staff-assistance', 'report'] as const,
};
function useStaffAssistMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sk.all });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
export const useAssistances = () => useQuery({ queryKey: sk.list, queryFn: () => request('/assistance', { schema: A.assistanceList }), staleTime: 60_000 });
export const useAssistanceCard = (id: string) => useQuery({ queryKey: sk.card(id), queryFn: () => request(`/assistance/${id}/card`, { schema: A.assistanceCard }) });
export const useAssistanceCases = (id: string, enabled: boolean) =>
  useQuery({ queryKey: ['staff-assistance', 'cases', id], queryFn: () => request(`/assistance/${id}/cases`, { schema: z.array(A.assistanceCase) }), enabled });
export const useResolveComplaint = () =>
  useStaffAssistMutation((v: { assistanceId: string; caseId: string; resolution: string }) =>
    request(`/assistance/${v.assistanceId}/cases/${v.caseId}/complaint`, { method: 'POST', body: { resolution: v.resolution }, schema: A.assistanceCase }),
  );
export const useCreateAssistance = () =>
  useStaffAssistMutation((body: z.input<typeof assistanceCreateSchema>) => request('/assistance', { method: 'POST', body, schema: A.assistanceListItem }));
export const useUpdateContract = () =>
  useStaffAssistMutation((v: { id: string; body: { feeModel: string; feeValue: number; guaranteeAuthorityLimit: number; rebillPaymentDays: number } }) =>
    request(`/assistance/${v.id}/contract`, { method: 'PATCH', body: v.body, schema: A.assistanceCompany }),
  );
export const useRevokeAssistKey = () =>
  useStaffAssistMutation((v: { assistanceId: string; keyId: string }) => request(`/assistance/${v.assistanceId}/keys/${v.keyId}/revoke`, { method: 'POST', schema: C.integrationClient }));
export const useAssignments = (policyId: string | undefined) =>
  useQuery({ queryKey: sk.assignments(policyId ?? ''), queryFn: () => request(`/policies/${policyId}/assistance`, { schema: A.assignments }), enabled: !!policyId });
export function useAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { policyId: string; assistanceId: string | null; from: string }) => request(`/policies/${v.policyId}/assistance`, { method: 'POST', body: { assistanceId: v.assistanceId, from: v.from }, schema: A.assignments }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sk.all });
      void qc.invalidateQueries({ queryKey: ['client'] });
      void qc.invalidateQueries({ queryKey: ['policy'] });
    },
  });
}
export const useStaffRebills = (p: Record<string, string>) => useQuery({ queryKey: sk.rebills(p), queryFn: () => request('/rebills', { query: p, schema: A.rebillSummaries }) });
export const useStaffRebill = (id: string) => useQuery({ queryKey: sk.rebill(id), queryFn: () => request(`/rebills/${id}`, { schema: A.rebillView }) });
export const useDecideRebillLine = () =>
  useStaffAssistMutation((v: { id: string; lineId: string; body: { decision: 'accept' } | { decision: 'reject'; reason: string } }) =>
    request(`/rebills/${v.id}/lines/${v.lineId}/decision`, { method: 'POST', body: v.body, schema: A.rebillView }),
  );
export const usePayRebill = () => useStaffAssistMutation((id: string) => request(`/rebills/${id}/pay`, { method: 'POST', schema: A.rebillView }));
export const useQaQueue = (p: Record<string, string>) => useQuery({ queryKey: sk.qa(p), queryFn: () => request('/qa', { query: p, schema: A.qaSamples }) });
export const useReviewQa = () =>
  useStaffAssistMutation((v: { id: string; verdict: 'agree' | 'disagree'; comment?: string }) => request(`/qa/${v.id}/review`, { method: 'POST', body: { verdict: v.verdict, comment: v.comment }, schema: A.qaSample }));
export const useAssistanceReport = (enabled = true) => useQuery({ queryKey: sk.report, queryFn: () => request('/reports/by-assistance', { schema: A.reportByAssistance }), enabled });
