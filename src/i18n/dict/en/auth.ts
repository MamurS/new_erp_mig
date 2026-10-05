import type { auth as Ru } from '../ru/auth';
import type { Translation } from '../types';

export const auth: Translation<typeof Ru> = {
  'auth.card.tagline': 'VHI · staff and client portal',
  'auth.login.title': 'Sign in',
  'auth.login.subtitle': 'For MIG staff and client company HR',
  'auth.login.password': 'Password',
  'auth.login.submit': 'Sign in',
  'auth.otp.docTitle': 'Verification code',
  'auth.otp.title': 'Second factor',
  'auth.otp.subtitle': 'Enter the 6-digit code from your authenticator app or SMS',
  'auth.otp.footer': 'Sign-in is protected by MFA. All sign-ins are recorded in the audit log.',
  'auth.otp.resendIn': 'Resend the code in {n} s',
  'auth.otp.resend': 'Resend the code',
  'auth.otp.resent': 'The code has been resent',
  'auth.notice.otherTab': 'You signed out in another tab',
  'auth.notice.idle': 'The session ended due to inactivity. Sign in again',
  'auth.idle.title': 'Are you still here?',
  'auth.idle.description': 'The session will end soon due to inactivity. Unsaved data will be lost.',
  'auth.idle.stay': 'Continue working',
};
