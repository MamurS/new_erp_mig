/*
 * Current values of the DMS business parameters on the mock server: the stored value when MIG
 * changed it, otherwise the demo value from src/shared/config/dmsParameters.ts. The same for the
 * templates of document numbers: every number generator reads `numbering()`.
 */
import type { DmsParamKey, DmsParamValues } from '@/shared/types';
import { DMS_DEFAULTS, DMS_PARAM_KEYS, numberingParamKey } from '@/shared/config/dmsParameters';
import { DEFAULT_NUMBERING, DOC_NUMBER_KINDS, docNumber, type DocNumberKind, type DocNumberVars, type NumberingTemplates } from '@/shared/domain/numbering';
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
