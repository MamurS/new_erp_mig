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
  'auth.totp.title': 'Set up the second factor',
  'auth.totp.subtitle': 'First sign-in: your account is protected by a code from an authenticator app',
  'auth.totp.step1': '1. Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator or another).',
  'auth.totp.manual': 'Cannot scan it? Enter the key manually',
  'auth.totp.step2': '2. Enter the 6-digit code the app shows.',
  'auth.totp.qrAlt': 'QR code for the authenticator app',
  'auth.notice.otherTab': 'You signed out in another tab',
  'auth.notice.idle': 'The session ended due to inactivity. Sign in again',
  'auth.idle.title': 'Are you still here?',
  'auth.idle.description': 'The session will end soon due to inactivity. Unsaved data will be lost.',
  'auth.idle.stay': 'Continue working',
};
