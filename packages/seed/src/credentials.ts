/* Demo accounts of the mock server (SPEC §2). */
import type { StaffAuthority, StaffRole } from '@mig/contracts';
import { DEMO_PASSWORD, DEMO_UNDERWRITER_NAME } from '@mig/domain/config/demoCredentials';

export { DEMO_PASSWORD };
export const DEMO_CODE = '000000';

export interface DemoStaff {
  role: StaffRole;
  email: string;
  fullName: string;
  /** Shown in «Войти как…» when one role has several demo accounts. */
  label?: string;
  authority?: StaffAuthority;
  signatory?: { canSign: true; basis: string };
}

export const DEMO_STAFF: DemoStaff[] = [
  { role: 'operator', email: 'operator@demo.mig.uz', fullName: 'Yusupova Nigora Alisherovna' },
  { role: 'underwriter', email: 'underwriter@demo.mig.uz', fullName: DEMO_UNDERWRITER_NAME, authority: { quoteDiscountMaxPct: 0.1, quotePremiumMax: 5_000_000_000 } },
  { role: 'doctor_expert', email: 'doctor@demo.mig.uz', fullName: 'Rahimova Shahnoza Bahromovna' },
  { role: 'accountant', email: 'accountant@demo.mig.uz', fullName: 'Morozova Elena Sergeyevna' },
  { role: 'admin', email: 'admin@demo.mig.uz', fullName: 'Aliyev Temur Farhodovich' },
  // The second person of four-eyes on staff authority (LIFECYCLE_SPEC §14: «только admin + второй»).
  { role: 'admin', email: 'admin2@demo.mig.uz', fullName: 'Nazarov Sardor Ravshanovich', label: 'Второй администратор' },
  // LIFECYCLE_SPEC §2
  { role: 'sales_manager', email: 'sales@demo.mig.uz', fullName: 'Karimov Aziz Shuhratovich' },
  { role: 'legal', email: 'legal@demo.mig.uz', fullName: 'Kim Natalya Viktorovna' },
  { role: 'claims_officer', email: 'claims@demo.mig.uz', fullName: 'Hasanov Bobur Ilhomovich', authority: { claimDecisionMax: 5_000_000 } },
  {
    role: 'claims_officer',
    email: 'claims-head@demo.mig.uz',
    fullName: 'Saidova Lola Akmalovna',
    label: 'Руководитель урегулирования убытков',
    authority: { claimDecisionMax: 50_000_000 },
  },
  {
    role: 'underwriter',
    email: 'underwriter-head@demo.mig.uz',
    fullName: 'Irgashev Rustam Nodirovich',
    label: 'Руководитель андеррайтинга',
    authority: { quoteDiscountMaxPct: 0.25, allowBelowMinGroup: true },
    signatory: { canSign: true, basis: 'Доверенность № 14 от 05.01.2026' },
  },
];
export const DEMO_HR = { email: 'hr@demo-client.uz', fullName: 'Tursunova Malika Zafarovna' };
export const DEMO_INSURED_PHONE = '+998900000001';
/** The demo insured person's spouse: an adult family member with an own login (FAMILY_SPEC). */
export const DEMO_SPOUSE_PHONE = '+998900000002';
export const DEMO_CLINIC_USERS: { role: 'clinic_registrar' | 'clinic_admin'; email: string; fullName: string }[] = [
  { role: 'clinic_registrar', email: 'registrar@demo-clinic.uz', fullName: 'Ahmedova Gulnora Xurshidovna' },
  { role: 'clinic_admin', email: 'admin@demo-clinic.uz', fullName: 'Karimov Baxtiyor Alisherovich' },
];
/** Users of the first assistance company (ASSISTANCE_SPEC §12). */
export const DEMO_ASSIST_USERS: { role: 'asst_operator' | 'asst_doctor' | 'asst_billing' | 'asst_admin'; email: string; fullName: string }[] = [
  { role: 'asst_operator', email: 'asst-operator@demo-assist.uz', fullName: 'Ismoilova Sevara Farhodovna' },
  { role: 'asst_doctor', email: 'asst-doctor@demo-assist.uz', fullName: 'Mirzayev Jasur Bahromovich' },
  { role: 'asst_billing', email: 'asst-billing@demo-assist.uz', fullName: 'Kim Olga Nikolayevna' },
  { role: 'asst_admin', email: 'asst-admin@demo-assist.uz', fullName: 'Nazarov Rustam Ilhomovich' },
];
/** Operator of the second assistance company: isolation checks (ASSISTANCE_SPEC §14, e2e 6). */
export const DEMO_ASSIST2_OPERATOR = { role: 'asst_operator' as const, email: 'asst-operator@demo-assist2.uz', fullName: 'Hamidova Aziza Shuhratovna' };
