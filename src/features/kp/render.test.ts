// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { KpLang, KpParams, KpVariant } from '@/shared/types';
import { kpDocumentTitle, kpTotalPremium } from '@/shared/domain/kp';
import { escapeHtml, formatKpMoney, groupDigits } from './format';
import { kpSrcdoc, renderKp, type KpRenderContext } from './render';

const PARAMS: KpParams = {
  templateId: 'gold',
  lang: 'ru',
  variant: 'grey',
  sumInsured: 200_000_000,
  premiumEmployee: 15_000_000,
  premiumFamily: 5_000_000,
  employees: 45,
  familyMembers: 12,
  coverageStart: '2027-01-01',
  coverageEnd: '2027-12-31',
  validUntil: '2026-10-30',
  paymentTerms: 'quarterly',
};
const CTX: KpRenderContext = {
  number: 'КП-2026-000123',
  date: '2026-09-30',
  clientLegalForm: 'ООО',
  clientName: 'Ташкент Агрологистика',
  clientInn: '301234567',
  underwriterName: 'Дилшод Султанов',
  underwriterEmail: 'underwriter@demo.mig.uz',
  templateVersion: 'GOLD 09/26',
};
const NBSP = ' ';

describe('renderKp', () => {
  const langs: KpLang[] = ['ru', 'en'];
  const variants: KpVariant[] = ['white', 'grey', 'black'];
  for (const lang of langs)
    for (const variant of variants) {
      it(`${lang}-${variant}: 17 pages, every placeholder substituted`, () => {
        const { pagesHtml } = renderKp({ ...PARAMS, lang, variant }, CTX);
        expect(pagesHtml).toHaveLength(17);
        const all = pagesHtml.join('\n');
        expect(all).not.toMatch(/\{\{[^}]*\}\}/);
        expect(all).toContain(escapeHtml(formatKpMoney(200_000_000, lang)));
        expect(all).toContain(escapeHtml(formatKpMoney(15_000_000, lang)));
        expect(all).toContain(escapeHtml(formatKpMoney(5_000_000, lang)));
        expect(all).not.toMatch(/<script/i);
      });
    }

  it('page 1 is the offer letter with client, table and total; RU and EN', () => {
    const ru = renderKp(PARAMS, CTX).pagesHtml[0]!;
    expect(ru).toContain('Коммерческое предложение');
    expect(ru).toContain('КП-2026-000123');
    expect(ru).toContain('30.10.2026');
    expect(ru).toContain('ООО «Ташкент Агрологистика»');
    expect(ru).toContain('ИНН 301234567');
    expect(ru).toContain('01.01.2027 — 31.12.2027');
    expect(ru).toContain('Сотрудники');
    expect(ru).toContain('Члены семей');
    expect(ru).toContain('Общая страховая премия');
    expect(ru).toContain(`735${NBSP}000${NBSP}000${NBSP}сум`); // 45 × 15 000 000 + 12 × 5 000 000
    expect(ru).toContain('Поквартально');
    expect(ru).toContain('underwriter@demo.mig.uz');
    expect(ru).toContain('Подробные условия программы GOLD — на следующих страницах');
    const en = renderKp({ ...PARAMS, lang: 'en', paymentTerms: 'monthly' }, CTX).pagesHtml[0]!;
    expect(en).toContain('Commercial offer');
    expect(en).toContain('Valid until');
    expect(en).toContain('735,000,000 UZS');
    expect(en).toContain('Monthly');
    expect(en).toContain('LLC “Ташкент Агрологистика”');
  });

  it('escapes the client name, the underwriter name and other text: no markup gets through', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { pagesHtml, title } = renderKp(PARAMS, { ...CTX, clientName: evil, underwriterName: `"><script>alert(1)</script>`, clientInn: '<b>1</b>' });
    const letter = pagesHtml[0]!;
    expect(letter).not.toContain('<img src=x');
    expect(letter).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(letter).not.toContain('<script>');
    expect(letter).toContain('&quot;&gt;&lt;script&gt;');
    expect(letter).not.toContain('<b>1</b>');
    const html = kpSrcdoc({ pagesHtml, title }, '/kp/gold/', 'ru');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<img src=x onerror');
  });

  it('builds a document with the asset base, fonts and print rules, and a safe title', () => {
    const r = renderKp(PARAMS, CTX);
    const html = kpSrcdoc(r, '/kp/gold/', 'ru');
    expect(html).toContain('<base href="/kp/gold/">');
    expect(html).toContain('<link rel="stylesheet" href="/kp/gold/fonts.css">');
    expect(html).toContain('src="/kp/gold/assets/img/emblem.png"');
    expect(html).not.toContain('src="assets/');
    expect(html).toContain('@page { size: 210mm 297mm; margin: 0; }');
    expect(html).toContain('print-color-adjust: exact');
    expect(html).toContain('<title>КП-2026-000123 — Ташкент Агрологистика</title>');
    expect(html.match(/<div class="page">/g)).toHaveLength(17);
  });
});

describe('money formatting', () => {
  it('ru: NBSP groups and « сум»', () => {
    expect(formatKpMoney(200_000_000, 'ru')).toBe(`200${NBSP}000${NBSP}000${NBSP}сум`);
    expect(formatKpMoney(999, 'ru')).toBe(`999${NBSP}сум`);
    expect(groupDigits(1_000_000_000_000, 'ru')).toBe(`1${NBSP}000${NBSP}000${NBSP}000${NBSP}000`);
  });
  it('en: comma groups and « UZS»', () => {
    expect(formatKpMoney(15_000_000, 'en')).toBe('15,000,000 UZS');
    expect(formatKpMoney(0, 'en')).toBe('0 UZS');
  });
  it('formats only validated integers', () => {
    expect(() => formatKpMoney(1.5, 'ru')).toThrow(RangeError);
    expect(() => formatKpMoney(-1, 'ru')).toThrow(RangeError);
    expect(() => formatKpMoney(Number.NaN, 'en')).toThrow(RangeError);
    expect(() => formatKpMoney('1000' as unknown as number, 'en')).toThrow(RangeError);
  });
});

describe('domain', () => {
  it('total premium = employees × premium + family × premium', () => {
    expect(kpTotalPremium(PARAMS)).toBe(45 * 15_000_000 + 12 * 5_000_000);
    expect(kpTotalPremium({ ...PARAMS, familyMembers: 0 })).toBe(675_000_000);
  });
  it('document title strips file-system special characters', () => {
    expect(kpDocumentTitle('КП-2026-000123', 'Ташкент Агрологистика')).toBe('КП-2026-000123 — Ташкент Агрологистика');
    expect(kpDocumentTitle('КП-2026-000123', 'A/B\\C:D*E?F"G<H>I|J\u0007')).toBe('КП-2026-000123 — ABCDEFGHIJ');
  });
});
