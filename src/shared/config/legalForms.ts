/*
 * Organisational and legal forms of Uzbek legal entities (clients, clinics, assistance companies,
 * payers). Entities keep their official name in Latin script WITHOUT the form and without quotes, as in
 * the state register of Uzbekistan; the form is a separate code.
 *
 * ТРЕБУЕТ ПРОВЕРКИ МИГ: the list, the abbreviations and the full names are a working draft.
 *
 * This file is reference data (like the medical services catalogue), so the labels of all three
 * languages live here and not in src/i18n: documents use them in their own language, the interface in
 * the current one.
 */
import { getLocale, type Locale } from '@/i18n';

export const LEGAL_FORMS = [
  'llc',
  'jsc',
  'private_enterprise',
  'jv_llc',
  'sole_proprietor',
  'state_unitary',
  'family_enterprise',
  'farm',
  'branch',
  'rep_office',
  'other',
] as const;
export type LegalFormCode = (typeof LEGAL_FORMS)[number];

interface FormLabels {
  /** Abbreviation for tables and chips. */
  short: string;
  /** Full name for tooltips and documents. */
  full: string;
}

/** Labels by language. ТРЕБУЕТ ПРОВЕРКИ МИГ. */
export const LEGAL_FORM_LABELS: Record<LegalFormCode, Record<Locale, FormLabels>> = {
  llc: {
    ru: { short: 'ООО', full: 'Общество с ограниченной ответственностью' },
    'uz-Latn': { short: 'MChJ', full: 'Masʼuliyati cheklangan jamiyat' },
    en: { short: 'LLC', full: 'Limited liability company' },
  },
  jsc: {
    ru: { short: 'АО', full: 'Акционерное общество' },
    'uz-Latn': { short: 'AJ', full: 'Aksiyadorlik jamiyati' },
    en: { short: 'JSC', full: 'Joint-stock company' },
  },
  private_enterprise: {
    ru: { short: 'ЧП', full: 'Частное предприятие' },
    'uz-Latn': { short: 'XK', full: 'Xususiy korxona' },
    en: { short: 'PE', full: 'Private enterprise' },
  },
  jv_llc: {
    ru: { short: 'СП ООО', full: 'Совместное предприятие в форме общества с ограниченной ответственностью' },
    'uz-Latn': { short: 'QK MChJ', full: 'Qoʻshma korxona masʼuliyati cheklangan jamiyat' },
    en: { short: 'JV LLC', full: 'Joint venture limited liability company' },
  },
  sole_proprietor: {
    ru: { short: 'ИП', full: 'Индивидуальный предприниматель' },
    'uz-Latn': { short: 'YaTT', full: 'Yakka tartibdagi tadbirkor' },
    en: { short: 'IE', full: 'Individual entrepreneur' },
  },
  state_unitary: {
    ru: { short: 'ГУП', full: 'Государственное унитарное предприятие' },
    'uz-Latn': { short: 'DUK', full: 'Davlat unitar korxonasi' },
    en: { short: 'SUE', full: 'State unitary enterprise' },
  },
  family_enterprise: {
    ru: { short: 'СП (семейное)', full: 'Семейное предприятие' },
    'uz-Latn': { short: 'OK', full: 'Oilaviy korxona' },
    en: { short: 'FE', full: 'Family enterprise' },
  },
  farm: {
    ru: { short: 'ФХ', full: 'Фермерское хозяйство' },
    'uz-Latn': { short: 'FX', full: 'Fermer xoʻjaligi' },
    en: { short: 'Farm', full: 'Farm' },
  },
  branch: {
    ru: { short: 'Филиал', full: 'Филиал' },
    'uz-Latn': { short: 'Filial', full: 'Filial' },
    en: { short: 'Branch', full: 'Branch' },
  },
  rep_office: {
    ru: { short: 'Представительство', full: 'Представительство' },
    'uz-Latn': { short: 'Vakolatxona', full: 'Vakolatxona' },
    en: { short: 'Rep. office', full: 'Representative office' },
  },
  other: {
    ru: { short: 'Прочее', full: 'Прочая организационно-правовая форма' },
    'uz-Latn': { short: 'Boshqa', full: 'Boshqa tashkiliy-huquqiy shakl' },
    en: { short: 'Other', full: 'Other legal form' },
  },
};

export function isLegalForm(v: unknown): v is LegalFormCode {
  return typeof v === 'string' && (LEGAL_FORMS as readonly string[]).includes(v);
}

/** Abbreviation in the interface language (or a given one): «ООО», «MChJ», «LLC». */
export function legalFormShort(code: LegalFormCode, locale: Locale = getLocale()): string {
  return LEGAL_FORM_LABELS[code][locale].short;
}

/** Full name in the interface language (or a given one), for tooltips. */
export function legalFormFull(code: LegalFormCode, locale: Locale = getLocale()): string {
  return LEGAL_FORM_LABELS[code][locale].full;
}

/** Languages of documents (KP, contract, endorsement, invoices). */
export type DocLang = 'ru' | 'uz' | 'en';
const DOC_LOCALE: Record<DocLang, Locale> = { ru: 'ru', uz: 'uz-Latn', en: 'en' };

/**
 * Full legal name for documents, in the document's own language (never the interface's):
 * - ru: ООО «Toshkent Agrologistika»
 * - uz: «Toshkent Agrologistika» MChJ
 * - en: Toshkent Agrologistika LLC
 * Branches and representative offices put the word in front in ru and after the name in uz/en.
 */
export function formatLegalName(name: string, legalForm: LegalFormCode, docLang: DocLang): string {
  const short = legalFormShort(legalForm, DOC_LOCALE[docLang]);
  const n = name.trim();
  if (legalForm === 'other') return docLang === 'en' ? n : `«${n}»`;
  if (docLang === 'ru') return `${short} «${n}»`;
  if (docLang === 'uz') return `«${n}» ${short}`;
  return `${n} ${short}`;
}

/** Sort key of a legal entity: the name without the form, case and apostrophe variants ignored. */
export const legalNameCollator = new Intl.Collator('en', { sensitivity: 'base', ignorePunctuation: true });
