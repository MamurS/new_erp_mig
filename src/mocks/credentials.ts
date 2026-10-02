/* Demo accounts of the mock server (SPEC §2). */
import type { StaffAuthority, StaffRole } from '@/shared/types';

export const DEMO_PASSWORD = 'Demo-2026!';
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
  { role: 'operator', email: 'operator@demo.mig.uz', fullName: 'Нигора Юсупова' },
  { role: 'underwriter', email: 'underwriter@demo.mig.uz', fullName: 'Дмитрий Соколов', authority: { quoteDiscountMaxPct: 0.1, quotePremiumMax: 5_000_000_000 } },
  { role: 'doctor_expert', email: 'doctor@demo.mig.uz', fullName: 'Шахноза Рахимова' },
  { role: 'accountant', email: 'accountant@demo.mig.uz', fullName: 'Елена Морозова' },
  { role: 'admin', email: 'admin@demo.mig.uz', fullName: 'Тимур Алиев' },
  // The second person of four-eyes on staff authority (LIFECYCLE_SPEC §14: «только admin + второй»).
  { role: 'admin', email: 'admin2@demo.mig.uz', fullName: 'Сардор Назаров', label: 'Администратор (второй)' },
  // LIFECYCLE_SPEC §2
  { role: 'sales_manager', email: 'sales@demo.mig.uz', fullName: 'Азиз Каримов' },
  { role: 'legal', email: 'legal@demo.mig.uz', fullName: 'Наталья Ким' },
  { role: 'claims_officer', email: 'claims@demo.mig.uz', fullName: 'Бобур Хасанов', authority: { claimDecisionMax: 5_000_000 } },
  {
    role: 'claims_officer',
    email: 'claims-head@demo.mig.uz',
    fullName: 'Лола Саидова',
    label: 'Руководитель урегулирования убытков',
    authority: { claimDecisionMax: 50_000_000 },
  },
  {
    role: 'underwriter',
    email: 'underwriter-head@demo.mig.uz',
    fullName: 'Рустам Иргашев',
    label: 'Руководитель андеррайтинга',
    authority: { quoteDiscountMaxPct: 0.25 },
    signatory: { canSign: true, basis: 'Доверенность № 14 от 05.01.2026' },
  },
];
export const DEMO_HR = { email: 'hr@demo-client.uz', fullName: 'Малика Турсунова' };
export const DEMO_INSURED_PHONE = '+998900000001';
export const DEMO_CLINIC_USERS: { role: 'clinic_registrar' | 'clinic_admin'; email: string; fullName: string }[] = [
  { role: 'clinic_registrar', email: 'registrar@demo-clinic.uz', fullName: 'Гульнора Ахмедова' },
  { role: 'clinic_admin', email: 'admin@demo-clinic.uz', fullName: 'Бахтиёр Каримов' },
];
/** Users of the first assistance company (ASSISTANCE_SPEC §12). */
export const DEMO_ASSIST_USERS: { role: 'asst_operator' | 'asst_doctor' | 'asst_billing' | 'asst_admin'; email: string; fullName: string }[] = [
  { role: 'asst_operator', email: 'asst-operator@demo-assist.uz', fullName: 'Севара Исмоилова' },
  { role: 'asst_doctor', email: 'asst-doctor@demo-assist.uz', fullName: 'Жасур Мирзаев' },
  { role: 'asst_billing', email: 'asst-billing@demo-assist.uz', fullName: 'Ольга Ким' },
  { role: 'asst_admin', email: 'asst-admin@demo-assist.uz', fullName: 'Рустам Назаров' },
];
/** Operator of the second assistance company: isolation checks (ASSISTANCE_SPEC §14, e2e 6). */
export const DEMO_ASSIST2_OPERATOR = { role: 'asst_operator' as const, email: 'asst-operator@demo-assist2.uz', fullName: 'Азиза Хамидова' };
