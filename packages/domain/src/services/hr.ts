/*
 * The HR cabinet of a client company: employees and their change requests (POLICY_SPEC §5), the CSV import,
 * app invitations, documents and invoices, family members and the employees' family requests (FAMILY_SPEC),
 * aggregated statistics with k-anonymity.
 */
import { msg } from '@mig/i18n';
import Papa from 'papaparse';
import type { ClientDocument, Invoice, PolicyChange, SessionUser } from '@mig/contracts';
import type { FamilyRequest, HrEmployee, HrFamilyMember, HrImportError, HrImportResult, HrOverview, HrStats } from '@mig/contracts/dto';
import { familyRequestDecisionSchema, hrEmployeeSchema, hrExcludeSchema, hrFamilyMemberSchema, hrInviteSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { DEMO_UNDERWRITER_NAME } from '../auth/demo';
import { PROGRAM_LABEL } from '../labels';
import { countsOf, exclusionDropsBelow, groupSize, type GroupCounts } from '../minGroup';
import { isActiveRequest } from '../requests';
import { matchesSearch } from '../lib/searchNormalize';
import { DAY, isoDay, parseIso, tzIso } from '../lib/time';
import type { InsuredRow, PolicyChangeRow } from '../store/db';
import { audit, conflict, DomainError, forbidden, insuredLabel, notFound, systemRepos, validate, type AuthCtx, type BaseCtx } from './kernel';
import { paginate, q } from './list';
import { loadParams } from './params';
import { familyOf } from './family';
import { employeeOfCompany, hrFamilyList, requestFamilyAdd, toFamilyRequest } from './familyRequests';
import { requestChange, toPolicyChange } from './policy';
import { createTask, notify, subjectRefs } from './tasks';
import { toHrEmployee } from './views';

export const K_ANON = 10;
const CSV_MAX_BYTES = 2 * 1024 * 1024;
const CSV_MAX_ROWS = 1000;

type HrUser = SessionUser & { companyId: string };

function requireHr(ctx: AuthCtx): HrUser {
  const { user } = ctx;
  if (user.role !== 'hr' || !user.companyId) throw forbidden();
  return user as HrUser;
}

async function ownEmployee(ctx: BaseCtx, user: { companyId: string }, id: string): Promise<InsuredRow> {
  const i = await ctx.repos.insured.get(id);
  // Another company's employee "does not exist" for this HR.
  if (!i || i.clientId !== user.companyId) throw notFound();
  return i;
}

function kAnon(n: number): number | null {
  return n >= K_ANON ? n : null;
}

async function clientOfHr(ctx: BaseCtx, user: { companyId: string }) {
  return (await ctx.repos.clients.get(user.companyId))!;
}

/** HR adds a person: a change request for MIG, not a new insured person (POLICY_SPEC §5.1). */
async function requestAdd(ctx: BaseCtx, user: HrUser, input: ReturnType<typeof hrEmployeeSchema.parse>): Promise<PolicyChangeRow> {
  const client = await clientOfHr(ctx, user);
  if (await ctx.repos.insured.exists({ pinfl: input.pinfl, clientId: client.id, status: 'active' })) {
    throw new DomainError(409, 'conflict', 'srv.hr.pinflInsured', { fields: { pinfl: msg('srv.hr.alreadyListed') } });
  }
  return requestChange(ctx, user, client, 'add', {
    effectiveDate: input.startDate,
    fullName: input.fullName,
    position: input.position,
    relation: 'employee',
    newPerson: { birthDate: input.birthDate, pinfl: input.pinfl, phone: input.phone },
  });
}

async function requestRow(ctx: BaseCtx, r: PolicyChangeRow): Promise<HrEmployee> {
  const policy = await ctx.repos.policies.get(r.policyId);
  return {
    id: r.id,
    fullName: r.fullName,
    position: r.position,
    program: policy?.program ?? 'standard',
    insuredFrom: r.effectiveDate,
    family: [],
    appStatus: 'not_invited',
    status: r.status === 'rejected' ? 'rejected' : 'pending',
    addedAt: r.requestedAt,
    rejectionReason: r.rejectionReason,
  };
}

async function employeeView(ctx: BaseCtx, i: InsuredRow): Promise<HrEmployee> {
  const pending = await ctx.repos.policyChanges.first({ where: { kind: 'exclude', status: 'pending', insuredId: i.id } });
  // The latest exclusion rejected in the last 30 days: HR sees why (POLICY_SPEC §5.1).
  const rejected =
    !pending && i.status === 'active'
      ? (await ctx.repos.policyChanges.list({ where: { kind: 'exclude', status: 'rejected', insuredId: i.id } })).find((c) => ctx.now() - parseIso(c.decidedAt ?? c.requestedAt) <= 30 * DAY)
      : undefined;
  return { ...(await toHrEmployee(ctx, i)), ...(pending ? { pendingExclusionFrom: pending.effectiveDate } : {}), ...(rejected ? { rejectionReason: rejected.rejectionReason } : {}) };
}

/** The insured group of a client as the minimum counts it: active people without a pending exclusion. */
async function activeGroup(ctx: BaseCtx, clientId: string): Promise<GroupCounts> {
  const leaving = new Set((await ctx.repos.policyChanges.list({ where: { clientId, kind: 'exclude', status: 'pending' } })).map((c) => c.insuredId));
  return countsOf((await ctx.repos.insured.list({ where: { clientId, status: 'active' } })).filter((i) => !leaving.has(i.id)));
}

/** An exclusion during the term leaves the group below the minimum: a task for the underwriter and the manager. */
async function belowMinTasks(ctx: BaseCtx, user: HrUser, after: GroupCounts): Promise<void> {
  const rules = (await loadParams(ctx)).groupRules();
  const refs = await subjectRefs(ctx, 'client', user.companyId);
  if (!refs) return;
  const comment = `После исключения по заявке HR: ${groupSize(after, rules)} из минимума ${rules.min}${rules.countsFamily ? ' (с членами семьи)' : ''}. Решите, что делать с условиями договора.`;
  for (const toRole of ['underwriter', 'sales_manager'] as const) {
    const existing = await ctx.repos.tasks.list({ where: { action: 'below_min_group', toRole, clientId: user.companyId } });
    if (existing.some((x) => isActiveRequest(x.status))) continue;
    await createTask(ctx, user, { action: 'below_min_group', toRole, subjectType: 'client', subjectId: user.companyId, comment }, refs);
  }
}

/** Persons of the company who have not left (no pending exclusion of their own). */
async function stayingFamily(ctx: BaseCtx, employeeId: string): Promise<InsuredRow[]> {
  const out: InsuredRow[] = [];
  for (const x of await familyOf(ctx, employeeId)) {
    if (x.status === 'active' && !(await ctx.repos.policyChanges.exists({ status: 'pending', insuredId: x.id }))) out.push(x);
  }
  return out;
}

export async function overview(ctx: AuthCtx): Promise<HrOverview> {
  const user = requireHr(ctx);
  const r = ctx.repos;
  const client = (await r.clients.get(user.companyId))!;
  const rules = (await loadParams(ctx)).groupRules();
  const employees = await r.insured.list({ where: { clientId: client.id, status: 'active' } });
  const policy = client.activePolicyId ? await r.policies.get(client.activePolicyId) : null;
  const nextInvoice = (await r.invoices.list({ where: { clientId: client.id, status: { ne: 'paid' } } })).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0] ?? null;
  const manager = client.managerId ? await r.staff.get(client.managerId) : null;
  return {
    companyName: client.name,
    companyLegalForm: client.legalForm,
    insuredCount: employees.length,
    group: { ...(await activeGroup(ctx, client.id)), min: rules.min, countsFamily: rules.countsFamily },
    // Only people with an own phone can use the app (a child lives in the parent's app).
    notInApp: employees.filter((i) => i.appStatus !== 'active' && !!i.phone).length,
    nextInvoice,
    policy: policy ? { number: policy.number, program: policy.program, programName: PROGRAM_LABEL[policy.program], startDate: policy.startDate, endDate: policy.endDate } : null,
    manager: {
      name: manager?.fullName ?? DEMO_UNDERWRITER_NAME,
      phone: '+998 71 200 00 00',
      email: 'dms@mig.example',
    },
  };
}

export async function listEmployees(ctx: AuthCtx, qs: URLSearchParams) {
  const user = requireHr(ctx);
  // Employees with their families listed by name; family members themselves are in /hr/family.
  const own = await ctx.repos.insured.list({ where: { clientId: user.companyId, relation: 'employee' } });
  const monthAgo = ctx.now() - 30 * DAY;
  const requests = (await ctx.repos.policyChanges.list({ where: { clientId: user.companyId, kind: 'add', relation: 'employee' } })).filter(
    (c) => c.status === 'pending' || (c.status === 'rejected' && parseIso(c.decidedAt ?? c.requestedAt) >= monthAgo),
  );
  const rows = async (list: PolicyChangeRow[]) => {
    const out: HrEmployee[] = [];
    for (const r of list) out.push(await requestRow(ctx, r));
    return out;
  };
  const views = async (list: InsuredRow[]) => {
    const out: HrEmployee[] = [];
    for (const i of list) out.push(await employeeView(ctx, i));
    return out;
  };
  const filter = qs.get('filter');
  let list: HrEmployee[];
  if (filter === 'requests') {
    list = [...(await rows(requests)), ...(await views(own)).filter((e) => e.pendingExclusionFrom)];
  } else {
    let people = own;
    if (filter === 'not_in_app') people = people.filter((i) => i.appStatus !== 'active' && i.status === 'active');
    if (filter === 'recent') people = people.filter((i) => ctx.now() - parseIso(i.addedAt) <= 30 * DAY);
    if (filter === 'excluded') people = people.filter((i) => i.status === 'excluded');
    list = await views(people);
    // Requests are visible in the full list right away (POLICY_SPEC §5.1).
    if (!filter) list = [...(await rows(requests)), ...list];
  }
  const term = q(qs);
  if (term) list = list.filter((i) => matchesSearch(term, i.fullName, i.position));
  const sort = qs.get('sort') ?? 'fullName:asc';
  const [key, dir] = sort.split(':');
  const mul = dir === 'desc' ? -1 : 1;
  const getters: Record<string, (i: HrEmployee) => string | number> = {
    fullName: (i) => i.fullName,
    insuredFrom: (i) => i.insuredFrom,
    family: (i) => i.family.filter((m) => m.status === 'active').length,
    appStatus: (i) => i.appStatus,
    addedAt: (i) => i.addedAt,
  };
  const get = getters[key ?? ''] ?? getters.fullName!;
  list = [...list].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ru')) * mul;
  });
  return paginate(list, qs);
}

export async function getEmployee(ctx: AuthCtx, id: string): Promise<HrEmployee> {
  const user = requireHr(ctx);
  return employeeView(ctx, await ownEmployee(ctx, user, id));
}

export async function addEmployee(ctx: AuthCtx, body: unknown): Promise<HrEmployee> {
  const user = requireHr(ctx);
  const input = validate(hrEmployeeSchema, body);
  const row = await requestAdd(ctx, user, input);
  await audit(ctx, user, 'policy_change_requested', { targetType: 'policy', targetId: row.policyId, targetLabel: `${row.policyNumber}: прикрепление` });
  return requestRow(ctx, row);
}

export async function excludeEmployee(ctx: AuthCtx, id: string, body: unknown): Promise<HrEmployee> {
  const user = requireHr(ctx);
  const i = await ownEmployee(ctx, user, id);
  const { excludeFrom } = validate(hrExcludeSchema, body);
  if (i.status === 'excluded') throw new DomainError(409, 'conflict', 'srv.hr.alreadyExcluded');
  const rules = (await loadParams(ctx)).groupRules();
  const before = await activeGroup(ctx, user.companyId);
  const leavingFamily = i.relation === 'employee' ? (await stayingFamily(ctx, i.id)).length : 0;
  const excluded: GroupCounts = i.relation === 'employee' ? { employees: 1, family: leavingFamily } : { employees: 0, family: 1 };
  const drops = exclusionDropsBelow(before, excluded, rules);
  if (drops && rules.belowMinDuringTerm === 'forbid') throw new DomainError(409, 'conflict', 'srv.hr.belowMinForbidden', { params: { min: rules.min } });
  const row = await requestChange(ctx, user, await clientOfHr(ctx, user), 'exclude', { effectiveDate: excludeFrom, fullName: i.fullName, position: i.position, insured: i });
  await audit(ctx, user, 'policy_change_requested', { targetType: 'policy', targetId: row.policyId, targetLabel: `${row.policyNumber}: исключение ${insuredLabel(i.id)}` });
  // The family of a leaving employee leaves with them: an exclusion request for each active member.
  if (i.relation === 'employee') {
    for (const m of await stayingFamily(ctx, i.id)) {
      const effective = excludeFrom < m.insuredFrom ? m.insuredFrom : excludeFrom;
      const fr = await requestChange(ctx, user, await clientOfHr(ctx, user), 'exclude', { effectiveDate: effective, fullName: m.fullName, position: m.position, insured: m });
      await audit(ctx, user, 'policy_change_requested', { targetType: 'policy', targetId: fr.policyId, targetLabel: `${fr.policyNumber}: исключение ${insuredLabel(m.id)}` });
    }
  }
  if (drops) await belowMinTasks(ctx, user, { employees: before.employees - excluded.employees, family: before.family - excluded.family });
  return employeeView(ctx, i);
}

/** The CSV of new employees (`text`); `commit`: send the valid rows as requests, else only check. */
export async function importEmployees(ctx: AuthCtx, text: string, commit: boolean): Promise<HrImportResult> {
  const user = requireHr(ctx);
  if (text.length > CSV_MAX_BYTES) throw new DomainError(413, 'validation', 'srv.file.tooLarge2mb');
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true });
  if (parsed.data.length > CSV_MAX_ROWS) throw new DomainError(422, 'validation', 'srv.hr.over1000Rows');
  const header = parsed.meta.fields ?? [];
  const required = ['fullName', 'birthDate', 'pinfl', 'phone', 'position', 'startDate'];
  const missing = required.filter((h) => !header.includes(h));
  if (missing.length) throw new DomainError(422, 'validation', 'srv.hr.missingColumns', { params: { columns: missing.join(', ') } });
  const errors: HrImportError[] = [];
  const valid: ReturnType<typeof hrEmployeeSchema.parse>[] = [];
  const seen = new Set<string>();
  parsed.data.forEach((row, idx) => {
    const r = hrEmployeeSchema.safeParse(row);
    if (!r.success) {
      for (const issue of r.error.issues) errors.push({ row: idx + 2, field: String(issue.path[0] ?? ''), message: issue.message });
      return;
    }
    if (seen.has(r.data.pinfl)) {
      errors.push({ row: idx + 2, field: 'pinfl', message: msg('srv.census.pinflRepeated') });
      return;
    }
    seen.add(r.data.pinfl);
    valid.push(r.data);
  });
  let requested = 0;
  if (commit) {
    for (const v of valid) {
      try {
        await requestAdd(ctx, user, v);
        requested += 1;
      } catch {
        /* already insured, already requested or outside the policy period: skipped */
      }
    }
    await audit(ctx, user, 'hr_import', { targetType: 'client', targetId: user.companyId, targetLabel: `Импорт: ${requested} заявок` });
  }
  return { valid: valid.length, added: 0, requested, errors };
}

export async function inviteEmployees(ctx: AuthCtx, body: unknown): Promise<{ invited: number }> {
  const user = requireHr(ctx);
  const { ids } = validate(hrInviteSchema, body);
  const own = await ctx.repos.insured.list({ where: { clientId: user.companyId, status: 'active' } });
  // Nobody to invite without a phone (a child lives in the parent's app).
  const targets = ids === 'all_not_in_app' ? own.filter((i) => i.appStatus !== 'active' && !!i.phone) : own.filter((i) => ids.includes(i.id));
  if (ids !== 'all_not_in_app' && targets.length !== ids.length) throw notFound();
  for (const t of targets) {
    if (t.appStatus === 'not_invited' && t.phone) {
      t.appStatus = 'invited';
      await ctx.repos.insured.update(t.id, { appStatus: t.appStatus });
    }
  }
  return { invited: targets.filter((t) => t.appStatus !== 'active').length };
}

export async function documents(ctx: AuthCtx): Promise<ClientDocument[]> {
  const user = requireHr(ctx);
  // Offers are shown to HR only once sent; drafts and revoked offers stay internal.
  const offers: ClientDocument[] = (await ctx.repos.kp.list({ where: { clientId: user.companyId, status: { in: ['sent', 'accepted', 'declined'] } } })).map((k) => ({
    id: k.id,
    clientId: k.clientId,
    title: `Коммерческое предложение ${k.number}`,
    kind: 'kp',
    kpId: k.id,
    createdAt: (k.sentAt ?? k.createdAt).slice(0, 10),
  }));
  const docs = await ctx.repos.documents.list({ where: { clientId: user.companyId, kind: { ne: 'kp' } } });
  return [...offers, ...docs];
}

export async function invoices(ctx: AuthCtx): Promise<Invoice[]> {
  const user = requireHr(ctx);
  return (await ctx.repos.invoices.list({ where: { clientId: user.companyId } })).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
}

// ---- family members (FAMILY_SPEC): HR adds them like employees and sees them without medical data ----

export async function familyList(ctx: AuthCtx, employeeId: string | undefined): Promise<HrFamilyMember[]> {
  const user = requireHr(ctx);
  if (employeeId && !(await ctx.repos.insured.exists({ id: employeeId, clientId: user.companyId, relation: 'employee' }))) throw notFound();
  return hrFamilyList(ctx, user.companyId, employeeId);
}

export async function addFamilyMember(ctx: AuthCtx, body: unknown): Promise<PolicyChange> {
  const user = requireHr(ctx);
  if (!can(user, 'hr.employees.manage', { companyId: user.companyId })) throw forbidden();
  const input = validate(hrFamilyMemberSchema, body);
  const employee = await employeeOfCompany(ctx, user.companyId, input.employeeId);
  if (!employee) throw notFound();
  const row = await requestFamilyAdd(ctx, user, await clientOfHr(ctx, user), employee, input);
  await audit(ctx, user, 'policy_change_requested', { targetType: 'policy', targetId: row.policyId, targetLabel: `${row.policyNumber}: прикрепление члена семьи ${insuredLabel(employee.id)}` });
  return toPolicyChange(row);
}

export async function familyRequests(ctx: AuthCtx, status: string | null): Promise<FamilyRequest[]> {
  const user = requireHr(ctx);
  const out: FamilyRequest[] = [];
  for (const r of await ctx.repos.familyRequests.list({ where: { clientId: user.companyId } })) {
    if (!status || status.split(',').includes(r.status)) out.push(await toFamilyRequest(ctx, r));
  }
  return out;
}

export async function decideFamilyRequest(ctx: AuthCtx, id: string, body: unknown): Promise<FamilyRequest> {
  const user = requireHr(ctx);
  const r = await ctx.repos.familyRequests.get(id);
  // Another company's request «does not exist» for this HR.
  if (!r || !can(user, 'family.requests.decide', { companyId: r.clientId })) throw notFound();
  if (r.status !== 'pending') throw conflict('srv.family.requestDecided');
  const input = validate(familyRequestDecisionSchema, body);
  const now = tzIso(ctx.now());
  if (input.decision === 'approve') {
    const employee = await employeeOfCompany(ctx, user.companyId, r.employeeId);
    if (!employee) throw conflict('srv.family.noEmployee');
    const startDate = input.startDate ?? isoDay(ctx.now() + DAY);
    const change = await requestFamilyAdd(ctx, user, await clientOfHr(ctx, user), employee, { ...r, startDate, familyRequestId: r.id });
    Object.assign(r, { status: 'approved', decidedAt: now, decidedById: user.id, decidedByName: user.displayName, policyChangeId: change.id });
    await ctx.repos.familyRequests.put(r);
    await audit(ctx, user, 'policy_change_requested', { targetType: 'policy', targetId: change.policyId, targetLabel: `${change.policyNumber}: прикрепление члена семьи ${insuredLabel(employee.id)}` });
  } else {
    Object.assign(r, { status: 'rejected', decidedAt: now, decidedById: user.id, decidedByName: user.displayName, rejectionReason: input.reason });
    await ctx.repos.familyRequests.put(r);
  }
  await audit(ctx, user, 'family_request_decided', { targetType: 'insured', targetId: r.employeeId, targetLabel: insuredLabel(r.employeeId), reason: input.decision === 'approve' ? 'approve' : input.reason });
  // The employee learns the decision in the app's bell; a rejection carries HR's reason.
  const employeeUser = (await ctx.repos.insured.get(r.employeeId))?.userId;
  if (employeeUser) {
    await notify(
      ctx,
      employeeUser,
      msg(input.decision === 'approve' ? 'app.family.notify.approved' : 'app.family.notify.rejected', { name: r.fullName }),
      '/app/family',
      input.decision === 'approve' ? undefined : r.rejectionReason,
    );
  }
  return toFamilyRequest(ctx, r);
}

export async function stats(ctx: AuthCtx): Promise<HrStats> {
  const user = requireHr(ctx);
  const employees = await ctx.repos.insured.list({ where: { clientId: user.companyId, status: 'active' } });
  const ids = employees.map((e) => e.id);
  const now = ctx.now();
  const qStart = new Date(now);
  qStart.setMonth(Math.floor(qStart.getMonth() / 3) * 3, 1);
  // HR never reads claims: only their count, under k-anonymity.
  const claimsQ = (await systemRepos(ctx, 'HR statistics: the number of claims of the company this quarter (k-anonymous)').claims.list({ where: { insuredId: { in: ids } } })).filter((c) => parseIso(c.createdAt) >= qStart.getTime()).length;
  const appUsers = employees.filter((e) => e.appStatus === 'active').length;
  const client = (await ctx.repos.clients.get(user.companyId))!;
  const year = new Date(now).getFullYear();
  const groups: [string, number, number][] = [
    [msg('srv.hrStats.ageUnder30'), 0, 29],
    [msg('srv.hrStats.age30to44'), 30, 44],
    [msg('srv.hrStats.age45plus'), 45, 200],
  ];
  const ageOf = (b: string) => year - Number(b.slice(0, 4));
  return {
    insuredCount: employees.length,
    appUsers: kAnon(employees.length) === null ? null : appUsers,
    claimsThisQuarter: kAnon(employees.length) === null ? null : claimsQ,
    budgetUsedPct: client.lossRatio === null || employees.length < K_ANON ? null : Math.round(client.lossRatio * 100),
    byAgeGroup: groups.map(([label, a, b]) => ({ label, value: kAnon(employees.filter((e) => ageOf(e.birthDate) >= a && ageOf(e.birthDate) <= b).length) })),
    byAppStatus: [
      { label: msg('srv.hrStats.appActive'), value: kAnon(appUsers) },
      { label: msg('srv.hrStats.appInvited'), value: kAnon(employees.filter((e) => e.appStatus === 'invited').length) },
      { label: msg('srv.hrStats.appNotInvited'), value: kAnon(employees.filter((e) => e.appStatus === 'not_invited').length) },
    ],
    k: K_ANON,
  };
}
