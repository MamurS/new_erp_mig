/*
 * Current values of the DMS business parameters: the stored value when MIG changed it, otherwise the demo
 * value (config/dmsParameters.ts). A service loads them once (`loadParams`) and reads them synchronously,
 * the templates of document numbers too.
 */
import type { DmsParamKey, DmsParamValues } from '@mig/contracts';
import { DMS_DEFAULTS, DMS_PARAM_KEYS, numberingParamKey } from '../config/dmsParameters';
import { groupRulesOf, type GroupRules } from '../minGroup';
import { DEFAULT_NUMBERING, DOC_NUMBER_KINDS, docNumber, parseDocNumber, type DocNumberKind, type DocNumberVars, type NumberingTemplates } from '../numbering';
import type { Db } from '../store/db';
import type { BaseCtx } from './kernel';

export interface ParamsView {
  dmsParam(key: DmsParamKey): number;
  paramValues(): DmsParamValues;
  numberingTemplate(kind: DocNumberKind): string;
  /** Templates in force. */
  numbering(): NumberingTemplates;
  /** A new document number made with the template in force. */
  nextDocNumber(kind: DocNumberKind, vars: DocNumberVars): string;
  /**
   * Largest sequence among existing numbers of the kind, read back with the template in force (then the
   * demo template, then the trailing digits, for numbers issued before a template change).
   * `year`: only numbers of that year count when the template has one.
   */
  maxDocSeq(kind: DocNumberKind, numbers: readonly string[], opts?: { year?: number; floor?: number }): number;
  /** Rules of the «Клиенты» parameters: minimal group and allowed legal forms (minGroup.ts). */
  groupRules(): GroupRules;
}

export function paramsView(values: Db['dmsParams']['values']): ParamsView {
  const dmsParam = (key: DmsParamKey): number => values[key]?.value ?? DMS_DEFAULTS[key];
  const numberingTemplate = (kind: DocNumberKind): string => values[numberingParamKey(kind)]?.value ?? DEFAULT_NUMBERING[kind];
  const numbering = (): NumberingTemplates => Object.fromEntries(DOC_NUMBER_KINDS.map((k) => [k, numberingTemplate(k)])) as NumberingTemplates;
  return {
    dmsParam,
    paramValues: () => Object.fromEntries(DMS_PARAM_KEYS.map((k) => [k, dmsParam(k)])) as DmsParamValues,
    numberingTemplate,
    numbering,
    nextDocNumber: (kind, vars) => docNumber(kind, vars, numbering()),
    maxDocSeq(kind, numbers, opts = {}) {
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
    },
    groupRules: () =>
      groupRulesOf({ minGroupSize: dmsParam('minGroupSize'), minGroupCountsFamily: dmsParam('minGroupCountsFamily'), allowedLegalForms: dmsParam('allowedLegalForms'), belowMinDuringTerm: dmsParam('belowMinDuringTerm') }),
  };
}

export async function loadParams(ctx: BaseCtx): Promise<ParamsView> {
  return paramsView(await ctx.repos.one.dmsParamValues());
}
