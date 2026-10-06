/* Queries of the contract lifecycle and claims settlement (LIFECYCLE_SPEC). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { authorityChangeSchema, changeRequestCreateSchema, claimDecideSchema, contractPatchSchema, leadCreateSchema, quoteAdjustmentSchema } from '@/shared/schemas/forms';
import type { ProgramCode } from '@/shared/types';
import { request } from '../client';
import * as S from '../schemas';
import * as L from '../schemas-lifecycle';

const lk = {
  all: ['lifecycle'] as const,
  deals: (p: Record<string, string>) => ['lifecycle', 'deals', p] as const,
  deal: (id: string) => ['lifecycle', 'deal', id] as const,
  quote: (id: string) => ['lifecycle', 'quote', id] as const,
  contracts: (p: Record<string, string>) => ['lifecycle', 'contracts', p] as const,
  contract: (id: string) => ['lifecycle', 'contract', id] as const,
  endorsements: (p: Record<string, string>) => ['lifecycle', 'endorsements', p] as const,
  endorsement: (id: string) => ['lifecycle', 'endorsement', id] as const,
  changeRequests: (p: Record<string, string>) => ['lifecycle', 'change-requests', p] as const,
  invoices: (p: Record<string, string>) => ['lifecycle', 'invoices', p] as const,
  paymentQueue: (status: string, p: Record<string, string> = {}) => ['lifecycle', 'payment-queue', status, p] as const,
  certificates: (policyId: string) => ['lifecycle', 'certificates', policyId] as const,
  myCertificate: ['lifecycle', 'me', 'certificate'] as const,
  directory: ['lifecycle', 'directory'] as const,
  authority: ['lifecycle', 'authority'] as const,
  reserves: (date: string) => ['lifecycle', 'reserves', date] as const,
};

/** Every lifecycle change may move a deal, a contract, invoices and the dashboard at once. */
function useLifecycleMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: lk.all });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['claims'] });
      void qc.invalidateQueries({ queryKey: ['claim'] });
      void qc.invalidateQueries({ queryKey: ['hr'] });
      void qc.invalidateQueries({ queryKey: ['kp'] });
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

// ---------------- staff directory and authority ----------------
export const useStaffDirectory = () => useQuery({ queryKey: lk.directory, queryFn: () => request('/staff/directory', { schema: L.staffDirectory }), staleTime: 60_000 });
export const useAuthorityChanges = (enabled = true) => useQuery({ queryKey: lk.authority, queryFn: () => request('/admin/authority-changes', { schema: L.authorityChanges }), enabled });
export const useProposeAuthority = () =>
  useLifecycleMutation((v: { staffId: string; body: z.input<typeof authorityChangeSchema> }) => request(`/admin/users/${v.staffId}/authority`, { method: 'POST', body: v.body, schema: L.authorityChange }));
export const useDecideAuthority = () =>
  useLifecycleMutation((v: { id: string; decision: 'approve' | 'reject'; reason?: string }) =>
    request(`/admin/authority-changes/${v.id}/${v.decision}`, { method: 'POST', body: v.decision === 'reject' ? { reason: v.reason } : undefined, schema: L.authorityChange }),
  );

// ---------------- deals ----------------
export const useDeals = (p: Record<string, string> = {}) => useQuery({ queryKey: lk.deals(p), queryFn: () => request('/deals', { query: p, schema: L.dealViews }) });
export const useDeal = (id: string) => useQuery({ queryKey: lk.deal(id), queryFn: () => request(`/deals/${id}`, { schema: L.dealCard }) });
export const useCreateLead = () => useLifecycleMutation((v: z.input<typeof leadCreateSchema>) => request('/leads', { method: 'POST', body: v, schema: L.dealView }));
export const useDealLost = () => useLifecycleMutation((v: { id: string; reason: string }) => request(`/deals/${v.id}/stage`, { method: 'POST', body: { reason: v.reason }, schema: L.dealCard }));
export const usePatchDeal = () =>
  useLifecycleMutation((v: { id: string; expectedStart?: string; underwriterId?: string }) => request(`/deals/${v.id}`, { method: 'PATCH', body: { expectedStart: v.expectedStart, underwriterId: v.underwriterId }, schema: L.dealCard }));
export const useUploadCensus = () =>
  useLifecycleMutation((v: { dealId: string; csv: string }) => request(`/deals/${v.dealId}/census`, { method: 'POST', body: v.csv, headers: { 'Content-Type': 'text/csv' }, schema: L.censusUpload }));
export const useSendDealKp = () => useLifecycleMutation((dealId: string) => request(`/deals/${dealId}/kp`, { method: 'POST', schema: S.kpDocument }));
export const useKpRespond = () =>
  useLifecycleMutation((v: { kpId: string; decision: 'accept' | 'decline'; reason?: string }) =>
    request(`/kp/${v.kpId}/${v.decision}`, { method: 'POST', body: v.decision === 'decline' ? { reason: v.reason } : undefined, schema: S.kpDocument }),
  );

// ---------------- quotes ----------------
type Adjustment = z.input<typeof quoteAdjustmentSchema>;
export const useQuote = (id: string) => useQuery({ queryKey: lk.quote(id), queryFn: () => request(`/quotes/${id}`, { schema: L.quoteView }) });
export const useCreateQuote = () =>
  useLifecycleMutation((v: { dealId: string; program: ProgramCode; adjustments: Adjustment[] }) => request('/quotes', { method: 'POST', body: v, schema: L.quoteView }));
export const useSaveQuote = () =>
  useLifecycleMutation((v: { id: string; program: ProgramCode; adjustments: Adjustment[] }) => request(`/quotes/${v.id}`, { method: 'PATCH', body: { program: v.program, adjustments: v.adjustments }, schema: L.quoteView }));
export const useQuoteAction = () =>
  useLifecycleMutation((v: { id: string; action: 'submit' | 'approve' | 'reject'; comment?: string; reason?: string }) =>
    request(`/quotes/${v.id}/${v.action}`, { method: 'POST', body: v.action === 'approve' ? { comment: v.comment } : v.action === 'reject' ? { reason: v.reason } : undefined, schema: L.quoteView }),
  );

// ---------------- contracts and endorsements ----------------
export const useContracts = (p: Record<string, string> = {}, enabled = true) =>
  useQuery({ queryKey: lk.contracts(p), queryFn: () => request('/contracts', { query: p, schema: L.contractViews }), enabled });
export const useContract = (id: string, opts: { poll?: boolean } = {}) =>
  useQuery({ queryKey: lk.contract(id), queryFn: () => request(`/contracts/${id}`, { schema: L.contractView }), refetchInterval: opts.poll ? 1500 : false });
export const useCreateContract = () => useLifecycleMutation((dealId: string) => request('/contracts', { method: 'POST', body: { dealId }, schema: L.contractView }));
export const usePatchContract = () =>
  useLifecycleMutation((v: { id: string; body: z.input<typeof contractPatchSchema> }) => request(`/contracts/${v.id}`, { method: 'PATCH', body: v.body, schema: L.contractView }));
export const useContractAction = () =>
  useLifecycleMutation((v: { id: string; action: 'finance-approve' | 'new-version' }) => request(`/contracts/${v.id}/${v.action}`, { method: 'POST', schema: L.contractView }));
export const useUploadInsuredList = () =>
  useLifecycleMutation((v: { id: string; csv: string }) => request(`/contracts/${v.id}/insured-list`, { method: 'POST', body: v.csv, headers: { 'Content-Type': 'text/csv' }, schema: L.contractView }));
export const useTerminate = () =>
  useLifecycleMutation((v: { id: string; date: string; reason: string }) => request(`/contracts/${v.id}/terminate`, { method: 'POST', body: { date: v.date, reason: v.reason }, schema: L.endorsementView }));

export type DocKind = 'contracts' | 'endorsements';
/** Approval and signing steps shared by contracts and endorsements. The response is the document view. */
export const useDocStep = () =>
  useLifecycleMutation(
    (v: { kind: DocKind; id: string; step: 'submit-legal' | 'legal-approve' | 'legal-return' | 'send' | 'sign' | 'edo' | 'scan/verify' | 'originals' | 'scan'; body?: unknown }) =>
      request(`/${v.kind}/${v.id}/${v.step}`, { method: 'POST', body: v.body }),
  );

export const useEndorsements = (p: Record<string, string> = {}, enabled = true) =>
  useQuery({ queryKey: lk.endorsements(p), queryFn: () => request('/endorsements', { query: p, schema: L.endorsementViews }), enabled });
export const useEndorsement = (id: string, opts: { poll?: boolean } = {}) =>
  useQuery({ queryKey: lk.endorsement(id), queryFn: () => request(`/endorsements/${id}`, { schema: L.endorsementView }), refetchInterval: opts.poll ? 1500 : false });
export const useCreateEndorsements = () =>
  useLifecycleMutation((v: { contractId: string; changeRequestIds?: string[] }) => request('/endorsements', { method: 'POST', body: v, schema: L.endorsementViews }));
export const usePatchEndorsement = () =>
  useLifecycleMutation((v: { id: string; clauseOverrides: { clauseId: string; text: string }[] }) => request(`/endorsements/${v.id}`, { method: 'PATCH', body: { clauseOverrides: v.clauseOverrides }, schema: L.endorsementView }));
export const useApproveEndorsementAmounts = () => useLifecycleMutation((id: string) => request(`/endorsements/${id}/approve-amounts`, { method: 'POST', schema: L.endorsementView }));
export const useChangeRequests = (p: Record<string, string> = {}, enabled = true) =>
  useQuery({ queryKey: lk.changeRequests(p), queryFn: () => request('/change-requests', { query: p, schema: L.changeRequestViews }), enabled });
export const useCreateChangeRequest = () => useLifecycleMutation((v: z.input<typeof changeRequestCreateSchema>) => request('/change-requests', { method: 'POST', body: v }));

// ---------------- invoices, payments, certificates ----------------
export const useInvoices = (p: Record<string, string> = {}) => useQuery({ queryKey: lk.invoices(p), queryFn: () => request('/invoices', { query: p, schema: L.invoiceViews }) });
export const useRecordPayment = () =>
  useLifecycleMutation((v: { invoiceId: string; amount: number; paidAt: string; purpose?: string }) => request('/payments', { method: 'POST', body: v, schema: L.paymentResult }));
export const usePaymentQueue = (status: 'pending' | 'allocated' = 'pending', p: Record<string, string> = {}) =>
  useQuery({ queryKey: lk.paymentQueue(status, p), queryFn: () => request('/payments/queue', { query: { ...p, status }, schema: L.bankPaymentViews }) });
export const useAllocatePayment = () =>
  useLifecycleMutation((v: { id: string; lines: { invoiceId: string; amount: number }[]; comment?: string }) =>
    request(`/payments/queue/${v.id}/allocate`, { method: 'POST', body: { lines: v.lines, comment: v.comment }, schema: L.bankPaymentView }),
  );
export const useImport1c = () => useLifecycleMutation((csv: string) => request('/payments/import-1c', { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' }, schema: L.importResult }));
export const useCertificates = (policyId: string | undefined) =>
  useQuery({ queryKey: lk.certificates(policyId ?? ''), queryFn: () => request(`/policies/${policyId}/certificates`, { schema: L.certificates }), enabled: !!policyId });
/** Certificate of the signed-in person or of a family member (`personId`, FAMILY_SPEC). */
export const useMyCertificate = (personId?: string) =>
  useQuery({ queryKey: [...lk.myCertificate, personId ?? 'self'], queryFn: () => request('/me/certificate', { query: personId ? { personId } : undefined, schema: L.certificateView.nullable() }), retry: false });

// ---------------- claims settlement ----------------
export function useSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { claimId: string; step: string; method?: 'POST' | 'PATCH'; body?: unknown }) => request(`/claims/${v.claimId}/${v.step}`, { method: v.method ?? 'POST', body: v.body, schema: S.claimDetail }),
    onSuccess: (data) => {
      qc.setQueryData(['claim', data.id], data);
      void qc.invalidateQueries({ queryKey: ['claims'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
    },
  });
}
export type DecideBody = z.input<typeof claimDecideSchema>;
export const useClaimLetter = (claimId: string, enabled: boolean) =>
  useQuery({ queryKey: ['claim', claimId, 'letter'], queryFn: () => request(`/claims/${claimId}/letter`, { schema: L.claimLetter }), enabled });
export const useMyClaimLetter = (claimId: string, enabled: boolean) =>
  useQuery({ queryKey: ['me', 'claim', claimId, 'letter'], queryFn: () => request(`/me/claims/${claimId}/letter`, { schema: L.claimLetter }), enabled });
export function useAppeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { claimId: string; text: string }) => request(`/me/claims/${v.claimId}/appeal`, { method: 'POST', body: { text: v.text } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
}
export const useReserveReport = (date: string) => useQuery({ queryKey: lk.reserves(date), queryFn: () => request('/reports/reserves', { query: { date }, schema: L.reserveReport }) });
/** Claims register CSV (no PINFL and phones; cells escaped by the server). */
export const fetchClaimsRegister = async (from?: string): Promise<string> => (await request('/reports/claims-register', { query: from ? { from } : {}, as: 'text' })) as string;
