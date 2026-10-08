import type { Money, ProgramCode } from '@mig/contracts';
import { int, type Rng } from './rng';

export { PROGRAMS } from '@mig/domain/programs';

/** Annual premium per person, 2–8 million UZS depending on the program. */
export function perPersonPremium(code: ProgramCode, rng: Rng): Money {
  const ranges: Record<ProgramCode, [number, number]> = {
    basic: [2000, 3000],
    standard: [3000, 4500],
    standard_plus: [4500, 6000],
    premium: [6000, 8000],
  };
  const [a, b] = ranges[code];
  return int(rng, a, b) * 1000;
}
