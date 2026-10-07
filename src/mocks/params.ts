/*
 * Current values of the DMS business parameters on the mock server: the stored value when MIG
 * changed it, otherwise the demo value from src/shared/config/dmsParameters.ts. The same for the
 * templates of document numbers: every number generator reads `numbering()`.
 */
import { groupRulesOf, type GroupRules } from '@/shared/domain/minGroup';
import type { DmsParamKey, DmsParamValues } from '@/shared/types';
import { DMS_DEFAULTS, DMS_PARAM_KEYS, numberingParamKey } from '@/shared/config/dmsParameters';
import { DEFAULT_NUMBERING, DOC_NUMBER_KINDS, docNumber, parseDocNumber, type DocNumberKind, type DocNumberVars, type NumberingTemplates } from '@/shared/domain/numbering';
import { db } from './db';

export function dmsParam(key: DmsParamKey): number {
  return db().dmsParams.values[key]?.value ?? DMS_DEFAULTS[key];
}

export function paramValues(): DmsParamValues {
  return Object.fromEntries(DMS_PARAM_KEYS.map((k) => [k, dmsParam(k)])) as DmsParamValues;
}

export function numberingTemplate(kind: DocNumberKind): string {
  return db().dmsParams.values[numberingParamKey(kind)]?.value ?? DEFAULT_NUMBERING[kind];
}

/** Templates in force. */
export function numbering(): NumberingTemplates {
  return Object.fromEntries(DOC_NUMBER_KINDS.map((k) => [k, numberingTemplate(k)])) as NumberingTemplates;
}

/** A new document number made with the template in force. */
export function nextDocNumber(kind: DocNumberKind, vars: DocNumberVars): string {
  return docNumber(kind, vars, numbering());
}

/**
 * Largest sequence among existing numbers of the kind, read back with the template in force (then the
 * demo template, then the trailing digits, for numbers issued before a template change).
 * `year`: only numbers of that year count when the template has one.
 */
export function maxDocSeq(kind: DocNumberKind, numbers: readonly string[], opts: { year?: number; floor?: number } = {}): number {
  const templates = [numberingTemplate(kind), DEFAULT_NUMBERING[kind]];
  let max = opts.floor ?? 0;
  for (const number of numbers) {
    const vars = templates.map((tpl) => parseDocNumber(tpl, number)).find((v) => v !== null);
    if (opts.year !== undefined && vars?.year !== undefined && vars.year !== opts.year) continue;
    if (opts.year !== undefined && !vars) continue;
    const n = vars?.n ?? Number(/(\d+)$/.exec(number)?.[1] ?? 0);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** Rules of the «Клиенты» parameters: minimal group and allowed legal forms (src/shared/domain/minGroup.ts). */
export function groupRules(): GroupRules {
  return groupRulesOf({ minGroupSize: dmsParam('minGroupSize'), minGroupCountsFamily: dmsParam('minGroupCountsFamily'), allowedLegalForms: dmsParam('allowedLegalForms'), belowMinDuringTerm: dmsParam('belowMinDuringTerm') });
}
