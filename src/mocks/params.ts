/*
 * Current values of the DMS business parameters on the mock server: the stored value when MIG
 * changed it, otherwise the demo value from src/shared/config/dmsParameters.ts.
 */
import type { DmsParamKey, DmsParamValues } from '@/shared/types';
import { DMS_DEFAULTS, DMS_PARAM_KEYS } from '@/shared/config/dmsParameters';
import { db } from './db';

export function dmsParam(key: DmsParamKey): number {
  return db().dmsParams.values[key]?.value ?? DMS_DEFAULTS[key];
}

export function paramValues(): DmsParamValues {
  return Object.fromEntries(DMS_PARAM_KEYS.map((k) => [k, dmsParam(k)])) as DmsParamValues;
}
