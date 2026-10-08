/*
 * Coverage table by program (AI_COVERAGE_SPEC §3.1). Clauses refer to the stub templates (program and
 * contract), so they are conditional until MIG gives the texts. Exclusions are DEMO values.
 */
import type { CoverageRule, ProgramCode, ServiceGroup } from '@mig/contracts';

const PROGRAMS: ProgramCode[] = ['basic', 'standard', 'standard_plus', 'premium'];
const RICH = new Set<ProgramCode>(['standard_plus', 'premium']);

/** Physiotherapy and massage: a sub-limit inside the outpatient limit. */
const PHYSIO_SUBLIMIT: Record<ProgramCode, number> = { basic: 0, standard: 1_500_000, standard_plus: 3_000_000, premium: 6_000_000 };
/** Waiting periods, days from the start of the insured person's coverage. */
const DENTAL_WAITING_DAYS = 30;
const MATERNITY_WAITING_DAYS = 280;

function rulesFor(p: ProgramCode): CoverageRule[] {
  const g = (category: ServiceGroup, decision: CoverageRule['decision'], clauseIds: string[], extra: Partial<CoverageRule> = {}): CoverageRule => ({ program: p, category, decision, clauseIds, ...extra });
  return [
    g('consultation', 'covered', ['program:1.1']),
    g('ambulance', 'covered', ['program:5.4']),
    g('procedure', 'covered', ['program:1.3']),
    p === 'basic' ? g('physio', 'excluded', ['program:1.4']) : g('physio', 'covered', ['program:1.4', 'contract:4.6'], { subLimit: PHYSIO_SUBLIMIT[p] }),
    g('lab', 'covered', ['program:2.1']),
    g('diagnostics', 'covered', ['program:2.2']),
    g('hightech', 'needs_guarantee', ['program:2.3', 'contract:4.5']),
    g('vaccination', RICH.has(p) ? 'covered' : 'excluded', ['program:3.3']),
    g('checkup', 'excluded', ['program:6.5', 'contract:4.3']),
    g('dental_treatment', 'covered', ['program:4.1', 'program:4.3'], RICH.has(p) ? {} : { waitingDays: DENTAL_WAITING_DAYS }),
    g('dental_hygiene', RICH.has(p) ? 'covered' : 'excluded', ['program:4.2']),
    g('dental_prosthetics', 'excluded', ['program:6.4', 'contract:4.3']),
    g('rx_drug', 'covered', ['program:3.1']),
    g('otc_drug', 'covered', ['program:3.2']),
    g('vitamins', 'excluded', ['program:6.2', 'contract:4.3']),
    g('supplements', 'excluded', ['program:6.2', 'contract:4.3']),
    g('cosmetics', 'excluded', ['program:6.1', 'contract:4.3']),
    g('cosmetology', 'excluded', ['program:6.1', 'contract:4.3']),
    g('optics', 'excluded', ['program:6.3', 'contract:4.3']),
    g('inpatient', 'needs_guarantee', ['program:5.1', 'contract:4.5']),
    g('surgery', 'needs_guarantee', ['program:5.2', 'contract:4.5']),
    p === 'basic' ? g('maternity', 'excluded', ['program:5.3']) : g('maternity', 'needs_guarantee', ['program:5.3', 'contract:4.4'], { waitingDays: MATERNITY_WAITING_DAYS }),
  ];
}

export const COVERAGE_RULES: CoverageRule[] = PROGRAMS.flatMap(rulesFor);

/** The program the golden cases are written for. */
export const DEMO_PROGRAM: ProgramCode = 'standard';
