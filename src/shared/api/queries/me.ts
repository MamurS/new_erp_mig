import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Specialty } from '@/shared/types';
import { request } from '../client';
import * as S from '../schemas';
import { qk } from './keys';

export const useMe = () => useQuery({ queryKey: qk.meProfile, queryFn: () => request('/me', { schema: S.meProfile }) });
export const useMePolicy = () => useQuery({ queryKey: qk.mePolicy, queryFn: () => request('/me/policy', { schema: S.mePolicy }) });
export const useMeLimits = () => useQuery({ queryKey: qk.meLimits, queryFn: () => request('/me/limits', { schema: S.limitUsages }) });
export const useMyClaims = () => useQuery({ queryKey: qk.meClaims, queryFn: () => request('/me/claims', { schema: S.myClaims }) });
export const useMyClaim = (id: string | undefined) =>
  useQuery({ queryKey: qk.meClaim(id ?? ''), queryFn: () => request(`/me/claims/${id}`, { schema: S.myClaim }), enabled: !!id });
export const useMyAppointments = () =>
  useQuery({ queryKey: qk.meAppointments, queryFn: () => request('/me/appointments', { schema: S.appointments }) });
export const useNearbyClinics = (specialty: Specialty | '') =>
  useQuery({
    queryKey: qk.nearby(specialty),
    queryFn: () => request('/clinics/nearby', { query: { specialty }, schema: S.clinics }),
  });
export const useChat = () =>
  useQuery({ queryKey: qk.chat, queryFn: () => request('/me/chat', { schema: S.chatMessages }), refetchInterval: 2000 });

/** One-time QR token; never cached beyond its 60-second life. */
export const useCardToken = () =>
  useQuery({
    queryKey: qk.cardToken,
    queryFn: () => request('/me/card-token', { schema: S.cardToken }),
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
    mutationFn: (v: { files: Blob[]; category: string; amount: number; serviceDate: string; providerName: string }) => {
      const fd = new FormData();
      v.files.forEach((f, i) => fd.append('files', f, `receipt-${i + 1}.jpg`));
      fd.append('category', v.category);
      fd.append('amount', String(v.amount));
      fd.append('serviceDate', v.serviceDate);
      fd.append('providerName', v.providerName);
      return request('/me/claims', { method: 'POST', body: fd, schema: S.myClaim });
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
    mutationFn: (body: { clinicId: string; specialty: Specialty; startsAt: string }) =>
      request('/me/appointments', { method: 'POST', body, schema: S.appointment }),
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
