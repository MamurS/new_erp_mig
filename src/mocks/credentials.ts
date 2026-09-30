/* Demo accounts of the mock server (SPEC §2). */
import type { StaffRole } from '@/shared/types';

export const DEMO_PASSWORD = 'Demo-2026!';
export const DEMO_CODE = '000000';

export const DEMO_STAFF: { role: StaffRole; email: string; fullName: string }[] = [
  { role: 'operator', email: 'operator@demo.mig.uz', fullName: 'Нигора Юсупова' },
  { role: 'underwriter', email: 'underwriter@demo.mig.uz', fullName: 'Дмитрий Соколов' },
  { role: 'doctor_expert', email: 'doctor@demo.mig.uz', fullName: 'Шахноза Рахимова' },
  { role: 'accountant', email: 'accountant@demo.mig.uz', fullName: 'Елена Морозова' },
  { role: 'admin', email: 'admin@demo.mig.uz', fullName: 'Тимур Алиев' },
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
