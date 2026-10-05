/*
 * Document numbers: ASCII only and independent of the interface language. Each kind has a template
 * kept in the DMS parameters («Нумерация документов», demo values: MIG may have its own system).
 * The default prefixes are the former Cyrillic ones transliterated letter for letter, so staff
 * recognise them: ДМС-Д → DMS-D, ДС → DS, КП → KP, У → U, ГП → GP, СД → SD, СЕРТ → SERT, ОБР → OBR,
 * СЧА → SChA; the «к» of an endorsement number became «/»: DS-1/DMS-D-2026-000123.
 *
 * Template syntax: Latin letters, digits, «-» and «/», plus placeholders
 *   {YYYY}  year            {PERIOD}  year-month (2026-09)
 *   {N}     sequence        {N:6}     sequence padded to 6 digits (any width 1–9)
 *   {M}     second sequence (certificate within a policy), {M:4} padded
 *   {REF}   number of the parent document (contract for an endorsement)
 *   {CODE}  short code of the counterparty (clinic, assistance)
 */

export const DOC_NUMBER_KINDS = [
  'contract',
  'endorsement',
  'kp',
  'policy',
  'certificate',
  'claim',
  'guarantee',
  'deal',
  'case',
  'invoice',
  'assistInvoice',
  'clinicContract',
  'assistContract',
  'paymentOrder',
  'refund',
] as const;
export type DocNumberKind = (typeof DOC_NUMBER_KINDS)[number];
export type NumberingTemplates = Record<DocNumberKind, string>;

/** Demo values. */
export const DEFAULT_NUMBERING: NumberingTemplates = {
  contract: 'DMS-D-{YYYY}-{N:6}',
  endorsement: 'DS-{N}/{REF}',
  kp: 'KP-{YYYY}-{N:6}',
  policy: 'DMS-{YYYY}-{N:6}',
  certificate: 'SERT-{YYYY}-{N:6}-{M:4}',
  claim: 'U-{YYYY}-{N:6}',
  guarantee: 'GP-{YYYY}-{N:6}',
  deal: 'SD-{YYYY}-{N:6}',
  case: 'OBR-{YYYY}-{N:6}',
  invoice: 'SCh-{YYYY}-{N:6}',
  assistInvoice: 'SChA-{PERIOD}-{CODE}',
  clinicContract: 'DK-{CODE}',
  assistContract: 'DA-{YYYY}-{N:3}',
  paymentOrder: 'PP-{N}',
  refund: 'VZ-{REF}-{N:6}',
};

/** Placeholders each kind needs, so numbers stay unique. */
export const REQUIRED_PLACEHOLDERS: Record<DocNumberKind, readonly string[]> = {
  contract: ['N'],
  endorsement: ['N', 'REF'],
  kp: ['N'],
  policy: ['N'],
  certificate: ['N', 'M'],
  claim: ['N'],
  guarantee: ['N'],
  deal: ['N'],
  case: ['N'],
  invoice: ['N'],
  assistInvoice: ['PERIOD', 'CODE'],
  clinicContract: ['CODE'],
  assistContract: ['N'],
  paymentOrder: ['N'],
  refund: ['REF', 'N'],
};

const PLACEHOLDER = /\{(YYYY|PERIOD|N|M|REF|CODE)(?::([1-9]))?\}/g;
/** A rendered number: ASCII letters, digits, «-» and «/» only. */
export const DOC_NUMBER_RE = /^[A-Za-z0-9/-]+$/;

export interface DocNumberVars {
  year?: number;
  /** YYYY-MM */
  period?: string;
  n?: number;
  m?: number;
  ref?: string;
  code?: string;
}

/** Problem of a template, as a message key (null when valid). */
export function numberingTemplateProblem(kind: DocNumberKind, template: string): 'dom.numbering.chars' | 'dom.numbering.missing' | null {
  const literal = template.replace(PLACEHOLDER, '');
  if (!template.trim() || !/^[A-Za-z0-9/-]*$/.test(literal) || /[{}]/.test(literal)) return 'dom.numbering.chars';
  const used = new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]));
  if (REQUIRED_PLACEHOLDERS[kind].some((p) => !used.has(p))) return 'dom.numbering.missing';
  return null;
}

function asciiCode(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function renderDocNumber(template: string, vars: DocNumberVars): string {
  const out = template.replace(PLACEHOLDER, (_all, name: string, width?: string) => {
    const pad = (v: number | undefined) => String(v ?? 0).padStart(width ? Number(width) : 1, '0');
    switch (name) {
      case 'YYYY':
        return String(vars.year ?? new Date().getFullYear());
      case 'PERIOD':
        return vars.period ?? '';
      case 'N':
        return pad(vars.n);
      case 'M':
        return pad(vars.m);
      case 'REF':
        return vars.ref ?? '';
      default:
        return asciiCode(vars.code ?? '') || 'X';
    }
  });
  if (!DOC_NUMBER_RE.test(out)) throw new Error(`Document number is not ASCII: ${out}`);
  return out;
}

export function docNumber(kind: DocNumberKind, vars: DocNumberVars, templates: Partial<NumberingTemplates> = DEFAULT_NUMBERING): string {
  return renderDocNumber(templates[kind] ?? DEFAULT_NUMBERING[kind], vars);
}

/** Reads the placeholders back from a number made with the template (null when it does not match). */
export function parseDocNumber(template: string, number: string): DocNumberVars | null {
  const names: string[] = [];
  let re = '';
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    re += template.slice(last, m.index).replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    names.push(m[1]!);
    re += m[1] === 'YYYY' ? '(\\d{4})' : m[1] === 'PERIOD' ? '(\\d{4}-\\d{2})' : m[1] === 'N' || m[1] === 'M' ? '(\\d+)' : '([A-Za-z0-9/-]+?)';
    last = (m.index ?? 0) + m[0].length;
  }
  re += template.slice(last).replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  const hit = new RegExp(`^${re}$`).exec(number);
  if (!hit) return null;
  const vars: DocNumberVars = {};
  names.forEach((name, i) => {
    const v = hit[i + 1]!;
    if (name === 'YYYY') vars.year = Number(v);
    else if (name === 'PERIOD') vars.period = v;
    else if (name === 'N') vars.n = Number(v);
    else if (name === 'M') vars.m = Number(v);
    else if (name === 'REF') vars.ref = v;
    else vars.code = v;
  });
  return vars;
}
