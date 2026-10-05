/*
 * DMS business parameters (/staff/admin/parameters). Four-eyes: an admin proposes a new value,
 * another admin or an underwriter confirms it, and only then it applies. Every step is audited
 * with the old and the new value.
 */
import { msg } from '@/i18n/core';
import { http, HttpResponse } from 'msw';
import type { DmsParamChange, DmsParameter, DmsParamKey, NumberingParameter, ParamKey } from '@/shared/types';
import type { DmsParamsView } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole } from '@/shared/domain/labels';
import { DMS_PARAM_KEYS, DMS_PARAMETERS, formatParamValue, isNumberingParamKey, numberingKindOf, numberingParamKey, paramLabel } from '@/shared/config/dmsParameters';
import { DEFAULT_NUMBERING, DOC_NUMBER_KINDS, type DocNumberKind } from '@/shared/domain/numbering';
import { dmsParamChangeSchema, dmsParamRejectSchema } from '@/shared/schemas/forms';
import { db } from '../db';
import { API, audit, body, conflict, HttpError, notFound, param, requirePermission, requireSession, route } from '../http';
import { dmsParam, numberingTemplate } from '../params';
import { randomId } from '../rng';
import { tzIso } from '../time';

function toParameter(key: DmsParamKey): DmsParameter {
  const stored = db().dmsParams.values[key];
  return stored ? { key, value: stored.value, isDemo: false, changedAt: stored.changedAt, changedByName: stored.changedByName } : { key, value: DMS_PARAMETERS[key].defaultValue, isDemo: true };
}

function toNumbering(kind: DocNumberKind): NumberingParameter {
  const stored = db().dmsParams.values[numberingParamKey(kind)];
  return stored ? { kind, value: stored.value, isDemo: false, changedAt: stored.changedAt, changedByName: stored.changedByName } : { kind, value: DEFAULT_NUMBERING[kind], isDemo: true };
}

/** Current value of any parameter: a number, or the template of a numbering key. */
const currentValue = (key: ParamKey): number | string => (isNumberingParamKey(key) ? numberingTemplate(numberingKindOf(key)) : dmsParam(key));

const changeLabel = (c: Pick<DmsParamChange, 'key' | 'from' | 'to'>) => `${paramLabel(c.key)}: ${formatParamValue(c.key, c.from)} → ${formatParamValue(c.key, c.to)}`;

function pendingChange(id: string): DmsParamChange {
  const c = db().dmsParams.changes.find((x) => x.id === id);
  if (!c) throw notFound();
  if (c.status !== 'pending') throw conflict('srv.change.alreadyReviewed');
  return c;
}

export const paramHandlers = [
  // Values the screens need. Staff get all of them; other portals only the ones marked `audience: 'all'`.
  http.get(
    `${API}/params/values`,
    route(({ request }) => {
      const { user } = requireSession(request);
      const keys = isStaffRole(user.role) ? DMS_PARAM_KEYS : DMS_PARAM_KEYS.filter((k) => DMS_PARAMETERS[k].audience === 'all');
      return Object.fromEntries(keys.map((k) => [k, dmsParam(k)]));
    }),
  ),
  http.get(
    `${API}/params`,
    route(({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'dms_params.read');
      const out: DmsParamsView = { parameters: DMS_PARAM_KEYS.map(toParameter), numbering: DOC_NUMBER_KINDS.map(toNumbering), changes: db().dmsParams.changes.slice(0, 50) };
      return out;
    }),
  ),
  http.post(
    `${API}/params/changes`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'dms_params.propose');
      const input = await body(request, dmsParamChangeSchema);
      const key = input.key as ParamKey;
      const d = db();
      if (d.dmsParams.changes.some((c) => c.key === key && c.status === 'pending')) throw conflict('srv.params.alreadyPending');
      const from = currentValue(key);
      if (from === input.value) throw new HttpError(422, 'validation', 'srv.params.sameValue', { fields: { value: msg('srv.params.valueUnchanged') } });
      const change: DmsParamChange = {
        id: randomId(),
        key,
        from,
        to: input.value,
        reason: input.reason,
        status: 'pending',
        proposedById: user.id,
        proposedByName: user.displayName,
        proposedAt: tzIso(Date.now()),
      };
      d.dmsParams.changes.unshift(change);
      audit(user, 'dms_param_proposed', { targetType: 'parameter', targetId: change.id, targetLabel: changeLabel(change), reason: input.reason });
      return HttpResponse.json(change, { status: 201 });
    }),
  ),
  http.post(
    `${API}/params/changes/:id/approve`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'dms_params.approve');
      const c = pendingChange(param(ctx, 'id'));
      if (!can(user, 'dms_params.approve', { createdById: c.proposedById })) {
        throw new HttpError(403, 'forbidden', 'srv.params.fourEyes');
      }
      const d = db();
      // The value changed after the proposal (another change applied): the proposal is stale.
      if (currentValue(c.key) !== c.from) throw conflict('srv.params.stale');
      const at = tzIso(Date.now());
      c.status = 'applied';
      c.decidedById = user.id;
      c.decidedByName = user.displayName;
      c.decidedAt = at;
      const stored = { changedAt: at, changedByName: `${c.proposedByName}, подтвердил ${user.displayName}` };
      if (isNumberingParamKey(c.key)) d.dmsParams.values[c.key] = { ...stored, value: String(c.to) };
      else d.dmsParams.values[c.key] = { ...stored, value: Number(c.to) };
      audit(user, 'dms_param_changed', { targetType: 'parameter', targetId: c.id, targetLabel: changeLabel(c), reason: `Предложил ${c.proposedByName}: ${c.reason}` });
      return c;
    }),
  ),
  http.post(
    `${API}/params/changes/:id/reject`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'dms_params.approve');
      const c = pendingChange(param(ctx, 'id'));
      // Rejecting needs no second person: the author may also withdraw their own proposal.
      const { reason } = await body(ctx.request, dmsParamRejectSchema);
      c.status = 'rejected';
      c.decidedById = user.id;
      c.decidedByName = user.displayName;
      c.decidedAt = tzIso(Date.now());
      c.rejectReason = reason;
      audit(user, 'dms_param_rejected', { targetType: 'parameter', targetId: c.id, targetLabel: changeLabel(c), reason });
      return c;
    }),
  ),
];
