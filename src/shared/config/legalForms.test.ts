import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import { LEGAL_FORMS, LEGAL_FORM_LABELS, formatLegalName, legalFormFull, legalFormShort, legalNameCollator } from './legalForms';

afterEach(() => setLocale('ru'));

describe('legal forms', () => {
  it('every code has short and full labels in three languages; uz uses ʻ/ʼ, never ASCII apostrophes', () => {
    for (const c of LEGAL_FORMS)
      for (const l of ['ru', 'uz-Latn', 'en'] as const) {
        expect(LEGAL_FORM_LABELS[c][l].short.trim(), `${c} ${l}`).not.toBe('');
        expect(LEGAL_FORM_LABELS[c][l].full.trim(), `${c} ${l}`).not.toBe('');
        if (l !== 'ru') expect(/[А-Яа-яЁё'’‘`]/.test(LEGAL_FORM_LABELS[c][l].full), `${c} ${l}`).toBe(false);
      }
  });

  it('labels follow the interface language', () => {
    expect(legalFormShort('llc')).toBe('ООО');
    expect(legalFormShort('jv_llc')).toBe('СП ООО');
    setLocale('uz-Latn');
    expect(legalFormShort('llc')).toBe('MChJ');
    expect(legalFormShort('sole_proprietor')).toBe('YaTT');
    expect(legalFormFull('jsc')).toBe('Aksiyadorlik jamiyati');
    setLocale('en');
    expect(legalFormShort('state_unitary')).toBe('SUE');
  });

  it('formatLegalName builds the full name in the document language, whatever the interface language', () => {
    setLocale('en');
    expect(formatLegalName('Toshkent Agrologistika', 'llc', 'ru')).toBe('ООО «Toshkent Agrologistika»');
    expect(formatLegalName('Toshkent Agrologistika', 'llc', 'uz')).toBe('«Toshkent Agrologistika» MChJ');
    expect(formatLegalName('Toshkent Agrologistika', 'llc', 'en')).toBe('Toshkent Agrologistika LLC');
    expect(formatLegalName('Samarqand Tekstil Group', 'jv_llc', 'ru')).toBe('СП ООО «Samarqand Tekstil Group»');
    expect(formatLegalName('Samarqand Tekstil Group', 'jv_llc', 'uz')).toBe('«Samarqand Tekstil Group» QK MChJ');
    expect(formatLegalName('Samarqand Tekstil Group', 'jv_llc', 'en')).toBe('Samarqand Tekstil Group JV LLC');
    expect(formatLegalName(' Sobirov Akmal ', 'sole_proprietor', 'en')).toBe('Sobirov Akmal IE');
    expect(formatLegalName('Fargʻona Qurilish', 'other', 'ru')).toBe('«Fargʻona Qurilish»');
    expect(formatLegalName('Fargʻona Qurilish', 'other', 'en')).toBe('Fargʻona Qurilish');
  });

  it('names sort without regard to case', () => {
    const names = ['samarqand Tekstil', 'Andijon Farm', 'Toshkent Agro', 'buxoro Savdo'];
    expect([...names].sort(legalNameCollator.compare)).toEqual(['Andijon Farm', 'buxoro Savdo', 'samarqand Tekstil', 'Toshkent Agro']);
  });
});
