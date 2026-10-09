/*
 * The background jobs over the in-memory repositories (services/jobRunner.ts): each job is run twice and its action
 * must have happened once; a new occurrence (a new breach, new activity, a new limit) acts again. The clock is the
 * context's `now`.
 */
import { describe, expect, it } from 'vitest';
import { msg } from '@mig/i18n';
import type { KpDocument, SessionUser } from '@mig/contracts';
import { createSeed } from '@mig/seed/seed';
import { randomId } from '../lib/random';
import { DAY, isoDay, tzIso } from '../lib/time';
import type { Db } from '../store/db';
import { memoryRepos } from '../store/memory';
import { ensureRenewalDeal } from './deals';
import { API_JOBS, runApiJob } from './jobRunner';
import { JOBS } from './jobs';
import { SYSTEM_ACTOR, type BaseCtx } from './kernel';
import { createTask, subjectRefs } from './tasks';

const T = Date.parse('2026-06-15T09:30:00+05:00');
const H = 3600_000;

function setup() {
  const d = createSeed({ now: T });
  let now = T;
  const ctx: BaseCtx = { repos: memoryRepos(() => d), now: () => now, env: { demo: false } };
  return { d, ctx, setNow: (ms: number) => void (now = ms) };
}

const notes = (d: Db, text: string) => d.notifications.filter((n) => n.text === text);
const ids = (d: Db, role: string) =>
  d.staff
    .filter((s) => s.role === role && s.active)
    .map((s) => s.id)
    .sort();
const allZero = (summary: Record<string, number>) => Object.values(summary).every((v) => v === 0);

describe('background jobs (memory)', () => {
  it('every api job of the schedule has its service', () => {
    expect(Object.keys(API_JOBS).sort()).toEqual(
      JOBS.filter((j) => j.runner === 'api')
        .map((j) => j.name)
        .sort(),
    );
  });

  it('job marks: an occurrence is claimed once', async () => {
    const { ctx } = setup();
    expect(await ctx.repos.jobMarks.claim('j', 's', 'o1')).toBe(true);
    expect(await ctx.repos.jobMarks.claim('j', 's', 'o1')).toBe(false);
    expect(await ctx.repos.jobMarks.claim('j', 's', 'o2')).toBe(true);
    expect(await ctx.repos.jobMarks.claim('k', 's', 'o1')).toBe(true);
  });

  it('task-deadlines: «Просрочен» goes to the executor and the author once', async () => {
    const { d, ctx, setNow } = setup();
    const author = d.staff.find((s) => s.role === 'sales_manager' && s.active)!;
    const refs = (await subjectRefs(ctx, 'deal', d.deals[0]!.id))!;
    const task = await createTask(
      ctx,
      { id: author.id, displayName: author.fullName },
      {
        action: 'quote_calculate',
        toRole: 'underwriter',
        subjectType: 'deal',
        subjectId: d.deals[0]!.id,
        comment: '',
      },
      refs,
    );
    setNow(Date.parse(task.dueAt) + H);
    const text = msg('next.notify.overdue', {
      what: msg('next.action.quote_calculate'),
      subject: task.subjectLabel,
    });
    expect((await runApiJob(ctx, 'task-deadlines')).notifications).toBeGreaterThan(0);
    const once = notes(d, text).length;
    expect(once).toBeGreaterThan(1);
    expect(await runApiJob(ctx, 'task-deadlines')).toEqual({ notifications: 0 });
    expect(notes(d, text)).toHaveLength(once);
  });

  it('sla-reminders: each breach notifies the responsible people once; a new breach of the same item again', async () => {
    const { d, ctx, setNow } = setup();
    const claim = d.claims.find((c) => c.status === 'new' && c.handledBy !== 'assistance')!;
    claim.slaDueAt = tzIso(T - H);
    delete claim.opinion;
    const g = d.guarantees.find((x) => x.status === 'requested')!;
    Object.assign(g, { createdAt: tzIso(T - 2 * DAY), assistanceId: null, escalated: false });
    const kase = d.cases[0]!;
    Object.assign(kase, { status: 'open', slaDueAt: tzIso(T - H) });
    const appt = d.appointments.find((a) => a.status === 'requested')!;
    Object.assign(appt, { createdAt: tzIso(T - 5 * H), startsAt: tzIso(T + DAY) });
    delete appt.proposedStartsAt;
    const clinic = d.clinics.find((c) => c.id === appt.clinicId)!;
    delete clinic.responseSlaMinutes;
    const person = d.insured.find((i) => i.id === appt.insuredId)!;
    d.assignments = d.assignments.filter((a) => a.policyId !== person.policyId);

    const first = await runApiJob(ctx, 'sla-reminders');
    for (const k of ['claims', 'guarantees', 'appointments', 'cases']) expect(first[k], k).toBeGreaterThan(0);
    const claimText = msg('next.notify.slaClaim', { number: claim.number });
    expect(
      notes(d, claimText)
        .map((n) => n.userId)
        .sort(),
    ).toEqual(ids(d, 'claims_officer'));
    expect(notes(d, claimText).every((n) => n.link === `/staff/claims/${claim.id}`)).toBe(true);
    expect(
      notes(d, msg('next.notify.slaGuarantee', { number: g.number }))
        .map((n) => n.userId)
        .sort(),
    ).toEqual(ids(d, 'doctor_expert'));
    const caseTo = [
      ...d.assistUsers
        .filter(
          (u) =>
            u.assistanceId === kase.assistanceId &&
            u.active &&
            (u.role === 'asst_operator' || u.role === 'asst_doctor'),
        )
        .map((u) => u.id),
      ...ids(d, 'operator'),
    ].sort();
    expect(
      notes(d, msg('next.notify.slaCase', { number: kase.number }))
        .map((n) => n.userId)
        .sort(),
    ).toEqual(caseTo);
    expect(d.jobMarks.filter((m) => m.subject === `appointment:${appt.id}`)).toHaveLength(1);
    const operators = new Set(ids(d, 'operator'));
    expect(
      notes(d, msg('next.notify.slaAppointment', { clinic: appt.clinicName })).some(
        (n) => operators.has(n.userId) && n.link === '/staff/appointments?status=requested',
      ),
    ).toBe(true);

    // A second run, and a later one while nothing changed: nothing new.
    const total = d.notifications.length;
    expect(allZero(await runApiJob(ctx, 'sla-reminders'))).toBe(true);
    expect(d.notifications.length).toBe(total);
    // Later (other items of the seed may breach meanwhile): still nothing more about these.
    const about = () =>
      d.notifications.filter((n) =>
        [
          claimText,
          msg('next.notify.slaGuarantee', { number: g.number }),
          msg('next.notify.slaCase', { number: kase.number }),
        ].includes(n.text),
      ).length;
    const aboutBefore = about();
    setNow(T + 10 * 60_000);
    await runApiJob(ctx, 'sla-reminders');
    expect(about()).toBe(aboutBefore);
    expect(d.jobMarks.filter((m) => m.subject === `appointment:${appt.id}`)).toHaveLength(1);

    // The claim got a new deadline that passed too: a new breach notifies again, once.
    claim.slaDueAt = tzIso(T + H);
    setNow(T + 2 * H);
    expect((await runApiJob(ctx, 'sla-reminders')).claims).toBe(1);
    await runApiJob(ctx, 'sla-reminders');
    expect(notes(d, claimText)).toHaveLength(2 * ids(d, 'claims_officer').length);
    // Personal data never reaches the texts.
    expect(d.notifications.some((n) => n.text.includes(claim.insuredName))).toBe(false);
  });

  it('sales-reminders: an idle lead and an offer without an answer notify the manager once per state', async () => {
    const { d, ctx, setNow } = setup();
    const deal = d.deals.find((x) => x.stage === 'lead')!;
    deal.updatedAt = tzIso(T - 10 * DAY);
    d.dealEvents = d.dealEvents.filter((e) => e.dealId !== deal.id);
    const owner = d.staff.find((s) => s.id === deal.ownerId)!;
    owner.active = true;
    const kp = d.kp.find((k) => k.status === 'sent')!;
    kp.sentAt = tzIso(T - 6 * DAY);
    const client = d.clients.find((c) => c.id === deal.clientId)!;
    const leadText = msg('next.notify.leadIdle', { days: 7, subject: `${deal.number} · ${client.name}` });
    const kpText = msg('next.notify.kpNoAnswer', { number: kp.number, days: 5, client: kp.clientName });

    const first = await runApiJob(ctx, 'sales-reminders');
    expect(first.idleLeads).toBeGreaterThan(0);
    expect(first.offersWithoutAnswer).toBeGreaterThan(0);
    expect(notes(d, leadText).map((n) => [n.userId, n.link])).toEqual([
      [owner.id, `/staff/deals/${deal.id}`],
    ]);
    expect(notes(d, kpText)).toHaveLength(1);
    expect(await runApiJob(ctx, 'sales-reminders')).toEqual({ idleLeads: 0, offersWithoutAnswer: 0 });
    expect(notes(d, leadText)).toHaveLength(1);
    expect(notes(d, kpText)).toHaveLength(1);

    // New activity, then idle again for the whole period: a new reminder.
    d.dealEvents.push({
      id: randomId(),
      dealId: deal.id,
      at: tzIso(T + DAY),
      actorName: owner.fullName,
      text: 'Звонок',
    });
    setNow(T + 3 * DAY);
    expect((await runApiJob(ctx, 'sales-reminders')).idleLeads).toBe(0);
    setNow(T + 9 * DAY);
    expect((await runApiJob(ctx, 'sales-reminders')).idleLeads).toBe(1);
    expect(notes(d, leadText)).toHaveLength(2);
  });

  it('renewal-deals: one renewal deal per expiring policy; a renewal offer joins it', async () => {
    const { d, ctx } = setup();
    const client = d.clients.find(
      (c) => c.activePolicyId && !d.deals.some((x) => x.clientId === c.id && x.type === 'renewal'),
    )!;
    const policy = d.policies.find((p) => p.id === client.activePolicyId)!;
    Object.assign(policy, { status: 'active', endDate: isoDay(T + 20 * DAY) });

    expect((await runApiJob(ctx, 'renewal-deals')).renewalDeals).toBeGreaterThan(0);
    const opened = d.deals.filter((x) => x.previousPolicyId === policy.id);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      type: 'renewal',
      stage: 'lead',
      clientId: client.id,
      expectedStart: isoDay(T + 21 * DAY),
    });
    expect(
      notes(
        d,
        msg('next.notify.renewalDeal', {
          number: opened[0]!.number,
          client: client.name,
          date: policy.endDate.split('-').reverse().join('.'),
        }),
      ).map((n) => n.userId),
    ).toEqual([opened[0]!.ownerId]);
    expect(
      d.audit.filter(
        (a) => a.action === 'lead_created' && a.targetId === opened[0]!.id && a.actorId === SYSTEM_ACTOR.id,
      ),
    ).toHaveLength(1);
    const count = d.deals.length;
    expect(await runApiJob(ctx, 'renewal-deals')).toEqual({ renewalDeals: 0 });
    expect(d.deals.length).toBe(count);

    // The renewal offer sent later (or the client's answer to it) joins the deal: no second one.
    const kp: KpDocument = {
      ...d.kp[0]!,
      id: randomId(),
      clientId: client.id,
      clientName: client.name,
      status: 'sent',
      dealId: undefined,
      policyId: policy.id,
    };
    d.kp.push(kp);
    const manager = d.staff.find((s) => s.id === opened[0]!.ownerId)!;
    await ensureRenewalDeal(ctx, kp, {
      id: manager.id,
      displayName: manager.fullName,
      role: 'sales_manager',
    } as SessionUser);
    expect(d.kp.find((k) => k.id === kp.id)!.dealId).toBe(opened[0]!.id);
    expect(d.deals.length).toBe(count);
    expect(d.deals.find((x) => x.id === opened[0]!.id)!.stage).toBe('kp_sent');

    // A lost renewal deal is not reopened for the same policy.
    d.deals.find((x) => x.id === opened[0]!.id)!.stage = 'lost';
    expect(await runApiJob(ctx, 'renewal-deals')).toEqual({ renewalDeals: 0 });
  });

  it('contract-lifecycle: coming into force and expiry are applied once and audited as the system', async () => {
    const { d, ctx, setNow } = setup();
    const c = d.contracts.find((x) => x.status === 'signing')!;
    c.status = 'signed';
    c.params.activationRule = 'on_start_date';
    c.params.startDate = isoDay(T + DAY);
    c.params.endDate = isoDay(T + 30 * DAY);
    const policiesBefore = d.policies.length;

    await runApiJob(ctx, 'contract-lifecycle');
    setNow(T + 2 * DAY);
    expect((await runApiJob(ctx, 'contract-lifecycle')).activated).toBe(1);
    expect(await runApiJob(ctx, 'contract-lifecycle')).toEqual({
      activated: 0,
      contractsExpired: 0,
      policiesExpired: 0,
      guaranteesExpired: 0,
      invoicesUpdated: 0,
    });
    const active = d.contracts.find((x) => x.id === c.id)!;
    expect(active.status).toBe('active');
    expect(d.policies.length).toBe(policiesBefore + 1);
    const activated = d.audit.filter((a) => a.action === 'contract_activated' && a.targetId === c.id);
    expect(activated).toHaveLength(1);
    expect(activated[0]).toMatchObject({ actorId: SYSTEM_ACTOR.id, actorName: 'Система' });

    // A standalone policy (no contract) past its end date expires too.
    const standalone = d.policies.find(
      (p) => !p.contractId && p.status === 'active' && p.endDate < isoDay(T + 40 * DAY),
    )!;
    setNow(T + 45 * DAY);
    const out = await runApiJob(ctx, 'contract-lifecycle');
    expect(out.contractsExpired).toBe(1);
    expect(out.policiesExpired).toBeGreaterThan(0);
    expect(await runApiJob(ctx, 'contract-lifecycle')).toEqual({
      activated: 0,
      contractsExpired: 0,
      policiesExpired: 0,
      guaranteesExpired: 0,
      invoicesUpdated: 0,
    });
    expect(d.contracts.find((x) => x.id === c.id)!.status).toBe('expired');
    expect(d.policies.find((p) => p.id === active.policyId)!.status).toBe('expired');
    expect(d.policies.find((p) => p.id === standalone.id)!.status).toBe('expired');
    expect(d.audit.filter((a) => a.action === 'contract_expired' && a.targetId === c.id)).toHaveLength(1);
    expect(
      d.audit.filter((a) => a.action === 'policy_expired' && a.targetId === active.policyId),
    ).toHaveLength(1);
    expect(d.audit.filter((a) => a.action === 'policy_expired' && a.targetId === standalone.id)).toHaveLength(
      1,
    );
  });

  it('contract-lifecycle: guarantee letters past their validity expire and invoice statuses follow the date, once', async () => {
    const { d, ctx, setNow } = setup();
    await runApiJob(ctx, 'contract-lifecycle');
    const g = d.guarantees.find((x) => x.status === 'approved' && x.validUntil)!;
    const inv = d.invoices.find((x) => x.status === 'unpaid')!;
    expect(g).toBeDefined();
    expect(inv).toBeDefined();
    // Past both dates: the letter's validity and the invoice's due date.
    const later = Math.max(Date.parse(`${g.validUntil}T12:00:00+05:00`), Date.parse(`${inv.dueDate}T12:00:00+05:00`)) + 2 * DAY;
    setNow(later);
    const out = await runApiJob(ctx, 'contract-lifecycle');
    expect(out.guaranteesExpired).toBeGreaterThanOrEqual(1);
    expect(out.invoicesUpdated).toBeGreaterThanOrEqual(1);
    expect(d.guarantees.find((x) => x.id === g.id)!.status).toBe('expired');
    expect(d.invoices.find((x) => x.id === inv.id)!.status).toBe('overdue');
    const again = await runApiJob(ctx, 'contract-lifecycle');
    expect(again.guaranteesExpired).toBe(0);
    expect(again.invoicesUpdated).toBe(0);
  });

  it('child-age-limit: one request to the underwriter per child and limit, no exclusion', async () => {
    const { d, ctx } = setup();
    const child = d.insured.find((i) => i.relation === 'child')!;
    Object.assign(child, { status: 'active', isStudent: false, birthDate: '2008-03-01' });
    d.policyChanges = d.policyChanges.filter((c) => c.insuredId !== child.id);
    const mine = () => d.tasks.filter((t) => t.link === `/staff/insured/${child.id}`);

    expect((await runApiJob(ctx, 'child-age-limit')).ageLimitRequests).toBeGreaterThan(0);
    expect(mine()).toHaveLength(1);
    expect(mine()[0]).toMatchObject({
      toRole: 'underwriter',
      status: 'open',
      createdById: SYSTEM_ACTOR.id,
      subjectType: 'client',
      subjectId: child.clientId,
    });
    expect(mine()[0]!.comment).not.toContain(child.fullName);
    expect(await runApiJob(ctx, 'child-age-limit')).toEqual({ ageLimitRequests: 0 });
    expect(mine()).toHaveLength(1);
    expect(d.insured.find((i) => i.id === child.id)!.status).toBe('active');
    expect(d.notifications.some((n) => n.userId === SYSTEM_ACTOR.id)).toBe(false);

    // A student has a limit of its own: reaching it is a new request.
    Object.assign(child, { isStudent: true, birthDate: '2000-01-01' });
    expect((await runApiJob(ctx, 'child-age-limit')).ageLimitRequests).toBe(1);
    expect(await runApiJob(ctx, 'child-age-limit')).toEqual({ ageLimitRequests: 0 });
    expect(mine()).toHaveLength(2);
  });
});
