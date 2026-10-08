/*
 * Synchronous versions of clinic actions over the in-memory database, kept only for the handlers that
 * are not ported to the services yet (assist.ts, staff-assistance.ts). The services are
 * createGuarantee in packages/domain/src/services/clinicPortal.ts and
 * revokeKey in packages/domain/src/services/partnerIntegration.ts. Remove with the old cores.
 */
import { msg } from '@mig/i18n';
import { z } from 'zod';
import type { SessionUser } from '@mig/contracts';
import { guaranteeCreateRequest } from '@mig/contracts/integration';
import { guaranteeNumber } from '@mig/domain/clinics';
import { assistanceOn } from '@mig/domain/assistance';
import { randomId } from '@mig/seed/rng';
import { isoDay, tzIso } from '@mig/seed/time';
import type { Db, GuaranteeRow, IntegrationClientRow } from './db';
import { audit, conflict, HttpError } from './http';
import { assistanceName, notifyAssistance } from './assistance-core';
import { priceListOf, pushEvent, requireVisit, type ClinicActor } from './clinic-core';
import { numbering } from './params';

export function createGuarantee(
  d: Db,
  actor: ClinicActor,
  input: z.infer<typeof guaranteeCreateRequest>,
  byName: string,
): GuaranteeRow {
  const v = requireVisit(d, actor.clinicId, input.visitId);
  const svc = priceListOf(d, actor.clinicId).find((p) => p.code === input.serviceCode);
  if (!svc) throw new HttpError(422, 'validation', 'srv.registry.serviceNotInPrice', { fields: { serviceCode: msg('srv.registry.chooseService') } });
  const who = d.insured.find((i) => i.id === v.insuredId)!;
  // The letter goes to the assistance of the insured person on the date of the request (ASSISTANCE_SPEC §5.2).
  const assistanceId = assistanceOn(d.assignments, who.policyId, isoDay(Date.now()));
  d.guaranteeSeq += 1;
  const g: GuaranteeRow = {
    id: randomId(),
    number: guaranteeNumber(new Date().getFullYear(), d.guaranteeSeq, numbering()),
    clinicId: actor.clinicId,
    visitId: v.id,
    insuredId: who.id,
    insuredName: who.fullName,
    serviceCode: svc.code,
    serviceName: svc.name,
    icd10: input.icd10,
    estimatedCost: input.estimatedCost,
    status: 'requested',
    approvals: [],
    comment: input.comment || undefined,
    attachments: [],
    createdAt: tzIso(Date.now()),
    policyId: who.policyId,
    assistanceId,
    ...(assistanceId ? { assistanceName: assistanceName(d, assistanceId) ?? undefined } : {}),
  };
  d.guarantees.unshift(g);
  audit(actor, 'guarantee_requested', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number });
  void notifyAssistance(d, assistanceId, 'guarantee.requested', g.id);
  pushEvent(d, actor.clinicId, `Запрошено гарантийное письмо ${g.number} (${byName})`);
  return g;
}

export function revokeKey(d: Db, k: IntegrationClientRow, actor: { id: string; displayName: string; role: SessionUser['role'] }): void {
  if (k.revokedAt) throw conflict('srv.apiKeys.alreadyRevoked');
  k.revokedAt = tzIso(Date.now());
  // Already issued tokens stop working immediately.
  d.accessTokens = d.accessTokens.filter((t) => t.clientRowId !== k.id);
  audit(actor, 'integration_key_revoked', { targetType: 'integration', targetId: k.id, targetLabel: k.name });
  pushEvent(d, k.clinicId, `Ключ API «${k.name}» отозван`);
}
