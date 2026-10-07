import { describe, expect, it } from 'vitest';
import { tm } from '@/i18n';
import { DEFAULT_NUMBERING, DOC_NUMBER_KINDS, DOC_NUMBER_RE } from '@/shared/domain/numbering';
import { dmsParamChangeSchema } from '@/shared/schemas/forms';
import { certificateNumber, contractNumber, endorsementNumber } from '@/shared/domain/contracts';
import { dmsParamValues } from '@/shared/api/schemas';
import { DMS_DEFAULTS, DMS_PARAM_KEYS, formatParamValue, isNumberingParamKey, numberingExample, numberingTemplateError, paramLabel } from './dmsParameters';

describe('numbering templates as parameters', () => {
  it('every demo template renders an ASCII sample', () => {
    for (const kind of DOC_NUMBER_KINDS) expect(numberingExample(kind, DEFAULT_NUMBERING[kind]), kind).toMatch(DOC_NUMBER_RE);
    expect(numberingExample('endorsement', DEFAULT_NUMBERING.endorsement)).toMatch(/^DS-123\/DMS-D-\d{4}-000123$/);
  });

  it('keys and labels', () => {
    expect(isNumberingParamKey('numbering.contract')).toBe(true);
    expect(isNumberingParamKey('numbering.nope')).toBe(false);
    expect(isNumberingParamKey('limitLowShare')).toBe(false);
    expect(paramLabel('numbering.guarantee')).toBe('Гарантийное письмо');
    expect(formatParamValue('numbering.kp', 'KP-{N}')).toBe('KP-{N}');
  });

  it('the form schema validates templates with the same rule as the server', () => {
    const ok = dmsParamChangeSchema.safeParse({ key: 'numbering.kp', value: ' KP/{YYYY}/{N:4} ', reason: 'Приказ № 3' });
    expect(ok.success && ok.data.value).toBe('KP/{YYYY}/{N:4}');
    const bad = dmsParamChangeSchema.safeParse({ key: 'numbering.kp', value: 'КП-{N}', reason: 'Приказ № 3' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('dom.numbering.chars');
    expect(tm(numberingTemplateError('certificate', 'SERT-{N}'))).toContain('{N}, {M}');
    expect(dmsParamChangeSchema.safeParse({ key: 'limitLowShare', value: 'x', reason: 'Приказ № 3' }).success).toBe(false);
  });

  it('domain generators follow the given templates', () => {
    const templates = { ...DEFAULT_NUMBERING, contract: 'C/{YYYY}/{N:4}', certificate: 'S-{YYYY}-{N}-{M:2}' };
    const c = contractNumber(2026, 45, templates);
    expect(c).toBe('C/2026/0045');
    expect(certificateNumber(c, 3, templates)).toBe('S-2026-45-03');
    expect(certificateNumber(contractNumber(2026, 45), 1)).toBe('SERT-2026-000045-0001');
    expect(endorsementNumber(2, c, templates)).toBe('DS-2/C/2026/0045');
  });
});

describe('the API contract knows every parameter', () => {
  it('the response schema of /params/values accepts every key with its demo value', () => {
    const all = Object.fromEntries(DMS_PARAM_KEYS.map((k) => [k, DMS_DEFAULTS[k]]));
    const parsed = dmsParamValues.safeParse(all);
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.data ?? {}).sort()).toEqual([...DMS_PARAM_KEYS].sort());
  });
});
