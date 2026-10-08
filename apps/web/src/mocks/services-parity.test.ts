// @vitest-environment node
/*
 * The async services (packages/domain/src/services) against the mock's sync cores they replace: on the
 * same demo database, every ported module answers exactly as its original.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@mig/contracts';
import type { BaseCtx } from '@mig/domain/services/kernel';
import { loadParams } from '@mig/domain/services/params';
import { memoryRepos } from '@mig/domain/store/memory';
import * as nViews from '@mig/domain/services/views';
import * as nFamily from '@mig/domain/services/family';
import * as nSettlement from '@mig/domain/services/settlement';
import * as nAssist from '@mig/domain/services/assistance';
import * as nClinic from '@mig/domain/services/clinic';
import * as nPolicy from '@mig/domain/services/policy';
import * as nLife from '@mig/domain/services/lifecycle';
import * as nFamilyReq from '@mig/domain/services/familyRequests';
import { db, resetDb, type Db } from './db';
import { initMockDb } from './setup';
import * as oViews from './views';
import * as oFamily from './family-core';
import * as oSettlement from './settlement-core';
import * as oAssist from './assistance-core';
import * as oClinic from './clinic-core';
import * as oPolicy from './policy-core';
import * as oLife from './lifecycle-core';
import * as oFamilyReq from './family-requests';

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

const copy = <T>(v: T): T => structuredClone(v);
/** A sample of rows: the first ones, a middle one and the last one. */
function sample<T>(rows: readonly T[], n = 6): T[] {
  if (rows.length <= n) return [...rows];
  return [...rows.slice(0, n - 2), rows[Math.floor(rows.length / 2)]!, rows.at(-1)!];
}
function staffUser(role: SessionUser['role']): SessionUser {
  const s = d.staff.find((x) => x.role === role && x.active)!;
  return { id: s.id, role: s.role, displayName: s.fullName } as SessionUser;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/**
 * The database with every id replaced by its order of first appearance: two databases built by the same
 * steps compare equal although the seed and the steps made their ids with randomId().
 */
function canon(value: unknown): unknown {
  const seen = new Map<string, string>();
  const text = JSON.stringify(value).replace(UUID, (id) => {
    if (!seen.has(id)) seen.set(id, `#${seen.size}`);
    return seen.get(id)!;
  });
  // Webhook signatures sign bodies with those random ids.
  return JSON.parse(text.replace(/v1=[0-9a-f]{64}/g, 'v1=…'));
}

describe('views', () => {
  it('clients, insured persons, HR employees and legal forms', async () => {
    const P = await loadParams(ctx);
    for (const c of sample(d.clients)) {
      expect(await nViews.toClient(ctx, copy(c))).toEqual(oViews.toClient(d, c));
      expect(await nViews.insuredCountFor(ctx, c.id)).toBe(oViews.insuredCountFor(d, c.id));
      expect(await nViews.clientLegalFormOf(ctx, c.id)).toEqual(oViews.clientLegalFormOf(d, c.id));
    }
    const user = staffUser('claims_officer');
    const people = [...sample(d.insured, 10), ...sample(d.insured.filter((i) => i.relation !== 'employee'), 6)];
    for (const i of people) {
      expect(await nViews.toInsured(ctx, copy(i), P)).toEqual(oViews.toInsured(d, i));
      expect(await nViews.toInsuredDetail(ctx, copy(i))).toEqual(oViews.toInsuredDetail(d, i));
      expect(await nViews.toInsuredListItem(ctx, copy(i), user)).toEqual(oViews.toInsuredListItem(d, i, user));
      expect(await nViews.toHrEmployee(ctx, copy(i))).toEqual(oViews.toHrEmployee(d, i));
    }
    for (const c of sample(d.clinics)) expect(await nViews.clinicLegalFormOf(ctx, c.id)).toEqual(oViews.clinicLegalFormOf(d, c.id));
    for (const a of d.assistances) expect(await nViews.assistanceLegalFormOf(ctx, a.id)).toEqual(oViews.assistanceLegalFormOf(d, a.id));
  });

  it('limits (individual and family-shared), claim details and the insured view of a claim', async () => {
    const withClaims = [...new Set(d.claims.map((c) => c.insuredId))].map((id) => d.insured.find((i) => i.id === id)!);
    const withLetters = [...new Set(d.guarantees.map((g) => g.insuredId))].map((id) => d.insured.find((i) => i.id === id)!).filter(Boolean);
    for (const i of [...sample(withClaims, 10), ...sample(withLetters, 6), ...sample(d.insured, 4)]) {
      expect(await nViews.limitsFor(ctx, copy(i))).toEqual(oViews.limitsFor(d, i));
    }
    d.dmsParams.values.limitMode = { value: 1, changedAt: '2026-01-01T00:00:00+05:00', changedByName: 'test' };
    const families = d.insured.filter((i) => i.principalId);
    for (const i of sample(families, 6)) expect(await nViews.limitsFor(ctx, copy(i))).toEqual(oViews.limitsFor(d, i));
    delete d.dmsParams.values.limitMode;
    const officer = staffUser('claims_officer');
    for (const c of sample(d.claims, 12)) {
      const i = d.insured.find((x) => x.id === c.insuredId)!;
      expect(await nViews.toClaimDetail(ctx, copy(c), officer)).toEqual(oViews.toClaimDetail(d, c, officer));
      expect(nViews.toClaimListItem(copy(c))).toEqual(oViews.toClaimListItem(c));
      expect(await nViews.toMyClaim(ctx, copy(c), copy(i))).toEqual(oViews.toMyClaim(d, c, i));
    }
  });
});

describe('family', () => {
  it('family, principal, payout card, access and premium', async () => {
    const employees = d.insured.filter((i) => i.relation === 'employee' && d.insured.some((m) => m.principalId === i.id));
    for (const e of sample(employees, 8)) {
      expect(await nFamily.familyOf(ctx, e.id)).toEqual(oFamily.familyOf(d, e.id));
      expect(await nFamily.familyBrief(ctx, copy(e))).toEqual(oFamily.familyBrief(d, e));
      for (const m of oFamily.familyOf(d, e.id)) {
        expect(await nFamily.principalOf(ctx, m)).toEqual(oFamily.principalOf(d, m));
        expect(await nFamily.payoutCardOf(ctx, copy(m))).toEqual(oFamily.payoutCardOf(d, m));
        expect(await nFamily.accessOf(ctx, copy(e), copy(m))).toBe(oFamily.accessOf(d, e, m));
        expect(await nFamily.accessOf(ctx, copy(m), copy(e))).toBe(oFamily.accessOf(d, m, e));
        expect(await nFamily.hasConsent(ctx, m.id, e.id)).toBe(oFamily.hasConsent(d, m.id, e.id));
        const P = await loadParams(ctx);
        expect(nFamily.isDependent(m, nFamily.todayIso(ctx), P)).toBe(oFamily.isDependent(m));
      }
    }
    for (const c of d.familyConsents) expect(await nFamily.hasConsent(ctx, c.ownerId, c.viewerId)).toBe(oFamily.hasConsent(d, c.ownerId, c.viewerId));
    for (const p of sample(d.policies, 8)) {
      for (const person of [{ relation: 'employee' as const, birthDate: '1985-04-01' }, { relation: 'child' as const, birthDate: '2015-04-01' }]) {
        let expected: unknown;
        try {
          expected = oFamily.annualPremiumOf(d, p, person, p.startDate);
        } catch (e) {
          expected = e;
        }
        if (expected instanceof Error) await expect(nFamily.annualPremiumOf(ctx, p, person, p.startDate)).rejects.toEqual(expected);
        else expect(await nFamily.annualPremiumOf(ctx, p, person, p.startDate)).toBe(expected);
      }
    }
    const e = employees[0]!;
    const m = oFamily.familyOf(d, e.id)[0]!;
    expect((await nFamily.personFor(ctx, copy(e), m.id, 'card')).person.id).toBe(oFamily.personFor(d, e, m.id, 'card').person.id);
    const other = d.insured.find((i) => i.relation === 'employee' && i.id !== e.id)!;
    await expect(nFamily.personFor(ctx, copy(other), m.id, 'card')).rejects.toMatchObject({ status: 404 });
    expect(() => oFamily.personFor(d, other, m.id, 'card')).toThrow();
  });
});

describe('settlement', () => {
  it('who handles reimbursements, reserves and fraud flags', async () => {
    for (const p of d.policies) expect(await nSettlement.handlerOf(ctx, p.id)).toBe(oSettlement.handlerOf(d, p.id));
    for (const c of sample(d.claims, 10)) {
      expect(nSettlement.reserveTimeline(c)).toEqual(oSettlement.reserveTimeline(c));
      expect(nSettlement.currentReserve(c)).toBe(oSettlement.currentReserve(c));
      const mine = copy(c);
      const flags = await nSettlement.refreshFlags(ctx, mine);
      const old = oSettlement.refreshFlags(d, copy(c));
      expect(flags.map((f) => [f.code, f.message])).toEqual(old.map((f) => [f.code, f.message]));
      // Saved with the claim.
      expect(d.claims.find((x) => x.id === c.id)!.flags).toEqual(flags);
    }
  });
});

describe('assistance', () => {
  it('scope, roster, payers, limit extras, rebill checks, fees and KPI', async () => {
    for (const p of d.policies) expect(await nAssist.currentAssistance(ctx, p.id)).toBe(oAssist.currentAssistance(d, p.id));
    for (const a of d.assistances) {
      expect(await nAssist.assistanceName(ctx, a.id)).toBe(oAssist.assistanceName(d, a.id));
      expect(await nAssist.rosterOf(ctx, a.id)).toEqual(oAssist.rosterOf(d, a.id));
      for (const i of sample(d.insured, 8)) expect(await nAssist.insuredAccess(ctx, a.id, copy(i))).toBe(oAssist.insuredAccess(d, a.id, i));
      expect(await nAssist.kpiOf(ctx, a, NOW)).toEqual(oAssist.kpiOf(d, a, NOW));
      for (const period of ['2026-04', '2026-05', '2026-06']) {
        expect(await nAssist.rebillCandidates(ctx, a.id, period)).toEqual(oAssist.rebillCandidates(d, a.id, period));
        expect(await nAssist.feeOf(ctx, a, period, 1_000_000)).toEqual(oAssist.feeOf(d, a, period, 1_000_000));
      }
    }
    for (const r of d.registries) {
      for (const l of r.lines) expect(await nAssist.payerOfLine(ctx, l)).toBe(oAssist.payerOfLine(d, l));
      expect(await nAssist.findRegistryLine(ctx, r.lines[0]?.id ?? 'x')).toEqual(oAssist.findRegistryLine(d, r.lines[0]?.id ?? 'x'));
    }
    const visited = [...new Set(d.visits.map((v) => v.insuredId))].map((id) => d.insured.find((i) => i.id === id)!).filter(Boolean);
    for (const i of [...sample(visited, 10), ...sample(d.insured, 4)]) {
      const from = Date.parse('2026-01-01T00:00:00+05:00');
      expect(await nAssist.limitExtras(ctx, copy(i), from)).toEqual(oAssist.limitExtras(d, i, from));
    }
    for (const b of d.rebills) {
      for (const l of b.lines) expect(await nAssist.checksFor(ctx, b, l)).toEqual(oAssist.checksFor(d, b, l));
    }
  });
});

describe('clinic', () => {
  it('price lists, coverage, guarantees, registries, appointments and claim numbers', async () => {
    for (const c of d.clinics) {
      expect(await nClinic.priceListOf(ctx, c.id)).toEqual(oClinic.priceListOf(d, c.id));
      for (const a of d.assistances) expect(await nClinic.priceListOf(ctx, c.id, a.id)).toEqual(oClinic.priceListOf(d, c.id, a.id));
      expect(await nClinic.clinicResponseMinutes(ctx, c.id)).toBe(oClinic.clinicResponseMinutes(d, c.id));
    }
    for (const v of sample(d.visits, 8)) expect(await nClinic.coverageFor(ctx, v)).toEqual(oClinic.coverageFor(d, v));
    for (const g of d.guarantees) {
      expect(await nClinic.toGuaranteeView(ctx, copy(g))).toEqual(oClinic.toGuaranteeView(d, g));
      expect(await nClinic.toGuaranteeLetter(ctx, copy(g))).toEqual(oClinic.toGuaranteeLetter(g));
    }
    for (const r of d.registries) {
      expect(await nClinic.toRegistryView(ctx, copy(r))).toEqual(oClinic.toRegistryView(d, r));
      expect(await nClinic.toRegistrySummary(ctx, copy(r))).toEqual(oClinic.toRegistrySummary(d, r));
      for (const l of r.lines) expect(await nClinic.lineProblems(ctx, r.clinicId, copy(l))).toEqual(oClinic.lineProblems(d, r.clinicId, l));
    }
    for (const a of sample(d.appointments, 10)) expect(await nClinic.isOverdueRequest(ctx, a, NOW)).toBe(oClinic.isOverdueRequest(d, a, NOW));
    expect(await nClinic.nextClaimNumber(ctx)).toBe(oClinic.nextClaimNumber(d));
  });
});

describe('policy', () => {
  it('active policy, numbers, endorsement documents and the list parser', async () => {
    for (const c of sample(d.clients, 10)) expect(await nPolicy.activePolicyOf(ctx, copy(c))).toEqual(oPolicy.activePolicyOf(d, c));
    for (const year of [2025, 2026, 2027]) expect(await nPolicy.nextPolicyNumber(ctx, year)).toBe(oPolicy.nextPolicyNumber(d, year));
    for (const p of sample(d.policies)) {
      const { id: _a, ...mine } = await nPolicy.endorsementDoc(ctx, p, 2, 1, -150000, '2026-06-15');
      const { id: _b, ...old } = oPolicy.endorsementDoc(d, p, 2, 1, -150000, '2026-06-15');
      expect(mine).toEqual(old);
    }
    const csv = 'fullName,birthDate,pinfl,phone,position,relation,principal_pinfl\nТестов Тест Тестович,15.03.1990,31503900000001,901112233,Инженер,,';
    expect(nPolicy.parsePolicyList(csv)).toEqual(oPolicy.parsePolicyList(csv));
    for (const ch of sample(d.policyChanges)) expect(nPolicy.toPolicyChange(ch)).toEqual(oPolicy.toPolicyChange(ch));
  });
});

describe('lifecycle', () => {
  it('deal views, contracts, checklists, signatories and endorsement lines', async () => {
    for (const deal of d.deals) {
      expect(await nLife.toDealView(ctx, copy(deal))).toEqual(oLife.toDealView(d, deal));
      expect(await nLife.checklistInput(ctx, copy(deal))).toEqual(oLife.checklistInput(d, deal));
      expect(await nLife.dealContract(ctx, deal.id)).toEqual(oLife.dealContract(d, deal.id));
      expect(await nLife.dealKp(ctx, deal.id)).toEqual(oLife.dealKp(d, deal.id));
      expect(await nLife.latestQuote(ctx, deal.id)).toEqual(oLife.latestQuote(d, deal.id));
    }
    expect(await nLife.signatories(ctx)).toEqual(oLife.signatories(d));
    expect(await nLife.nextInvoiceNumber(ctx)).toBe(oLife.nextInvoiceNumber(d));
    for (const c of d.contracts) {
      expect(await nLife.nextEndorsementNumber(ctx, c)).toBe(oLife.nextEndorsementNumber(d, c));
      expect(await nLife.pendingRequests(ctx, c.id)).toEqual(oLife.pendingRequests(d, c.id));
      const requests = d.changeRequests.filter((r) => r.contractId === c.id);
      if (requests.length) expect(await nLife.endorsementLines(ctx, c, requests)).toEqual(oLife.endorsementLines(d, c, requests));
      const ids = d.insured.filter((i) => i.contractId === c.id).map((i) => i.id);
      expect(await nLife.claimsPaidFor(ctx, ids, c.params.startDate)).toBe(oLife.claimsPaidFor(d, ids, c.params.startDate));
    }
    const allIds = d.insured.map((i) => i.id);
    expect(await nLife.claimsPaidFor(ctx, allIds, '2025-01-01')).toBe(oLife.claimsPaidFor(d, allIds, '2025-01-01'));
  });
});

describe('family requests', () => {
  it('HR family list, requests and employees of a company', async () => {
    for (const c of sample(d.clients, 10)) {
      expect(await nFamilyReq.hrFamilyList(ctx, c.id)).toEqual(oFamilyReq.hrFamilyList(d, c.id));
      const e = d.insured.find((i) => i.clientId === c.id && i.relation === 'employee');
      if (e) {
        expect(await nFamilyReq.hrFamilyList(ctx, c.id, e.id)).toEqual(oFamilyReq.hrFamilyList(d, c.id, e.id));
        expect(await nFamilyReq.employeeOfCompany(ctx, c.id, e.id)).toEqual(oFamilyReq.employeeOfCompany(d, c.id, e.id));
      }
    }
    for (const r of d.familyRequests) expect(await nFamilyReq.toFamilyRequest(ctx, r)).toEqual(oFamilyReq.toFamilyRequest(d, r));
  });
});

describe('write paths leave the same database', () => {
  /** Runs the old operation, then (on a fresh database) the new one, and compares the databases. */
  async function same(old: (d: Db) => unknown, next: () => Promise<unknown>): Promise<void> {
    resetDb();
    await old(db());
    const a = canon(db());
    resetDb();
    await next();
    const b = canon(db()) as Record<string, unknown>;
    // Table by table, so a difference names its table.
    for (const [name, rows] of Object.entries(a as Record<string, unknown>)) expect({ [name]: b[name] }).toEqual({ [name]: rows });
  }

  it('family add request (policy change)', async () => {
    const client = d.clients.find((c) => c.activePolicyId && d.insured.some((i) => i.clientId === c.id && i.relation === 'employee' && i.status === 'active'))!;
    const employee = d.insured.find((i) => i.clientId === client.id && i.relation === 'employee' && i.status === 'active')!;
    const actor = { id: employee.id, displayName: 'HR' };
    const person = { fullName: 'Test  Child', birthDate: '2016-02-01', pinfl: '30102169999999', relation: 'child' as const, startDate: '2026-07-01' };
    await same(
      (x) => {
        try {
          oFamilyReq.requestFamilyAdd(x, actor, x.clients.find((c) => c.id === client.id)!, x.insured.find((i) => i.id === employee.id)!, person);
        } catch {
          /* the same error is expected from the service */
        }
      },
      async () => {
        await nFamilyReq.requestFamilyAdd(ctx, actor, (await ctx.repos.clients.get(client.id))!, (await ctx.repos.insured.get(employee.id))!, person).catch(() => undefined);
      },
    );
    expect(db().policyChanges.some((c) => c.newPerson?.pinfl === person.pinfl)).toBe(true);
  });

  it('assistance cache, QA sample and draft rebills', async () => {
    await same(
      (x) => {
        x.assignments.push({ policyId: x.policies[0]!.id, assistanceId: x.assistances[0]!.id, from: '2026-06-01', setById: x.staff[0]!.id, setAt: '2026-06-01T00:00:00+05:00' });
        oAssist.syncAssistance(x);
        oAssist.ensureQaSample(x);
      },
      async () => {
        const x = db();
        x.assignments.push({ policyId: x.policies[0]!.id, assistanceId: x.assistances[0]!.id, from: '2026-06-01', setById: x.staff[0]!.id, setAt: '2026-06-01T00:00:00+05:00' });
        await nAssist.syncAssistance(ctx);
        await nAssist.ensureQaSample(ctx);
      },
    );
    let drafts = 0;
    for (const a of d.assistances) {
      for (const period of ['2026-04', '2026-05', '2026-06']) {
        await same(
          (x) => {
            try {
              oAssist.upsertDraftRebill(x, a.id, period);
            } catch {
              /* compared below */
            }
          },
          () => nAssist.upsertDraftRebill(ctx, a.id, period).catch(() => undefined),
        );
        drafts += db().rebills.filter((b) => b.status === 'draft' && b.lines.length).length;
      }
    }
    expect(drafts).toBeGreaterThan(0);
  });

  it('patient checks with failures, appointments, claims from registry lines and from a rebill', async () => {
    const u = d.clinicUsers.find((x) => x.active)!;
    const actor = { id: u.id, clinicId: u.clinicId, displayName: u.fullName, role: u.role as SessionUser['role'] };
    const person = d.insured.find((i) => i.status === 'active' && d.policies.some((p) => p.id === i.policyId && p.status === 'active'))!;
    const policyNumber = d.policies.find((p) => p.id === person.policyId)!.number.toLowerCase();
    const wrong = { policyNumber, pinfl: '00000000000000' };
    await same(
      () => {
        oClinic.checkPatient({ policyNumber, pinfl: person.pinfl }, actor, 'portal');
        for (let k = 0; k < 8; k++) {
          try {
            oClinic.checkPatient(wrong, actor, 'api');
          } catch {
            /* rejected (then locked) the same way below */
          }
        }
      },
      async () => {
        await nClinic.checkPatient(ctx, { policyNumber, pinfl: person.pinfl }, actor, 'portal');
        for (let k = 0; k < 8; k++) await nClinic.checkPatient(ctx, wrong, actor, 'api').catch(() => undefined);
      },
    );
    expect(db().checkAttempts.filter((a) => a.userId === actor.id && !a.ok).length).toBeGreaterThan(0);
    expect(db().audit.filter((a) => a.action === 'clinic_check_failed').length).toBeGreaterThan(0);
    const clinic = d.clinics.find((c) => c.specialties.length)!;
    const input = { clinicId: clinic.id, specialty: clinic.specialties[0]!, startsAt: '2026-06-20T10:00:00+05:00' };
    await same(
      (x) => oClinic.createAppointment(x, x.insured.find((i) => i.id === person.id)!, input),
      async () => nClinic.createAppointment(ctx, (await ctx.repos.insured.get(person.id))!, input),
    );
    const lines = d.registries.flatMap((r) => r.lines.filter((l) => l.status === 'accepted').map((l) => ({ r, l })));
    expect(lines.length).toBeGreaterThan(0);
    await same(
      (x) => {
        for (const { r, l } of lines) oClinic.claimFromLine(x, r, l, 'Test');
      },
      async () => {
        for (const { r, l } of lines) await nClinic.claimFromLine(ctx, r, l, 'Test');
      },
    );
    const draft = d.rebills.find((b) => b.status === 'draft' && b.lines.length)!;
    const accept = (x: Db) => {
      const b = x.rebills.find((y) => y.id === draft.id)!;
      for (const l of b.lines) l.status = 'accepted';
      b.status = 'accepted';
      return b;
    };
    await same(
      (x) => oAssist.claimsFromRebill(x, accept(x), 'Test'),
      async () => nAssist.claimsFromRebill(ctx, accept(db()), 'Test'),
    );
  });

  it('contract signing to coming into force, endorsements and termination', async () => {
    const active = d.contracts.find((c) => c.status === 'active');
    for (const c of d.contracts) await same((x) => oLife.refreshContract(x, x.contracts.find((y) => y.id === c.id)!), async () => nLife.refreshContract(ctx, (await ctx.repos.contracts.get(c.id))!));
    if (active) {
      await same(
        async (x) => {
          const c = x.contracts.find((y) => y.id === active.id)!;
          const e = oLife.createEndorsement(x, c, [], 'termination', '2026-07-01');
          await oLife.applyEndorsement(x, e, '2026-06-15');
        },
        async () => {
          const c = (await ctx.repos.contracts.get(active.id))!;
          const e = await nLife.createEndorsement(ctx, c, [], 'termination', '2026-07-01');
          await nLife.applyEndorsement(ctx, e, '2026-06-15');
        },
      );
      expect(db().contracts.find((c) => c.id === active.id)!.status).toBe('terminated');
      const requests = d.changeRequests.filter((r) => r.contractId === active.id && r.status === 'pending' && !r.endorsementId).map((r) => r.id);
      expect(requests.length).toBeGreaterThan(0);
      await same(
        async (x) => {
          const c = x.contracts.find((y) => y.id === active.id)!;
          const e = oLife.createEndorsement(x, c, x.changeRequests.filter((r) => requests.includes(r.id)), 'changes');
          await oLife.applyEndorsement(x, e, '2026-06-15');
        },
        async () => {
          const c = (await ctx.repos.contracts.get(active.id))!;
          const e = await nLife.createEndorsement(ctx, c, await ctx.repos.changeRequests.list({ where: { id: { in: requests } } }), 'changes');
          await nLife.applyEndorsement(ctx, e, '2026-06-15');
        },
      );
      expect(db().changeRequests.filter((r) => requests.includes(r.id)).every((r) => r.status === 'included')).toBe(true);
    }
    expect(active).toBeDefined();
    // A contract signed by both sides: invoices, and it comes into force by its activation rule.
    const draft = d.contracts.find((c) => c.status !== 'active' && c.params.paymentSchedule.length);
    if (draft) {
      const sign = (x: Db) => {
        const c = x.contracts.find((y) => y.id === draft.id)!;
        const at = '2026-06-10T10:00:00+05:00';
        const sig = { method: 'paper' as const, signedAt: at, signerName: 'Test' };
        c.status = 'sent';
        c.params.startDate = '2026-06-12';
        c.params.activationRule = 'on_start_date' as never;
        c.signing = { ...c.signing, mig: sig, client: sig } as never;
      };
      await same(
        async (x) => {
          sign(x);
          await oLife.afterSigning(x, 'contract', draft.id, 'Test');
        },
        async () => {
          sign(db());
          await nLife.afterSigning(ctx, 'contract', draft.id, 'Test');
        },
      );
      expect(db().contracts.find((c) => c.id === draft.id)!.status).toBe('active');
    }
  });
});
