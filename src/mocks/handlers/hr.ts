import { msg } from '@/i18n/core';
import { http } from 'msw';
import Papa from 'papaparse';
import { hrEmployeeSchema, hrExcludeSchema, hrInviteSchema } from '@/shared/schemas/forms';
import type { ClientDocument, SessionUser } from '@/shared/types';
import type { HrEmployee, HrImportError, HrImportResult, HrOverview, HrStats } from '@/shared/types/dto';
import { PROGRAM_LABEL } from '@/shared/domain/labels';
import { db, type InsuredRow, type PolicyChangeRow } from '../db';
import { requestChange } from '../policy-core';
import {
  API,
  audit,
  body,
  forbidden,
  HttpError,
  insuredLabel,
  notFound,
  paginate,
  param,
  q,
  requireSession,
  route,
} from '../http';
import { DAY, parseIso } from '../time';
import { toHrEmployee } from '../views';
import { DEMO_STAFF } from '../credentials';

export const K_ANON = 10;
const CSV_MAX_BYTES = 2 * 1024 * 1024;
const CSV_MAX_ROWS = 1000;

function requireHr(request: Request): SessionUser & { companyId: string } {
  const { user } = requireSession(request);
  if (user.role !== 'hr' || !user.companyId) throw forbidden();
  return user as SessionUser & { companyId: string };
}

function ownEmployee(user: { companyId: string }, id: string): InsuredRow {
  const i = db().insured.find((x) => x.id === id);
  // Another company's employee "does not exist" for this HR.
  if (!i || i.clientId !== user.companyId) throw notFound();
  return i;
}

function kAnon(n: number): number | null {
  return n >= K_ANON ? n : null;
}

function clientOfHr(user: { companyId: string }) {
  return db().clients.find((c) => c.id === user.companyId)!;
}

/** HR adds a person: a change request for MIG, not a new insured person (POLICY_SPEC §5.1). */
function requestAdd(user: SessionUser & { companyId: string }, input: ReturnType<typeof hrEmployeeSchema.parse>): PolicyChangeRow {
  const d = db();
  const client = clientOfHr(user);
  if (d.insured.some((i) => i.pinfl === input.pinfl && i.clientId === client.id && i.status === 'active')) {
    throw new HttpError(409, 'conflict', 'srv.hr.pinflInsured', { fields: { pinfl: msg('srv.hr.alreadyListed') } });
  }
  return requestChange(d, user, client, 'add', {
    effectiveDate: input.startDate,
    fullName: input.fullName,
    position: input.position,
    familyMembers: 0,
    newPerson: { birthDate: input.birthDate, pinfl: input.pinfl, phone: input.phone },
  });
}

function requestRow(d: ReturnType<typeof db>, r: PolicyChangeRow): HrEmployee {
  const policy = d.policies.find((p) => p.id === r.policyId);
  return {
    id: r.id,
    fullName: r.fullName,
    position: r.position,
    program: policy?.program ?? 'standard',
    insuredFrom: r.effectiveDate,
    familyMembersCount: r.familyMembers,
    appStatus: 'not_invited',
    status: r.status === 'rejected' ? 'rejected' : 'pending',
    addedAt: r.requestedAt,
    rejectionReason: r.rejectionReason,
  };
}

function employeeView(d: ReturnType<typeof db>, i: InsuredRow): HrEmployee {
  const pending = d.policyChanges.find((c) => c.kind === 'exclude' && c.status === 'pending' && c.insuredId === i.id);
  // The latest exclusion rejected in the last 30 days: HR sees why (POLICY_SPEC §5.1).
  const rejected =
    !pending && i.status === 'active'
      ? d.policyChanges.find((c) => c.kind === 'exclude' && c.status === 'rejected' && c.insuredId === i.id && Date.now() - parseIso(c.decidedAt ?? c.requestedAt) <= 30 * DAY)
      : undefined;
  return { ...toHrEmployee(d, i), ...(pending ? { pendingExclusionFrom: pending.effectiveDate } : {}), ...(rejected ? { rejectionReason: rejected.rejectionReason } : {}) };
}

export const hrHandlers = [
  http.get(
    `${API}/hr/overview`,
    route(({ request }) => {
      const user = requireHr(request);
      const d = db();
      const client = d.clients.find((c) => c.id === user.companyId)!;
      const employees = d.insured.filter((i) => i.clientId === client.id && i.status === 'active');
      const policy = d.policies.find((p) => p.id === client.activePolicyId);
      const nextInvoice =
        d.invoices
          .filter((i) => i.clientId === client.id && i.status !== 'paid')
          .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0] ?? null;
      const manager = d.staff.find((s) => s.id === client.managerId);
      const out: HrOverview = {
        companyName: client.name,
        companyLegalForm: client.legalForm,
        insuredCount: employees.length,
        notInApp: employees.filter((i) => i.appStatus !== 'active').length,
        nextInvoice,
        policy: policy
          ? { number: policy.number, program: policy.program, programName: PROGRAM_LABEL[policy.program], startDate: policy.startDate, endDate: policy.endDate }
          : null,
        manager: {
          name: manager?.fullName ?? DEMO_STAFF[1]!.fullName,
          phone: '+998 71 200 00 00',
          email: 'dms@mig.example',
        },
      };
      return out;
    }),
  ),
  http.get(
    `${API}/hr/employees`,
    route(({ request, url }) => {
      const user = requireHr(request);
      const d = db();
      const own = d.insured.filter((i) => i.clientId === user.companyId);
      const monthAgo = Date.now() - 30 * DAY;
      const requests = d.policyChanges.filter(
        (c) => c.clientId === user.companyId && c.kind === 'add' && (c.status === 'pending' || (c.status === 'rejected' && parseIso(c.decidedAt ?? c.requestedAt) >= monthAgo)),
      );
      const filter = url.searchParams.get('filter');
      let list: HrEmployee[];
      if (filter === 'requests') {
        list = [...requests.map((r) => requestRow(d, r)), ...own.map((i) => employeeView(d, i)).filter((e) => e.pendingExclusionFrom)];
      } else {
        let people = own;
        if (filter === 'not_in_app') people = people.filter((i) => i.appStatus !== 'active' && i.status === 'active');
        if (filter === 'recent') people = people.filter((i) => Date.now() - parseIso(i.addedAt) <= 30 * DAY);
        if (filter === 'excluded') people = people.filter((i) => i.status === 'excluded');
        list = people.map((i) => employeeView(d, i));
        // Requests are visible in the full list right away (POLICY_SPEC §5.1).
        if (!filter) list = [...requests.map((r) => requestRow(d, r)), ...list];
      }
      const term = q(url);
      if (term) list = list.filter((i) => i.fullName.toLowerCase().includes(term) || i.position.toLowerCase().includes(term));
      const sort = url.searchParams.get('sort') ?? 'fullName:asc';
      const [key, dir] = sort.split(':');
      const mul = dir === 'desc' ? -1 : 1;
      const getters: Record<string, (i: HrEmployee) => string | number> = {
        fullName: (i) => i.fullName,
        insuredFrom: (i) => i.insuredFrom,
        familyMembersCount: (i) => i.familyMembersCount,
        appStatus: (i) => i.appStatus,
        addedAt: (i) => i.addedAt,
      };
      const get = getters[key ?? ''] ?? getters.fullName!;
      list = [...list].sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ru')) * mul;
      });
      return paginate(list, url);
    }),
  ),
  http.get(
    `${API}/hr/employees/:id`,
    route((ctx) => {
      const user = requireHr(ctx.request);
      const d = db();
      return employeeView(d, ownEmployee(user, param(ctx, 'id')));
    }),
  ),
  http.post(
    `${API}/hr/employees`,
    route(async ({ request }) => {
      const user = requireHr(request);
      const input = await body(request, hrEmployeeSchema);
      const row = requestAdd(user, input);
      audit(user, 'policy_change_requested', { targetType: 'policy', targetId: row.policyId, targetLabel: `${row.policyNumber}: прикрепление` });
      return requestRow(db(), row);
    }),
  ),
  http.delete(
    `${API}/hr/employees/:id`,
    route(async (ctx) => {
      const user = requireHr(ctx.request);
      const i = ownEmployee(user, param(ctx, 'id'));
      const { excludeFrom } = await body(ctx.request, hrExcludeSchema);
      if (i.status === 'excluded') throw new HttpError(409, 'conflict', 'srv.hr.alreadyExcluded');
      const d = db();
      const row = requestChange(d, user, clientOfHr(user), 'exclude', { effectiveDate: excludeFrom, fullName: i.fullName, position: i.position, familyMembers: i.familyMembersCount, insured: i });
      audit(user, 'policy_change_requested', { targetType: 'policy', targetId: row.policyId, targetLabel: `${row.policyNumber}: исключение ${insuredLabel(i.id)}` });
      return employeeView(d, i);
    }),
  ),
  http.post(
    `${API}/hr/employees/import`,
    route(async ({ request, url }) => {
      const user = requireHr(request);
      const text = await request.text();
      if (text.length > CSV_MAX_BYTES) throw new HttpError(413, 'validation', 'srv.file.tooLarge2mb');
      const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true });
      if (parsed.data.length > CSV_MAX_ROWS) throw new HttpError(422, 'validation', 'srv.hr.over1000Rows');
      const header = parsed.meta.fields ?? [];
      const required = ['fullName', 'birthDate', 'pinfl', 'phone', 'position', 'startDate'];
      const missing = required.filter((h) => !header.includes(h));
      if (missing.length) throw new HttpError(422, 'validation', 'srv.hr.missingColumns', { params: { columns: missing.join(', ') } });
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
      if (url.searchParams.get('commit') === '1') {
        for (const v of valid) {
          try {
            requestAdd(user, v);
            requested += 1;
          } catch {
            /* already insured, already requested or outside the policy period: skipped */
          }
        }
        audit(user, 'hr_import', { targetType: 'client', targetId: user.companyId, targetLabel: `Импорт: ${requested} заявок` });
      }
      const out: HrImportResult = { valid: valid.length, added: 0, requested, errors };
      return out;
    }),
  ),
  http.post(
    `${API}/hr/employees/invite`,
    route(async ({ request }) => {
      const user = requireHr(request);
      const { ids } = await body(request, hrInviteSchema);
      const d = db();
      const own = d.insured.filter((i) => i.clientId === user.companyId && i.status === 'active');
      const targets = ids === 'all_not_in_app' ? own.filter((i) => i.appStatus !== 'active') : own.filter((i) => ids.includes(i.id));
      if (ids !== 'all_not_in_app' && targets.length !== ids.length) throw notFound();
      for (const t of targets) if (t.appStatus === 'not_invited') t.appStatus = 'invited';
      return { invited: targets.filter((t) => t.appStatus !== 'active').length };
    }),
  ),
  http.get(
    `${API}/hr/documents`,
    route(({ request }) => {
      const user = requireHr(request);
      const d = db();
      // Offers are shown to HR only once sent; drafts and revoked offers stay internal.
      const offers: ClientDocument[] = d.kp
        .filter((k) => k.clientId === user.companyId && (k.status === 'sent' || k.status === 'accepted' || k.status === 'declined'))
        .map((k) => ({ id: k.id, clientId: k.clientId, title: `Коммерческое предложение ${k.number}`, kind: 'kp', kpId: k.id, createdAt: (k.sentAt ?? k.createdAt).slice(0, 10) }));
      const docs = d.documents.filter((x) => x.clientId === user.companyId && x.kind !== 'kp');
      return [...offers, ...docs];
    }),
  ),
  http.get(
    `${API}/hr/invoices`,
    route(({ request }) => {
      const user = requireHr(request);
      return db()
        .invoices.filter((i) => i.clientId === user.companyId)
        .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
    }),
  ),
  http.get(
    `${API}/hr/stats`,
    route(({ request }) => {
      const user = requireHr(request);
      const d = db();
      const employees = d.insured.filter((i) => i.clientId === user.companyId && i.status === 'active');
      const ids = new Set(employees.map((e) => e.id));
      const now = Date.now();
      const qStart = new Date(now);
      qStart.setMonth(Math.floor(qStart.getMonth() / 3) * 3, 1);
      const claimsQ = d.claims.filter((c) => ids.has(c.insuredId) && parseIso(c.createdAt) >= qStart.getTime()).length;
      const appUsers = employees.filter((e) => e.appStatus === 'active').length;
      const client = d.clients.find((c) => c.id === user.companyId)!;
      const year = new Date(now).getFullYear();
      const groups: [string, number, number][] = [
        [msg('srv.hrStats.ageUnder30'), 0, 29],
        [msg('srv.hrStats.age30to44'), 30, 44],
        [msg('srv.hrStats.age45plus'), 45, 200],
      ];
      const ageOf = (b: string) => year - Number(b.slice(0, 4));
      const out: HrStats = {
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
      return out;
    }),
  ),
];

