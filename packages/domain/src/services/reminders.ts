/*
 * Reminders of the background jobs (BACKEND_SPEC §10, services/jobs.ts): the responsible people get an in-app
 * notification (the bell) about what breached its deadline. Each reminder goes once per item and occurrence
 * (`jobMarks`): a later run finds the mark and stays silent; a new breach of the same item (a new SLA date, a new
 * activity of the deal that went idle again, an offer sent anew) is a new occurrence and notifies again.
 *
 * Who is responsible follows the work queues of the dashboard (services/dashboard.ts): nobody is assigned to claims,
 * letters, appointments or cases, so the role's queue is notified — every active employee of the role at MIG, or the
 * users of the assistance company that serves the person. Deals and offers go to the deal's manager.
 *
 * Texts are packed keys (`next.notify.*`) with numbers and company names only: no personal data.
 */
import { msg } from '@mig/i18n';
import type { AssistanceRole, StaffRole, UUID } from '@mig/contracts';
import { assistanceOn } from '../assistance';
import { ageLimitDate, childAgeLimit, reachedAgeLimit } from '../family';
import { DAY, isoDay, parseIso } from '../lib/time';
import { isOverdueRequestOf } from './clinic';
import { isOverdue, lastActivity } from './dashboard';
import { ageLimits } from './family';
import { SYSTEM_ACTOR, type BaseCtx } from './kernel';
import { loadParams } from './params';
import { createTask, notify, subjectRefs } from './tasks';

/** Active MIG employees of a role (the role's queue). */
export async function staffOfRole(ctx: BaseCtx, role: StaffRole): Promise<UUID[]> {
  return (await ctx.repos.staff.list({ where: { role, active: true } })).map((s) => s.id);
}

/** Active users of an assistance company with one of the roles. */
async function assistUsersOf(
  ctx: BaseCtx,
  assistanceId: UUID,
  roles: readonly AssistanceRole[],
): Promise<UUID[]> {
  return (
    await ctx.repos.assistUsers.list({ where: { assistanceId, role: { in: roles }, active: true } })
  ).map((u) => u.id);
}

/** The person if active MIG staff, else nobody. */
async function activeStaff(ctx: BaseCtx, id: UUID | undefined): Promise<UUID[]> {
  const s = id ? await ctx.repos.staff.get(id) : null;
  return s?.active ? [s.id] : [];
}

/** One notification to each recipient, once per (job, subject, occurrence). True when it went out now. */
export async function notifyOnce(
  ctx: BaseCtx,
  mark: { job: string; subject: string; occurrence: string },
  recipients: readonly { ids: readonly UUID[]; link: string }[],
  text: string,
): Promise<boolean> {
  // Nobody to tell (no active employee of the role yet): no mark, a later run tells the one who comes.
  if (!recipients.some((r) => r.ids.length)) return false;
  if (!(await ctx.repos.jobMarks.claim(mark.job, mark.subject, mark.occurrence))) return false;
  const told = new Set<UUID>();
  for (const r of recipients) {
    for (const id of r.ids) {
      if (told.has(id)) continue;
      told.add(id);
      await notify(ctx, id, text, r.link);
    }
  }
  return true;
}

const SLA = 'sla-reminders';
/** The work queues give a guarantee letter a day for the decision and an appeal five days (services/dashboard.ts). */
const GUARANTEE_DECISION_MS = DAY;
const APPEAL_MS = 5 * DAY;

/**
 * SLA of claims (and their doctor's opinions and appeals), guarantee letters, appointment requests the clinic left
 * unanswered and assistance cases. Returns how many reminders went out per kind.
 */
export async function slaReminders(ctx: BaseCtx): Promise<Record<string, number>> {
  const now = ctx.now();
  const P = await loadParams(ctx);
  const out = { claims: 0, appeals: 0, guarantees: 0, appointments: 0, cases: 0 };
  // The recipients of a queue, read once per run.
  const cache = new Map<string, Promise<UUID[]>>();
  const once = (key: string, read: () => Promise<UUID[]>) => {
    let ids = cache.get(key);
    if (!ids) cache.set(key, (ids = read()));
    return ids;
  };
  const ofRole = (role: StaffRole) => once(role, () => staffOfRole(ctx, role));
  const ofAssistance = (id: UUID, roles: readonly AssistanceRole[]) =>
    once(`${id}:${roles.join()}`, () => assistUsersOf(ctx, id, roles));

  // Claims MIG settles (the assistance settles its own outside MIG's queues).
  const claims = (await ctx.repos.claims.list()).filter((c) => c.handledBy !== 'assistance');
  for (const c of claims) {
    if (isOverdue(c, now)) {
      // A requested doctor's opinion holds the claim: the doctors' queue; otherwise the claims officers'.
      const opinion = !!c.opinion && !c.opinion.text;
      const role: StaffRole = opinion ? 'doctor_expert' : 'claims_officer';
      const text = msg(opinion ? 'next.notify.slaOpinion' : 'next.notify.slaClaim', { number: c.number });
      const sent = await notifyOnce(
        ctx,
        { job: SLA, subject: `claim:${c.id}`, occurrence: `${c.slaDueAt}:${role}` },
        [{ ids: await ofRole(role), link: `/staff/claims/${c.id}` }],
        text,
      );
      if (sent) out.claims += 1;
    }
  }
  for (const c of claims) {
    if (c.appeal?.status !== 'open' || now - parseIso(c.appeal.at) <= APPEAL_MS) continue;
    const sent = await notifyOnce(
      ctx,
      { job: SLA, subject: `appeal:${c.id}`, occurrence: c.appeal.at },
      [{ ids: await ofRole('claims_officer'), link: `/staff/claims/${c.id}` }],
      msg('next.notify.slaAppeal', { number: c.number }),
    );
    if (sent) out.appeals += 1;
  }

  // Guarantee letters: the assistance decides its own; MIG — escalations and letters of clients without one.
  for (const g of await ctx.repos.guarantees.list({ where: { status: 'requested' } })) {
    if (now - parseIso(g.createdAt) <= GUARANTEE_DECISION_MS) continue;
    const byAssistance = !!g.assistanceId && !g.escalated;
    const to = byAssistance
      ? {
          ids: await ofAssistance(g.assistanceId!, ['asst_doctor']),
          link: `/assist/guarantees/${g.id}`,
        }
      : { ids: await ofRole('doctor_expert'), link: '/staff/guarantees' };
    const sent = await notifyOnce(
      ctx,
      {
        job: SLA,
        subject: `guarantee:${g.id}`,
        occurrence: `${byAssistance ? 'assistance' : 'mig'}:${g.createdAt}`,
      },
      [to],
      msg('next.notify.slaGuarantee', { number: g.number }),
    );
    if (sent) out.guarantees += 1;
  }

  // Appointment requests the clinic did not answer in time: the operator who serves the person steps in.
  const requested = await ctx.repos.appointments.list({ where: { status: 'requested' } });
  if (requested.length) {
    const today = isoDay(now);
    const assignments = await ctx.repos.assignments.list();
    const clinics = new Map((await ctx.repos.clinics.list()).map((c) => [c.id, c]));
    const people = new Map(
      (
        await ctx.repos.insured.select(['id', 'policyId'], {
          where: { id: { in: [...new Set(requested.map((a) => a.insuredId))] } },
        })
      ).map((i) => [i.id, i]),
    );
    for (const a of requested) {
      // A request whose time has passed is no longer a reminder (the queues drop it an hour after).
      if (parseIso(a.startsAt) < now - 3600_000 || !isOverdueRequestOf(a, clinics.get(a.clinicId), now, P))
        continue;
      const person = people.get(a.insuredId);
      const assistanceId = person ? assistanceOn(assignments, person.policyId, today) : null;
      const to = assistanceId
        ? { ids: await ofAssistance(assistanceId, ['asst_operator']), link: '/assist/appointments' }
        : { ids: await ofRole('operator'), link: '/staff/appointments?status=requested' };
      const sent = await notifyOnce(
        ctx,
        { job: SLA, subject: `appointment:${a.id}`, occurrence: a.createdAt },
        [to],
        msg('next.notify.slaAppointment', { clinic: a.clinicName }),
      );
      if (sent) out.appointments += 1;
    }
  }

  // Assistance cases past their SLA: the company's operators and doctors, and MIG's operators who watch the SLA.
  const migOperators = await ofRole('operator');
  for (const c of await ctx.repos.cases.list({ where: { status: { ne: 'resolved' } } })) {
    if (parseIso(c.slaDueAt) >= now) continue;
    const sent = await notifyOnce(
      ctx,
      { job: SLA, subject: `case:${c.id}`, occurrence: c.slaDueAt },
      [
        {
          ids: await ofAssistance(c.assistanceId, ['asst_operator', 'asst_doctor']),
          link: `/assist/cases/${c.id}`,
        },
        { ids: migOperators, link: `/staff/assistance/${c.assistanceId}` },
      ],
      msg('next.notify.slaCase', { number: c.number }),
    );
    if (sent) out.cases += 1;
  }
  return out;
}

const SALES = 'sales-reminders';

/**
 * Leads without activity for `leadIdleDays` and offers without the client's answer for `kpNoAnswerDays`: the deal's
 * manager (the offer's: the deal's, else the client's manager, else its author). Once per lead and its last
 * activity, once per offer and its sending.
 */
export async function salesReminders(ctx: BaseCtx): Promise<Record<string, number>> {
  const now = ctx.now();
  const P = await loadParams(ctx);
  const idleDays = P.dmsParam('leadIdleDays');
  const noAnswerDays = P.dmsParam('kpNoAnswerDays');
  const out = { idleLeads: 0, offersWithoutAnswer: 0 };
  for (const deal of await ctx.repos.deals.list({ where: { stage: 'lead' } })) {
    const last = await lastActivity(ctx, deal.id, deal.updatedAt);
    if (now - parseIso(last) < idleDays * DAY) continue;
    const ids = (await activeStaff(ctx, deal.ownerId)).length
      ? [deal.ownerId]
      : await staffOfRole(ctx, 'sales_manager');
    const client = await ctx.repos.clients.get(deal.clientId);
    const text = msg('next.notify.leadIdle', {
      days: idleDays,
      subject: `${deal.number} · ${client?.name ?? ''}`,
    });
    if (
      await notifyOnce(
        ctx,
        { job: SALES, subject: `lead:${deal.id}`, occurrence: last },
        [{ ids, link: `/staff/deals/${deal.id}` }],
        text,
      )
    )
      out.idleLeads += 1;
  }
  for (const kp of await ctx.repos.kp.list({ where: { status: 'sent' } })) {
    if (!kp.sentAt || now - parseIso(kp.sentAt) < noAnswerDays * DAY) continue;
    const deal = kp.dealId ? await ctx.repos.deals.get(kp.dealId) : null;
    const client = await ctx.repos.clients.get(kp.clientId);
    let ids: UUID[] = [];
    for (const id of [deal?.ownerId, client?.managerId, kp.createdById]) {
      ids = await activeStaff(ctx, id);
      if (ids.length) break;
    }
    const text = msg('next.notify.kpNoAnswer', {
      number: kp.number,
      days: noAnswerDays,
      client: kp.clientName,
    });
    const link = deal ? `/staff/deals/${deal.id}` : `/staff/kp/${kp.id}`;
    if (
      await notifyOnce(
        ctx,
        { job: SALES, subject: `kp:${kp.id}`, occurrence: kp.sentAt },
        [{ ids, link }],
        text,
      )
    )
      out.offersWithoutAnswer += 1;
  }
  return out;
}

/**
 * Children who reached the age limit (`maxChildAge`, `studentMaxAge` for a student): a request («Мои запросы» of the
 * underwriter — the role that decides the exclusion with the client's HR; the responsible underwriter of the client's
 * deal when there is one) once per child and limit. No automatic exclusion; a pending exclusion needs no request.
 * The child's name stays out of the request (it is visible to every MIG employee): the link opens the person's card.
 */
export async function ageLimitTasks(ctx: BaseCtx): Promise<number> {
  const limits = ageLimits(await loadParams(ctx));
  const today = isoDay(ctx.now());
  const excluding = new Set(
    (await ctx.repos.policyChanges.list({ where: { kind: 'exclude', status: 'pending' } })).map(
      (c) => c.insuredId,
    ),
  );
  let created = 0;
  for (const child of await ctx.repos.insured.list({
    where: { relation: 'child', status: { ne: 'excluded' } },
  })) {
    if (!reachedAgeLimit(child, today, limits) || excluding.has(child.id)) continue;
    const age = childAgeLimit(child, limits);
    const on = ageLimitDate(child, limits);
    const refs = await subjectRefs(ctx, 'client', child.clientId);
    if (!refs) continue;
    if (!(await ctx.repos.jobMarks.claim('child-age-limit', child.id, `${age}:${on}`))) continue;
    const comment = `Ребёнок застрахованного сотрудника достиг предельного возраста ${age} лет (${on.split('-').reverse().join('.')}). Решите с HR клиента: исключить через дополнительное соглашение или продолжить страхование по правилу для студентов. Автоматического исключения нет.`;
    await createTask(
      ctx,
      SYSTEM_ACTOR,
      { action: 'other', toRole: 'underwriter', subjectType: 'client', subjectId: child.clientId, comment },
      refs,
      {
        title: msg('next.task.ageLimit', { what: refs.clientName }),
        link: `/staff/insured/${child.id}`,
      },
    );
    created += 1;
  }
  return created;
}
