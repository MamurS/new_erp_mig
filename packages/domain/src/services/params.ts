/*
 * Current values of the DMS business parameters: the stored value when MIG changed it, otherwise the demo
 * value (config/dmsParameters.ts). A service loads them once (`loadParams`) and reads them synchronously,
 * the templates of document numbers too. The endpoints of /staff/admin/parameters are at the bottom.
 */
import { msg } from '@mig/i18n';
import type { DmsParamChange, DmsParameter, DmsParamKey, DmsParamValues, NumberingParameter, ParamKey } from '@mig/contracts';
import type { DmsParamsView } from '@mig/contracts/dto';
import { dmsParamChangeSchema, dmsParamRejectSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { DMS_DEFAULTS, DMS_PARAM_KEYS, DMS_PARAMETERS, formatParamValue, isNumberingParamKey, numberingKindOf, numberingParamKey, paramLabel } from '../config/dmsParameters';
import { isStaffRole } from '../labels';
import { randomId } from '../lib/random';
import { tzIso } from '../lib/time';
import { groupRulesOf, type GroupRules } from '../minGroup';
import { DEFAULT_NUMBERING, DOC_NUMBER_KINDS, docNumber, parseDocNumber, type DocNumberKind, type DocNumberVars, type NumberingTemplates } from '../numbering';
import type { Db } from '../store/db';
import { audit, conflict, DomainError, notFound, requirePermission, validate, type AuthCtx, type BaseCtx } from './kernel';

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

// ---------------------------------------------------------------- endpoints (/staff/admin/parameters)
/*
 * Four-eyes: an admin proposes a new value, another admin or an underwriter confirms it, and only then it
 * applies. Every step is audited with the old and the new value.
 */

function toParameter(values: Db['dmsParams']['values'], key: DmsParamKey): DmsParameter {
  const stored = values[key];
  return stored ? { key, value: stored.value, isDemo: false, changedAt: stored.changedAt, changedByName: stored.changedByName } : { key, value: DMS_PARAMETERS[key].defaultValue, isDemo: true };
}

function toNumbering(values: Db['dmsParams']['values'], kind: DocNumberKind): NumberingParameter {
  const stored = values[numberingParamKey(kind)];
  return stored ? { kind, value: stored.value, isDemo: false, changedAt: stored.changedAt, changedByName: stored.changedByName } : { kind, value: DEFAULT_NUMBERING[kind], isDemo: true };
}

/** Current value of any parameter: a number, or the template of a numbering key. */
const currentValue = (P: ParamsView, key: ParamKey): number | string => (isNumberingParamKey(key) ? P.numberingTemplate(numberingKindOf(key)) : P.dmsParam(key));

const changeLabel = (c: Pick<DmsParamChange, 'key' | 'from' | 'to'>) => `${paramLabel(c.key)}: ${formatParamValue(c.key, c.from)} → ${formatParamValue(c.key, c.to)}`;

async function pendingChange(ctx: BaseCtx, id: string): Promise<DmsParamChange> {
  const c = await ctx.repos.dmsParamChanges.get(id);
  if (!c) throw notFound();
  if (c.status !== 'pending') throw conflict('srv.change.alreadyReviewed');
  return c;
}

/** GET /params/values: the values the screens need. Staff get all; other portals only those marked `audience: 'all'`. */
export async function paramValuesFor(ctx: AuthCtx): Promise<Partial<DmsParamValues>> {
  const keys = isStaffRole(ctx.user.role) ? DMS_PARAM_KEYS : DMS_PARAM_KEYS.filter((k) => DMS_PARAMETERS[k].audience === 'all');
  const P = await loadParams(ctx);
  return Object.fromEntries(keys.map((k) => [k, P.dmsParam(k)]));
}

/** GET /params: every parameter with its source, the numbering templates and the latest changes. */
export async function paramsScreen(ctx: AuthCtx): Promise<DmsParamsView> {
  requirePermission(ctx.user, 'dms_params.read');
  const values = await ctx.repos.one.dmsParamValues();
  return {
    parameters: DMS_PARAM_KEYS.map((k) => toParameter(values, k)),
    numbering: DOC_NUMBER_KINDS.map((k) => toNumbering(values, k)),
    changes: await ctx.repos.dmsParamChanges.list({ limit: 50 }),
  };
}

/** POST /params/changes: a proposal (the adapter answers 201). */
export async function proposeParamChange(ctx: AuthCtx, body: unknown): Promise<DmsParamChange> {
  const { user } = ctx;
  requirePermission(user, 'dms_params.propose');
  const input = validate(dmsParamChangeSchema, body);
  const key = input.key as ParamKey;
  if (await ctx.repos.dmsParamChanges.exists({ key, status: 'pending' })) throw conflict('srv.params.alreadyPending');
  const from = currentValue(await loadParams(ctx), key);
  if (from === input.value) throw new DomainError(422, 'validation', 'srv.params.sameValue', { fields: { value: msg('srv.params.valueUnchanged') } });
  const change: DmsParamChange = {
    id: randomId(),
    key,
    from,
    to: input.value,
    reason: input.reason,
    status: 'pending',
    proposedById: user.id,
    proposedByName: user.displayName,
    proposedAt: tzIso(ctx.now()),
  };
  await ctx.repos.dmsParamChanges.insert(change, { at: 'start' });
  await audit(ctx, user, 'dms_param_proposed', { targetType: 'parameter', targetId: change.id, targetLabel: changeLabel(change), reason: input.reason });
  return change;
}

/** POST /params/changes/:id/approve: by a second person; the value applies at once. */
export async function approveParamChange(ctx: AuthCtx, id: string): Promise<DmsParamChange> {
  const { user } = ctx;
  requirePermission(user, 'dms_params.approve');
  const c = await pendingChange(ctx, id);
  if (!can(user, 'dms_params.approve', { createdById: c.proposedById })) throw new DomainError(403, 'forbidden', 'srv.params.fourEyes');
  // The value changed after the proposal (another change applied): the proposal is stale.
  if (currentValue(await loadParams(ctx), c.key) !== c.from) throw conflict('srv.params.stale');
  const at = tzIso(ctx.now());
  c.status = 'applied';
  c.decidedById = user.id;
  c.decidedByName = user.displayName;
  c.decidedAt = at;
  await ctx.repos.dmsParamChanges.put(c);
  const stored = { changedAt: at, changedByName: `${c.proposedByName}, подтвердил ${user.displayName}` };
  const values = await ctx.repos.one.dmsParamValues();
  if (isNumberingParamKey(c.key)) values[c.key] = { ...stored, value: String(c.to) };
  else values[c.key] = { ...stored, value: Number(c.to) };
  await ctx.repos.one.setDmsParamValues(values);
  await audit(ctx, user, 'dms_param_changed', { targetType: 'parameter', targetId: c.id, targetLabel: changeLabel(c), reason: `Предложил ${c.proposedByName}: ${c.reason}` });
  return c;
}

/** POST /params/changes/:id/reject: needs no second person — the author may also withdraw their own proposal. */
export async function rejectParamChange(ctx: AuthCtx, id: string, body: unknown): Promise<DmsParamChange> {
  const { user } = ctx;
  requirePermission(user, 'dms_params.approve');
  const c = await pendingChange(ctx, id);
  const { reason } = validate(dmsParamRejectSchema, body);
  c.status = 'rejected';
  c.decidedById = user.id;
  c.decidedByName = user.displayName;
  c.decidedAt = tzIso(ctx.now());
  c.rejectReason = reason;
  await ctx.repos.dmsParamChanges.put(c);
  await audit(ctx, user, 'dms_param_rejected', { targetType: 'parameter', targetId: c.id, targetLabel: changeLabel(c), reason });
  return c;
}
