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
