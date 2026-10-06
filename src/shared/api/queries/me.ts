import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Specialty } from '@/shared/types';
import type { FamilyRequestInput } from '@/shared/schemas/forms';
import { request } from '../client';
import * as S from '../schemas';
import { qk } from './keys';

export const useMe = () => useQuery({ queryKey: qk.meProfile, queryFn: () => request('/me', { schema: S.meProfile }) });
/*
 * Family members (FAMILY_SPEC): every per-person hook takes an optional `personId` — a person of the family from
 * GET /me/family (`undefined` or the signed-in person's id: the signed-in person). The server answers 404 for
 * anyone the signed-in person may not see. Query keys end with the person, so the base keys still invalidate all.
 */
const who = (personId: string | undefined) => personId ?? 'self';
const personQuery = (personId: string | undefined) => (personId ? { personId } : undefined);

export const useMePolicy = (personId?: string) =>
  useQuery({ queryKey: [...qk.mePolicy, who(personId)], queryFn: () => request('/me/policy', { query: personQuery(personId), schema: S.mePolicy }) });
export const useMeLimits = (personId?: string) =>
  useQuery({ queryKey: [...qk.meLimits, who(personId)], queryFn: () => request('/me/limits', { query: personQuery(personId), schema: S.limitUsages }) });
export const useMyClaims = (personId?: string) =>
  useQuery({ queryKey: [...qk.meClaims, who(personId)], queryFn: () => request('/me/claims', { query: personQuery(personId), schema: S.myClaims }) });
/** A claim of the signed-in person or of a family member they may see (the id is enough). */
export const useMyClaim = (id: string | undefined) =>
  useQuery({ queryKey: qk.meClaim(id ?? ''), queryFn: () => request(`/me/claims/${id}`, { schema: S.myClaim }), enabled: !!id });
export const useMyAppointments = (personId?: string) =>
  useQuery({ queryKey: [...qk.meAppointments, who(personId)], queryFn: () => request('/me/appointments', { query: personQuery(personId), schema: S.appointments }) });

// ---- family members ----
/** Profiles of the switcher «Я / {name}»: the signed-in person first, then the family members they may see. */
export const useMyFamily = () => useQuery({ queryKey: qk.meFamily, queryFn: () => request('/me/family', { schema: S.familyProfiles }) });
/** An adult family member allows (or stops allowing) the employee to see their claims and appointments. */
export function useFamilyConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (granted: boolean) => request('/me/family/consent', { method: 'POST', body: { granted }, schema: S.familyConsentResult }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.meProfile });
      void qc.invalidateQueries({ queryKey: qk.meFamily });
    },
  });
}
/** Own card for reimbursements; null — back to the employee's card (a family member only). */
export function useSetPayoutCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (card: string | null) => request('/me/payout-card', { method: 'POST', body: { card }, schema: S.payoutCardResult }),
    // The full card number is the mutation's variable: drop it from the mutation cache at once.
    gcTime: 0,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.meProfile });
      void qc.invalidateQueries({ queryKey: qk.meClaims });
    },
  });
}
export const useMyFamilyRequests = () => useQuery({ queryKey: qk.meFamilyRequests, queryFn: () => request('/me/family/requests', { schema: S.familyRequests }) });
/** The employee asks HR to add a family member (with the member's consent confirmed). */
export function useRequestFamilyMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FamilyRequestInput) => request('/me/family/requests', { method: 'POST', body, schema: S.familyRequest }),
    // The variables carry the PINFL and the date of birth: do not keep them in the mutation cache.
    gcTime: 0,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.meFamilyRequests }),
  });
}
export const useNearbyClinics = (specialty: Specialty | '') =>
  useQuery({
    queryKey: qk.nearby(specialty),
    queryFn: () => request('/clinics/nearby', { query: { specialty }, schema: S.clinics }),
  });
export const useChat = () =>
  useQuery({ queryKey: qk.chat, queryFn: () => request('/me/chat', { schema: S.chatMessages }), refetchInterval: 2000 });

/** One-time QR token of a person (the signed-in one or a family member); never cached beyond its 60-second life. */
export const useCardToken = (personId?: string) =>
  useQuery({
    queryKey: [...qk.cardToken, who(personId)],
    queryFn: () => request('/me/card-token', { query: personQuery(personId), schema: S.cardToken }),
    refetchInterval: 60_000,
    gcTime: 0,
    staleTime: 55_000,
  });

export function useConsent() {
  return useMutation({
    mutationFn: (version: string) => request('/me/consent', { method: 'POST', body: { version }, schema: S.consentResult }),
  });
}

export function useRecognize() {
  return useMutation({
    mutationFn: (file: Blob) => {
      const fd = new FormData();
      fd.append('file', file, 'receipt.jpg');
      return request('/me/claims/recognize', { method: 'POST', body: fd, schema: S.recognizeResult });
    },
  });
}

export function useSubmitClaim() {
  const qc = useQueryClient();
  return useMutation({
    /** `personId`: a receipt for a family member (paid to the employee's card unless the member set an own one). */
    mutationFn: (v: { files: Blob[]; category: string; amount: number; serviceDate: string; providerName: string; personId?: string }) => {
      const fd = new FormData();
      v.files.forEach((f, i) => fd.append('files', f, `receipt-${i + 1}.jpg`));
      fd.append('category', v.category);
      fd.append('amount', String(v.amount));
      fd.append('serviceDate', v.serviceDate);
      fd.append('providerName', v.providerName);
      return request('/me/claims', { method: 'POST', body: fd, query: personQuery(v.personId), schema: S.myClaim });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.meClaims });
      void qc.invalidateQueries({ queryKey: qk.meLimits });
    },
  });
}

export function useBookAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ personId, ...body }: { clinicId: string; specialty: Specialty; startsAt: string; personId?: string }) =>
      request('/me/appointments', { method: 'POST', body, query: personQuery(personId), schema: S.appointment }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.meAppointments });
      void qc.invalidateQueries({ queryKey: ['clinics'] });
    },
  });
}

export function useCancelMyAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/me/appointments/${id}/cancel`, { method: 'POST', schema: S.appointment }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.meAppointments }),
  });
}

export function useAcceptProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/me/appointments/${id}/accept-proposal`, { method: 'POST', schema: S.appointment }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.meAppointments }),
  });
}

export function useSendChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => request('/me/chat', { method: 'POST', body: { text }, schema: S.chatMessage }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.chat }),
  });
}
