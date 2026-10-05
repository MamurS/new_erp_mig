import type { coverage as Ru } from '../ru/coverage';
import type { Translation } from '../types';

export const coverage: Translation<typeof Ru> = {
  'coverage.note.unknownCode': 'Service {code} is not in the catalogue',
  'coverage.note.noRule': 'No rule for «{name}» in the coverage table',
  'coverage.note.excluded': '«{name}» is a plan exclusion',
  'coverage.note.waiting': 'Waiting period {days} days: covered from {from}',
  'coverage.note.limitExhausted': 'The limit for this type of care is exhausted',
  'coverage.note.subLimit': 'Sub-limit {limit}: anything above it is not covered',
  'coverage.note.partly': 'Remaining limit {remaining}: partly covered',
  'coverage.note.policyInactive': 'The policy is not active on the service date',
  'coverage.note.personInactive': 'The insured person is not covered on the service date',
  'coverage.note.unrecognized': 'Service not recognised',
};
