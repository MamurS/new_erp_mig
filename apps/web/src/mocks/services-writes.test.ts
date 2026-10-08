// @vitest-environment node
/*
 * Write paths of the shared services (packages/domain/src/services) on the demo database, called directly
 * with a context over the in-memory repositories: what each one must leave behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@mig/contracts';
import type { BaseCtx } from '@mig/domain/services/kernel';
import { memoryRepos } from '@mig/domain/store/memory';
import * as nAssist from '@mig/domain/services/assistance';
import * as nClinic from '@mig/domain/services/clinic';
import * as nLife from '@mig/domain/services/lifecycle';
import * as nFamilyReq from '@mig/domain/services/familyRequests';
import { db, resetDb, type Db } from './db';
import { initMockDb } from './setup';

initMockDb({ restore: false });

const NOW = Date.parse('2026-06-15T09:30:00+05:00');
let d: Db;
let ctx: BaseCtx;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  d = resetDb();
  ctx = { repos: memoryRepos(db), now: () => Date.now(), env: { demo: true } };
});
afterEach(() => {
  vi.useRealTimers();
});

describe('write paths of the services', () => {
  it('a family add request of HR becomes a policy change', async () => {
    const client = d.clients.find((c) => c.activePolicyId && d.insured.some((i) => i.clientId === c.id && i.relation === 'employee' && i.status === 'active'))!;
    const employee = d.insured.find((i) => i.clientId === client.id && i.relation === 'employee' && i.status === 'active')!;
    const actor = { id: employee.id, displayName: 'HR' };
    const person = { fullName: 'Test  Child', birthDate: '2016-02-01', pinfl: '30102169999999', relation: 'child' as const, startDate: '2026-07-01' };
    await nFamilyReq.requestFamilyAdd(ctx, actor, (await ctx.repos.clients.get(client.id))!, (await ctx.repos.insured.get(employee.id))!, person).catch(() => undefined);
    expect(db().policyChanges.some((c) => c.newPerson?.pinfl === person.pinfl)).toBe(true);
  });

  it('draft rebills are built from the accepted lines of an assistance', async () => {
    let drafts = 0;
    for (const a of d.assistances) {
      for (const period of ['2026-04', '2026-05', '2026-06']) {
        resetDb();
        await nAssist.upsertDraftRebill(ctx, a.id, period).catch(() => undefined);
        drafts += db().rebills.filter((b) => b.status === 'draft' && b.lines.length).length;
      }
    }
    expect(drafts).toBeGreaterThan(0);
  });

  it('failed patient checks are recorded and audited', async () => {
    const u = d.clinicUsers.find((x) => x.active)!;
    const actor = { id: u.id, clinicId: u.clinicId, displayName: u.fullName, role: u.role as SessionUser['role'] };
    const person = d.insured.find((i) => i.status === 'active' && d.policies.some((p) => p.id === i.policyId && p.status === 'active'))!;
    const policyNumber = d.policies.find((p) => p.id === person.policyId)!.number.toLowerCase();
    await nClinic.checkPatient(ctx, { policyNumber, pinfl: person.pinfl }, actor, 'portal');
    for (let k = 0; k < 8; k++) await nClinic.checkPatient(ctx, { policyNumber, pinfl: '00000000000000' }, actor, 'api').catch(() => undefined);
    expect(db().checkAttempts.filter((a) => a.userId === actor.id && !a.ok).length).toBeGreaterThan(0);
    expect(db().audit.filter((a) => a.action === 'clinic_check_failed').length).toBeGreaterThan(0);
  });

  it('accepted lines of an accepted rebill become approved MIG claims, once', async () => {
    const draft = d.rebills.find((b) => b.status === 'draft' && b.lines.length)!;
    for (const l of draft.lines) l.status = 'accepted';
    draft.status = 'accepted';
    const lineIds = new Set(draft.lines.map((l) => l.registryLineId));
    const before = d.claims.length;
    await nAssist.claimsFromRebill(ctx, draft, 'Test');
    const made = db().claims.filter((c) => c.registryLineId && lineIds.has(c.registryLineId));
    expect(made.length).toBeGreaterThan(0);
    expect(db().claims.length - before).toBe(made.length);
    expect(made.every((c) => c.source === 'assistance' && c.status === 'approved' && c.history.at(-1)?.comment === `Счёт ассистанса ${draft.number}`)).toBe(true);
    await nAssist.claimsFromRebill(ctx, draft, 'Test');
    expect(db().claims.length - before).toBe(made.length);
  });

  it('a termination endorsement ends the contract; a changes endorsement includes the pending requests', async () => {
    const active = d.contracts.find((c) => c.status === 'active')!;
    expect(active).toBeDefined();
    const requests = d.changeRequests.filter((r) => r.contractId === active.id && r.status === 'pending' && !r.endorsementId).map((r) => r.id);
    expect(requests.length).toBeGreaterThan(0);
    {
      const c = (await ctx.repos.contracts.get(active.id))!;
      const e = await nLife.createEndorsement(ctx, c, [], 'termination', '2026-07-01');
      await nLife.applyEndorsement(ctx, e, '2026-06-15');
      expect(db().contracts.find((x) => x.id === active.id)!.status).toBe('terminated');
    }
    resetDb();
    {
      const c = (await ctx.repos.contracts.get(active.id))!;
      const e = await nLife.createEndorsement(ctx, c, await ctx.repos.changeRequests.list({ where: { id: { in: requests } } }), 'changes');
      await nLife.applyEndorsement(ctx, e, '2026-06-15');
      expect(db().changeRequests.filter((r) => requests.includes(r.id)).every((r) => r.status === 'included')).toBe(true);
    }
  });

  it('a contract signed by both sides comes into force by its activation rule', async () => {
    const draft = d.contracts.find((c) => c.status !== 'active' && c.params.paymentSchedule.length)!;
    expect(draft).toBeDefined();
    const sig = { method: 'paper' as const, signedAt: '2026-06-10T10:00:00+05:00', signerName: 'Test' };
    draft.status = 'sent';
    draft.params.startDate = '2026-06-12';
    draft.params.activationRule = 'on_start_date' as never;
    draft.signing = { ...draft.signing, mig: sig, client: sig } as never;
    await nLife.afterSigning(ctx, 'contract', draft.id, 'Test');
    expect(db().contracts.find((c) => c.id === draft.id)!.status).toBe('active');
  });
});
