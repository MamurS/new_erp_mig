/*
 * Seed-time version of "accepted rebill lines become MIG claims" (ASSISTANCE_SPEC §5.5): the same rows the
 * service `claimsFromRebill` (packages/domain/src/services/assistance.ts) makes, built synchronously on the
 * database being seeded. Numbers follow the claim template of that database's DMS parameters.
 */
import type { Rebill } from '@mig/contracts';
import { CATEGORY_TO_CLAIM_OF_SERVICE } from '@mig/domain/clinics';
import { hashString, mulberry32, uuidFrom } from '@mig/domain/lib/rng';
import { paramsView } from '@mig/domain/services/params';
import type { ClaimRow, Db } from '@mig/domain/store/db';
import { DAY, tzIso } from './time';

export function seedClaimsFromRebill(d: Db, b: Rebill, actorName: string, opts: { now: number }): void {
  const P = paramsView(d.dmsParams.values);
  const now = tzIso(opts.now);
  const year = new Date(opts.now).getFullYear();
  for (const line of b.lines) {
    if (line.status !== 'accepted' || d.claims.some((c) => c.registryLineId === line.registryLineId)) continue;
    const r = d.registries.find((x) => x.lines.some((l) => l.id === line.registryLineId));
    const l = r?.lines.find((x) => x.id === line.registryLineId);
    const v = l?.visitId ? d.visits.find((x) => x.id === l.visitId) : undefined;
    const who = v ? d.insured.find((i) => i.id === v.insuredId) : undefined;
    if (!r || !l || !who) continue;
    const svc = (d.priceLists.find((p) => p.clinicId === r.clinicId)?.items ?? []).find((p) => p.code === l.serviceCode);
    const n = P.maxDocSeq('claim', d.claims.map((c) => c.number)) + 1;
    const claim: ClaimRow = {
      // Derived from the line: the seed stays deterministic (supabase/seed.sql is generated from it).
      id: uuidFrom(mulberry32(hashString(`claim:${line.registryLineId}`))),
      number: P.nextDocNumber('claim', { year, n }),
      insuredId: who.id,
      insuredName: who.fullName,
      clientId: who.clientId,
      clientName: who.clientName,
      category: CATEGORY_TO_CLAIM_OF_SERVICE[svc?.category ?? 'outpatient'],
      source: 'assistance',
      amountClaimed: line.amount,
      amountApproved: line.amount,
      providerName: line.clinicName,
      serviceDate: line.serviceDate,
      status: 'approved',
      slaDueAt: tzIso(opts.now + 5 * DAY),
      createdAt: now,
      updatedAt: now,
      attachments: [],
      history: [
        { at: now, actorName: d.assistances.find((a) => a.id === b.assistanceId)?.name ?? 'Ассистанс', to: 'new' },
        { at: now, actorName, from: 'new', to: 'approved', comment: `Счёт ассистанса ${b.number}` },
      ],
      registryLineId: line.registryLineId,
    };
    d.claims.unshift(claim);
    // A case that led to the letter of this line now points to the claim as well.
    const letter = l.guaranteeNumber ? d.guarantees.find((g) => g.number === l.guaranteeNumber && g.clinicId === r.clinicId) : undefined;
    if (letter) for (const c of d.cases) if (c.links.guaranteeId === letter.id) c.links.claimId = claim.id;
    // The claim enters the client's loss ratio like any other paid-out claim.
    const client = d.clients.find((c) => c.id === who.clientId);
    if (client && client.premium > 0) client.lossRatio = Math.round(((client.lossRatio ?? 0) + line.amount / client.premium) * 1000) / 1000;
  }
}
