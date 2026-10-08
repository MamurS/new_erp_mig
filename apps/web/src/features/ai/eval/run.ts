/* Golden cases (AI_COVERAGE_SPEC §4.5): text → expected codes and verdict for the demo program. */
import type { CoverageVerdictDecision, ProgramCode } from '@mig/contracts';
import { catalogItem } from '@/features/coverage/catalog';
import { COVERAGE_RULES } from '@/features/coverage/rules';
import { PROGRAMS } from '@mig/domain/programs';
import type { CoverageContext } from '@/features/coverage/engine';
import type { AiProvider } from '../provider';
import { runCoverageCheck } from '../pipeline';
import golden from './golden.json';

export interface GoldenCase {
  text: string;
  expectedCodes: string[];
  expectedDecision: CoverageVerdictDecision;
}

export interface GoldenResult {
  total: number;
  correct: number;
  accuracy: number;
  errors: { text: string; expectedCodes: string[]; gotCodes: string[]; expectedDecision: CoverageVerdictDecision; gotDecision: CoverageVerdictDecision }[];
}

export const GOLDEN = golden as { program: ProgramCode; cases: GoldenCase[] };

/** A healthy context: the policy runs, the person is covered for a long time, limits are untouched. */
export function goldenContext(program: ProgramCode, today: string): CoverageContext {
  const year = Number(today.slice(0, 4));
  return {
    program,
    policy: { id: 'golden-policy', status: 'active', startDate: `${year - 1}-01-01`, endDate: `${year + 1}-12-31` },
    insured: { id: 'golden-insured', insuredFrom: `${year - 1}-01-01`, status: 'active' },
    limits: (Object.keys(PROGRAMS[program].limits) as (keyof (typeof PROGRAMS)[ProgramCode]['limits'])[]).map((category) => ({ category, limit: PROGRAMS[program].limits[category], used: 0, reserved: 0 })),
    rules: COVERAGE_RULES,
    catalog: catalogItem,
  };
}

export async function runGolden(provider: AiProvider, threshold: number, today: string, cases: readonly GoldenCase[] = GOLDEN.cases): Promise<GoldenResult> {
  const ctx = goldenContext(GOLDEN.program, today);
  const errors: GoldenResult['errors'] = [];
  for (const c of cases) {
    const r = await runCoverageCheck({ scenario: 'insured', text: c.text, serviceDate: today }, ctx, { provider, threshold, redact: true });
    const got = r.needsSpecialist ? 'unknown' : r.verdict.decision;
    const gotCodes = r.needsSpecialist ? [] : r.matches.filter((m) => m.confidence >= threshold).map((m) => m.code);
    const ok = got === c.expectedDecision && (c.expectedCodes.length === 0 || (gotCodes[0] !== undefined && c.expectedCodes.includes(gotCodes[0])));
    if (!ok) errors.push({ text: c.text, expectedCodes: c.expectedCodes, gotCodes, expectedDecision: c.expectedDecision, gotDecision: got });
  }
  const total = cases.length;
  return { total, correct: total - errors.length, accuracy: total ? (total - errors.length) / total : 0, errors };
}
