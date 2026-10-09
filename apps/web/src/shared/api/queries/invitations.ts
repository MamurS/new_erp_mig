/* Invitations of e-mail accounts: the page of the link (no session) and «Отправить повторно» in the user lists. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { invitationAcceptSchema } from '@mig/contracts/forms';
import * as S from '@mig/contracts/schemas';
import { request } from '../client';
import { qk } from './keys';

export function useInvitationCheck() {
  return useMutation({
    mutationFn: (token: string) => request('/auth/invitation', { method: 'POST', body: { token }, schema: S.invitationCheck }),
  });
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: (v: z.input<typeof invitationAcceptSchema>) => request('/auth/invitation/accept', { method: 'POST', body: v }),
  });
}

/** Open invitations of every portal (the MIG administrator). */
export const useInvitations = (enabled = true) =>
  useQuery({ queryKey: qk.invitations, queryFn: () => request('/invitations', { schema: S.invitationList }), enabled });

export function useResendInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => request(`/invitations/${userId}/resend`, { method: 'POST', schema: S.invitationBrief }),
    // The status shows in several lists (MIG users, a clinic's or an assistance's users, their cards).
    onSuccess: () => void qc.invalidateQueries(),
  });
}
