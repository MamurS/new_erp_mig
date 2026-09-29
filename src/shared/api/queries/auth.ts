import { useMutation } from '@tanstack/react-query';
import { request } from '../client';
import * as S from '../schemas';

export function useLogin() {
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      request('/auth/login', { method: 'POST', body, schema: S.challenge }),
  });
}

export function useOtp() {
  return useMutation({
    mutationFn: (body: { challengeId: string; code: string }) =>
      request('/auth/otp', { method: 'POST', body, schema: S.sessionResponse }),
  });
}

export function useResend() {
  return useMutation({
    mutationFn: (body: { challengeId: string }) => request('/auth/resend', { method: 'POST', body, schema: S.challenge }),
  });
}

export function usePhoneLogin() {
  return useMutation({
    mutationFn: (body: { phone: string }) => request('/auth/phone', { method: 'POST', body, schema: S.challenge }),
  });
}

export function usePhoneVerify() {
  return useMutation({
    mutationFn: (body: { challengeId: string; code: string }) =>
      request('/auth/phone/verify', { method: 'POST', body, schema: S.sessionResponse }),
  });
}
