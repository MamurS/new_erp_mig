import { describe, expect, it } from 'vitest';
import { DEFAULT_NUMBERING, DOC_NUMBER_KINDS, DOC_NUMBER_RE, docNumber, numberingTemplateProblem, parseDocNumber, renderDocNumber } from './numbering';

describe('document numbering', () => {
  it('renders the default numbers: Latin, ASCII, the old prefixes transliterated', () => {
    expect(docNumber('contract', { year: 2026, n: 123 })).toBe('DMS-D-2026-000123');
    expect(docNumber('endorsement', { n: 1, ref: 'DMS-D-2026-000123' })).toBe('DS-1/DMS-D-2026-000123');
    expect(docNumber('kp', { year: 2026, n: 7 })).toBe('KP-2026-000007');
    expect(docNumber('policy', { year: 2026, n: 114 })).toBe('DMS-2026-000114');
    expect(docNumber('certificate', { year: 2026, n: 114, m: 3 })).toBe('SERT-2026-000114-0003');
    expect(docNumber('claim', { year: 2026, n: 4512 })).toBe('U-2026-004512');
    expect(docNumber('guarantee', { year: 2026, n: 123 })).toBe('GP-2026-000123');
    expect(docNumber('deal', { year: 2026, n: 5 })).toBe('SD-2026-000005');
    expect(docNumber('case', { year: 2026, n: 12345 })).toBe('OBR-2026-012345');
    expect(docNumber('assistInvoice', { period: '2026-09', code: 'Shifo Assistans' })).toBe('SChA-2026-09-SHIFOASSISTANS');
    expect(docNumber('invoice', { year: 2026, n: 2001 })).toBe('SCh-2026-002001');
  });

  it('every default template is valid and every number is ASCII', () => {
    for (const k of DOC_NUMBER_KINDS) {
      expect(numberingTemplateProblem(k, DEFAULT_NUMBERING[k]), k).toBeNull();
      expect(docNumber(k, { year: 2026, period: '2026-09', n: 1, m: 1, ref: 'R-1', code: 'abc' })).toMatch(DOC_NUMBER_RE);
    }
  });

  it('templates: only Latin, digits, - and /; required placeholders must be there', () => {
    expect(numberingTemplateProblem('contract', 'ДМС-Д-{YYYY}-{N:6}')).toBe('dom.numbering.chars');
    expect(numberingTemplateProblem('contract', 'DMS D {N}')).toBe('dom.numbering.chars');
    expect(numberingTemplateProblem('contract', 'DMS_{N}')).toBe('dom.numbering.chars');
    expect(numberingTemplateProblem('contract', 'DMS-{FOO}')).toBe('dom.numbering.chars');
    expect(numberingTemplateProblem('contract', '')).toBe('dom.numbering.chars');
    expect(numberingTemplateProblem('contract', 'DMS-{YYYY}')).toBe('dom.numbering.missing');
    expect(numberingTemplateProblem('endorsement', 'DS-{N}')).toBe('dom.numbering.missing');
    expect(numberingTemplateProblem('contract', 'MIG/C/{YYYY}/{N:5}')).toBeNull();
    expect(renderDocNumber('MIG/C/{YYYY}/{N:5}', { year: 2027, n: 42 })).toBe('MIG/C/2027/00042');
  });

  it('a custom template is used and numbers can be parsed back', () => {
    expect(docNumber('contract', { year: 2026, n: 9 }, { contract: 'C-{N:3}-{YYYY}' })).toBe('C-009-2026');
    expect(parseDocNumber(DEFAULT_NUMBERING.policy, 'DMS-2026-000114')).toEqual({ year: 2026, n: 114 });
    expect(parseDocNumber(DEFAULT_NUMBERING.endorsement, 'DS-2/DMS-D-2026-000123')).toEqual({ n: 2, ref: 'DMS-D-2026-000123' });
    expect(parseDocNumber(DEFAULT_NUMBERING.policy, 'ДМС-2026-000114')).toBeNull();
  });
});
