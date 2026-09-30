/* Insurance programs and their limits (SPEC §5), shared by the UI and the mock server. */
import type { LimitCategory, Money, Program, ProgramCode } from '@/shared/types';

const BASE: Record<LimitCategory, Money> = {
  outpatient: 15_000_000,
  dental: 3_000_000,
  medicines: 5_000_000,
  inpatient: 40_000_000,
};
const FACTOR: Record<ProgramCode, number> = { basic: 0.4, standard: 0.7, standard_plus: 1, premium: 2 };
const NAME: Record<ProgramCode, string> = {
  basic: 'Базовая',
  standard: 'Стандарт',
  standard_plus: 'Стандарт+',
  premium: 'Премиум',
};

function scale(code: ProgramCode): Record<LimitCategory, Money> {
  const f = FACTOR[code];
  return {
    outpatient: Math.round((BASE.outpatient * f) / 100_000) * 100_000,
    dental: Math.round((BASE.dental * f) / 100_000) * 100_000,
    medicines: Math.round((BASE.medicines * f) / 100_000) * 100_000,
    inpatient: Math.round((BASE.inpatient * f) / 100_000) * 100_000,
  };
}

export const PROGRAMS: Record<ProgramCode, Program> = {
  basic: { code: 'basic', name: NAME.basic, limits: scale('basic') },
  standard: { code: 'standard', name: NAME.standard, limits: scale('standard') },
  standard_plus: { code: 'standard_plus', name: NAME.standard_plus, limits: scale('standard_plus') },
  premium: { code: 'premium', name: NAME.premium, limits: scale('premium') },
};
