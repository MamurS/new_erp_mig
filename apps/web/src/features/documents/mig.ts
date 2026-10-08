/*
 * Requisites of MIG printed in documents. DEMO values: the real requisites come from MIG together
 * with the texts of the templates (docs/TEMPLATES.md).
 */
import { formatLegalName, type DocLang, type LegalFormCode } from '@mig/domain/config/legalForms';

export const MIG_REQUISITES = {
  /** Official name without the legal form; documents print it with migLegalName(). */
  name: 'Mosaic Insurance Group',
  legalForm: 'jsc' as LegalFormCode,
  inn: '000000000',
  address: 'г. Ташкент, [адрес будет предоставлен МИГ]',
  bank: '[банк будет предоставлен МИГ]',
  account: '00000000000000000000',
  mfo: '00000',
} as const;

export const MIG_RULES_REF = 'Правила добровольного медицинского страхования МИГ, [редакция будет предоставлена МИГ]';

/** MIG's full legal name in the document's language: `АО «Mosaic Insurance Group»`. */
export const migLegalName = (lang: DocLang): string => formatLegalName(MIG_REQUISITES.name, MIG_REQUISITES.legalForm, lang);
