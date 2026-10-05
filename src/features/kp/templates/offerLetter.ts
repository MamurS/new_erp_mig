/*
 * Offer letter: page 2 of a commercial offer (right after the brochure cover), laid out as an inner
 * page of the GOLD brochure — header, margins and footer as on brochure page 2, but without a printed
 * page number (the brochure numbers its own pages and refers to them, e.g. «на стр. 6»).
 * Pure string template; every dynamic value is escaped here.
 */
import type { KpLang, KpParams, KpVariant } from '@/shared/types';
import { kpTotalPremium } from '@/shared/domain/kp';
import { escapeHtml, formatKpDate, formatKpMoney, groupDigits, PAYMENT_TERMS_LABEL } from '../format';
import type { KpRenderContext } from '../render';
import { formatLegalName } from '@/shared/config/legalForms';

const INK = '#1B1F24';
/** The black cover edition replaces the brochure graphite with black on every page. */
const graphiteFor = (variant: KpVariant) => (variant === 'black' ? '#000000' : '#3A4248');
const MUTED = '#5A626A';
const ORANGE = '#E8720F';
const SAND = '#F3F1EB';
const LINE = '#D6D8DB';
const LEGAL = '#9AA3AC';

const TEXT = {
  ru: {
    headerContacts: 'Вопросы? Звоните: <strong style="font-weight: 600;">+998 78 122 00 13</strong><br>Пишите: <strong style="font-weight: 600;">info@mosaic-insurance.com</strong>',
    headerPlan: 'Программа <span style="color: #F8D870;">GOLD</span>',
    title: 'Коммерческое предложение',
    number: 'Номер',
    date: 'Дата',
    validUntil: 'Действительно до',
    to: 'Кому',
    inn: 'ИНН',
    program: 'Программа',
    programValue: 'ДМС GOLD',
    period: 'Период страхования',
    sum: 'Страховая сумма на одного застрахованного',
    calc: 'Расчёт страховой премии',
    category: 'Категория',
    count: 'Количество',
    perPerson: 'Премия за одного',
    total: 'Итого',
    employees: 'Сотрудники',
    family: 'Члены семей',
    grandTotal: 'Общая страховая премия',
    payment: 'Условия оплаты',
    contact: 'Ваш андеррайтер',
    more: 'Подробные условия программы GOLD — на следующих страницах',
    legal: '© 2026 АО «Mosaic Insurance Group». Предложение не является публичной офертой; условия страхования определяются договором и программой страхования.',
    dash: '—',
  },
  en: {
    headerContacts: 'Questions? Call us: <strong style="font-weight: 600;">+998 78 122 00 13</strong><br>Email us: <strong style="font-weight: 600;">info@mosaic-insurance.com</strong>',
    headerPlan: 'The <span style="color: #F8D870;">GOLD</span> plan',
    title: 'Commercial offer',
    number: 'Number',
    date: 'Date',
    validUntil: 'Valid until',
    to: 'To',
    inn: 'TIN',
    program: 'Programme',
    programValue: 'VHI GOLD',
    period: 'Coverage period',
    sum: 'Sum insured per insured person',
    calc: 'Premium calculation',
    category: 'Category',
    count: 'Quantity',
    perPerson: 'Premium per person',
    total: 'Total',
    employees: 'Employees',
    family: 'Family members',
    grandTotal: 'Total insurance premium',
    payment: 'Payment terms',
    contact: 'Your underwriter',
    more: 'Detailed terms of the GOLD programme are on the following pages',
    legal: '© 2026 Mosaic Insurance Group JSC. This offer is not a public offer; insurance terms are defined by the contract and the insurance programme.',
    dash: '—',
  },
} as const satisfies Record<KpLang, Record<string, string>>;

const e = escapeHtml;

function label(text: string): string {
  return `<div style="font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${MUTED};">${e(text)}</div>`;
}

function metaCell(title: string, value: string, graphite: string): string {
  return `<div style="display: flex; flex-direction: column; gap: 4px;">${label(title)}<div style="font-size: 17px; font-weight: 600; color: ${graphite};">${e(value)}</div></div>`;
}

export function offerLetterPage(params: KpParams, ctx: KpRenderContext): string {
  const t = TEXT[params.lang];
  const lang = params.lang;
  const GRAPHITE = graphiteFor(params.variant);
  const money = (n: number) => formatKpMoney(n, lang);
  const count = (n: number) => groupDigits(n, lang);
  const total = kpTotalPremium(params);
  const cell = `padding: 11px 14px; border-bottom: 1px solid ${LINE}; font-size: 15px; color: ${INK};`;
  const num = `${cell} text-align: right; white-space: nowrap;`;
  const head = `padding: 10px 14px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #FFFFFF; background: ${GRAPHITE};`;
  const row = (name: string, n: number, per: number) =>
    `<tr><td style="${cell}">${e(name)}</td><td style="${num}">${e(count(n))}</td><td style="${num}">${e(money(per))}</td><td style="${num} font-weight: 600;">${e(money(n * per))}</td></tr>`;

  // Header and legal line repeat brochure page 2 (static markup, no data); no printed page number.
  return `<div style="width: 794px; height: 1123px; box-sizing: border-box; background: #FFFFFF; position: relative; overflow: hidden; display: flex; flex-direction: column; font-family: 'Jost', 'Segoe UI', sans-serif;">
  <div style="background: ${GRAPHITE}; height: 104px; box-sizing: border-box; padding: 0 56px; display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-shrink: 0; color: #FFFFFF; font-size: 14px; line-height: 1.55;">
    <div>${t.headerContacts}</div>
    <div style="font-weight: 600; letter-spacing: 0.04em; white-space: nowrap;">${t.headerPlan}</div>
  </div>
  <div style="height: 22px; flex-shrink: 0;"></div>
  <div style="padding: 0 56px; display: flex; flex-direction: column; gap: 14px;">
    <div style="display: flex; align-items: center; gap: 14px;">
      <div style="background: ${GRAPHITE}; color: #FFFFFF; font-size: 14px; font-weight: 600; letter-spacing: 0.18em; padding: 5px 14px;">GOLD</div>
      <div style="height: 3px; width: 64px; background: ${ORANGE};"></div>
    </div>
    <h1 style="font-family: 'Literata', Georgia, serif; font-weight: 600; font-size: 40px; line-height: 1.15; color: ${GRAPHITE};">${e(t.title)}</h1>
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;">
      ${metaCell(t.number, ctx.number, GRAPHITE)}
      ${metaCell(t.date, formatKpDate(ctx.date), GRAPHITE)}
      ${metaCell(t.validUntil, formatKpDate(params.validUntil), GRAPHITE)}
    </div>
  </div>
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 22px 56px 0;">
    <div style="background: ${SAND}; border-radius: 0 24px 0 0; padding: 18px 22px; display: flex; flex-direction: column; gap: 6px;">
      ${label(t.to)}
      <div style="font-size: 19px; font-weight: 600; line-height: 1.3; color: ${GRAPHITE}; overflow-wrap: anywhere;">${e(formatLegalName(ctx.clientName, ctx.clientLegalForm, lang))}</div>
      <div style="font-size: 14px; color: ${MUTED};">${e(t.inn)} ${e(ctx.clientInn)}</div>
    </div>
    <div style="background: #FFFFFF; border: 1px solid ${LINE}; border-radius: 0 24px 0 0; padding: 18px 22px; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; justify-content: space-between; gap: 12px;"><span style="font-size: 14px; color: ${MUTED};">${e(t.program)}</span><span style="font-size: 15px; font-weight: 600; color: ${GRAPHITE};">${e(t.programValue)}</span></div>
      <div style="display: flex; justify-content: space-between; gap: 12px;"><span style="font-size: 14px; color: ${MUTED};">${e(t.period)}</span><span style="font-size: 15px; font-weight: 600; color: ${GRAPHITE}; white-space: nowrap;">${e(formatKpDate(params.coverageStart))} — ${e(formatKpDate(params.coverageEnd))}</span></div>
      <div style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 14px; color: ${MUTED};">${e(t.sum)}</span><span style="font-size: 24px; font-weight: 600; color: ${ORANGE};">${e(money(params.sumInsured))}</span></div>
    </div>
  </div>
  <div style="padding: 24px 56px 0; display: flex; flex-direction: column; gap: 12px;">
    <h2 style="font-size: 19px; font-weight: 600; color: ${GRAPHITE};">${e(t.calc)}</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr><th style="${head} text-align: left;">${e(t.category)}</th><th style="${head} text-align: right;">${e(t.count)}</th><th style="${head} text-align: right;">${e(t.perPerson)}</th><th style="${head} text-align: right;">${e(t.total)}</th></tr></thead>
      <tbody>
        ${row(t.employees, params.employees, params.premiumEmployee)}
        ${row(t.family, params.familyMembers, params.premiumFamily)}
      </tbody>
      <tfoot><tr><td colspan="3" style="padding: 14px; font-size: 16px; font-weight: 600; color: ${GRAPHITE}; background: ${SAND};">${e(t.grandTotal)}</td><td style="padding: 14px; font-size: 20px; font-weight: 600; color: ${ORANGE}; background: ${SAND}; text-align: right; white-space: nowrap;">${e(money(total))}</td></tr></tfoot>
    </table>
  </div>
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 22px 56px 0;">
    <div style="border-left: 3px solid ${ORANGE}; padding: 4px 0 4px 16px; display: flex; flex-direction: column; gap: 6px;">
      ${label(t.payment)}
      <div style="font-size: 17px; font-weight: 600; color: ${GRAPHITE};">${e(PAYMENT_TERMS_LABEL[lang][params.paymentTerms])}</div>
    </div>
    <div style="border-left: 3px solid ${ORANGE}; padding: 4px 0 4px 16px; display: flex; flex-direction: column; gap: 6px;">
      ${label(t.contact)}
      <div style="font-size: 17px; font-weight: 600; color: ${GRAPHITE};">${e(ctx.underwriterName)}</div>
      <div style="font-size: 15px; color: ${MUTED}; overflow-wrap: anywhere;">${e(ctx.underwriterEmail)}</div>
    </div>
  </div>
  <div style="flex-grow: 1;"></div>
  <div style="padding: 0 56px 56px;"><div style="background: #FDE7D3; color: ${GRAPHITE}; font-size: 16px; font-weight: 600; padding: 14px 22px;">${e(t.more)} →</div></div>
  <div data-legal style="position: absolute; left: 56px; right: 56px; bottom: 12px; font-family: 'Fira Sans Condensed', 'Arial Narrow', sans-serif; font-size: 9px; line-height: 1.3; color: ${LEGAL}; text-align: left; pointer-events: none;">${e(ctx.templateVersion)} · ${e(t.legal)}</div>
</div>`;
}
