/* Insurance programs and their limits (SPEC §5), shared by the UI and the mock server. */
import type { LimitCategory, Money, Program, ProgramCode } from '@/shared/types';
import { PROGRAM_LABEL } from './labels';

const BASE: Record<LimitCategory, Money> = {
  outpatient: 15_000_000,
  dental: 3_000_000,
  medicines: 5_000_000,
  inpatient: 40_000_000,
};
const FACTOR: Record<ProgramCode, number> = { basic: 0.4, standard: 0.7, standard_plus: 1, premium: 2 };

function scale(code: ProgramCode): Record<LimitCategory, Money> {
  const f = FACTOR[code];
  return {
    outpatient: Math.round((BASE.outpatient * f) / 100_000) * 100_000,
    dental: Math.round((BASE.dental * f) / 100_000) * 100_000,
    medicines: Math.round((BASE.medicines * f) / 100_000) * 100_000,
    inpatient: Math.round((BASE.inpatient * f) / 100_000) * 100_000,
  };
}

/** `name` is read in the current language (labels.program.*). */
function program(code: ProgramCode): Program {
  return {
    code,
    get name() {
      return PROGRAM_LABEL[code];
    },
    limits: scale(code),
  };
}

export const PROGRAMS: Record<ProgramCode, Program> = {
  basic: program('basic'),
  standard: program('standard'),
  standard_plus: program('standard_plus'),
  premium: program('premium'),
};
