/* Policy issuance and the queue of insured-list changes (POLICY_SPEC §4, §5.2, §7). */
import { http } from 'msw';
import type { Policy } from '@/shared/types';
import type { PolicyChangeDecisionResult, PolicyListCheck } from '@/shared/types/dto';
import { DRAFT_IF_STARTS_IN_DAYS, policyPeriodProblem, policyPremium } from '@/shared/domain/policies';
import { policyChangeDecisionSchema, policyIssueSchema } from '@/shared/schemas/forms';
import { db, type ChangeRequestRow, type HrUserRow } from '../db';
import { certificateNumber } from '@/shared/domain/contracts';
import { COVERAGE_START_RULES, PERIODICITIES } from '@/shared/domain/endorsements';
import { dmsParam } from '../params';
import { createEndorsement } from '../lifecycle-core';
import { API, audit, body, conflict, HttpError, notFound, param, requirePermission, requireSession, route } from '../http';
import { DEMO_PASSWORD } from '../credentials';
import { activePolicyOf, createInsured, endorsementDoc, nextPolicyNumber, parsePolicyList, refreshPolicyTotals, toPolicyChange } from '../policy-core';
import { currentAssistance, notifyAssistance } from '../assistance-core';
import { randomId } from '../rng';
import { DAY, isoDay, parseIso, tzIso } from '../time';

function clientOf(id: string) {
  const c = db().clients.find((x) => x.id === id);
  if (!c) throw notFound();
  return c;
}

export const policyHandlers = [
  http.post(
    `${API}/clients/:id/policies/check`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'policies.write');
      clientOf(param(ctx, 'id'));
      const { total, rows, errors } = parsePolicyList(await ctx.request.text());
      const out: PolicyListCheck = { total, valid: rows.length, employees: rows.length, familyMembers: rows.reduce((s, r) => s + r.familyMembers, 0), errors };
      return out;
    }),
  ),
  http.post(
    `${API}/clients/:id/policies`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'policies.write');
      const d = db();
      const client = clientOf(param(ctx, 'id'));
      if (activePolicyOf(d, client)) throw conflict('У клиента уже есть действующий полис');
      const input = await body(ctx.request, policyIssueSchema);
      const period = policyPeriodProblem(input.startDate, input.endDate);
      if (period) throw new HttpError(422, 'validation', period, { endDate: period });
      const { rows } = parsePolicyList(input.csv);
      if (!rows.length) throw new HttpError(422, 'validation', 'В списке нет ни одной корректной строки', { csv: 'Нет корректных строк' });
      if (input.hr && d.hrUsers.some((h) => h.email === input.hr!.email && h.companyId !== client.id)) {
        throw new HttpError(409, 'conflict', 'Этот email уже используется другой компанией', { email: 'Email уже используется' });
      }
      const now = Date.now();
      const family = rows.reduce((s, r) => s + r.familyMembers, 0);
      const policy: Policy = {
        id: randomId(),
        number: nextPolicyNumber(d, Number(input.startDate.slice(0, 4))),
        clientId: client.id,
        clientName: client.name,
        program: input.program,
        startDate: input.startDate,
        endDate: input.endDate,
        status: parseIso(input.startDate) - now > DRAFT_IF_STARTS_IN_DAYS * DAY ? 'draft' : 'active',
        premium: policyPremium(input.tariff, rows.length, family),
        insuredCount: rows.length,
        tariff: input.tariff,
        familyCount: family,
      };
      d.policies.unshift(policy);
      for (const r of rows) createInsured(d, client, policy, r, input.startDate, 'not_invited');
      refreshPolicyTotals(d, policy);
      Object.assign(client, { status: 'active', activePolicyId: policy.id, program: policy.program, premium: policy.premium, renewalDate: policy.endDate, lossRatio: client.lossRatio ?? 0 });
      const today = isoDay(now);
      d.documents.unshift(
        { id: randomId(), clientId: client.id, title: `Полис ${policy.number}`, kind: 'policy', createdAt: today },
        { id: randomId(), clientId: client.id, title: `Список застрахованных (приложение 1 к полису ${policy.number})`, kind: 'insured_list', createdAt: today },
      );
      if (input.hr && !d.hrUsers.some((h) => h.companyId === client.id)) {
        const hr: HrUserRow = { id: randomId(), email: input.hr.email, password: DEMO_PASSWORD, fullName: input.hr.fullName, companyId: client.id };
        d.hrUsers.push(hr);
        client.hrContact = { ...client.hrContact, name: hr.fullName, email: hr.email };
      }
      audit(user, 'policy_issued', { targetType: 'policy', targetId: policy.id, targetLabel: `${policy.number}: ${rows.length} застр.` });
      return policy;
    }),
  ),
  http.get(
    `${API}/policy-changes`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'policy_changes.read');
      if (user.role === 'hr') throw notFound(); // HR works with its own list through /hr/employees
      const status = url.searchParams.get('status');
      const clientId = url.searchParams.get('clientId');
      const policyId = url.searchParams.get('policyId');
      return db()
        .policyChanges.filter((c) => (!status || status.split(',').includes(c.status)) && (!clientId || c.clientId === clientId) && (!policyId || c.policyId === policyId))
        .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))
        .map(toPolicyChange);
    }),
  ),
  http.post(
    `${API}/policy-changes/decision`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'policy_changes.decide');
      const input = await body(request, policyChangeDecisionSchema);
      const d = db();
      const rows = input.ids.map((id) => d.policyChanges.find((c) => c.id === id));
      if (rows.some((r) => !r)) throw notFound();
      if (rows.some((r) => r!.status !== 'pending')) throw conflict('По части заявок уже принято решение — обновите список');
      // Validate everything before changing anything (atomic batch).
      for (const r of rows) {
        const policy = d.policies.find((p) => p.id === r!.policyId);
        if (!policy || (policy.status !== 'active' && policy.status !== 'draft')) throw conflict(`Полис ${r!.policyNumber} не действует`);
        if (input.decision === 'approve' && r!.kind === 'exclude') {
          const person = d.insured.find((i) => i.id === r!.insuredId);
          if (!person || person.status !== 'active') throw conflict(`${r!.fullName}: сотрудник уже исключён`);
        }
      }
      const at = tzIso(Date.now());
      const out: PolicyChangeDecisionResult = { approved: 0, rejected: 0, endorsements: 0 };
      if (input.decision === 'reject') {
        for (const r of rows) Object.assign(r!, { status: 'rejected', decidedAt: at, decidedByName: user.displayName, rejectionReason: input.reason });
        out.rejected = rows.length;
      } else {
        const byPolicy = new Map<string, typeof rows>();
        for (const r of rows) byPolicy.set(r!.policyId, [...(byPolicy.get(r!.policyId) ?? []), r]);
        for (const [policyId, group] of byPolicy) {
          const policy = d.policies.find((p) => p.id === policyId)!;
          const client = d.clients.find((c) => c.id === policy.clientId)!;
          // A policy issued under a contract: accepted changes accumulate into an endorsement (LIFECYCLE_SPEC §11).
          const contract = policy.contractId ? d.contracts.find((c) => c.id === policy.contractId && c.status === 'active') : undefined;
          const deferred = !!contract && COVERAGE_START_RULES[dmsParam('coverageStartRule')] === 'from_endorsement_signed';
          const requests: ChangeRequestRow[] = [];
          let delta = 0;
          for (const r of group) {
            if (r!.kind === 'add' && deferred) {
              // Coverage starts when the endorsement is signed: the person is created then.
            } else if (r!.kind === 'add') {
              const person = createInsured(d, client, policy, { ...r!, ...r!.newPerson! }, r!.effectiveDate, 'invited');
              r!.insuredId = person.id;
              if (contract) {
                person.contractId = contract.id;
                person.certificateNumber = certificateNumber(contract.number, d.insured.filter((i) => i.contractId === contract.id).length);
              }
            } else {
              const person = d.insured.find((i) => i.id === r!.insuredId)!;
              person.status = 'excluded';
              person.excludedFrom = r!.effectiveDate;
              person.updatedAt = at;
            }
            // The assistance of the policy sees the change at once (ASSISTANCE_SPEC §5.7).
            if (r!.insuredId) await notifyAssistance(d, currentAssistance(d, policy.id), r!.kind === 'add' ? 'insured.added' : 'insured.excluded', r!.insuredId);
            delta += r!.premiumDelta;
            Object.assign(r!, { status: 'approved', decidedAt: at, decidedByName: user.displayName });
            if (contract) {
              const short = r!.fullName.split(' ').map((w, k) => (k === 0 ? w : `${w[0] ?? ''}.`)).join(' ');
              const cr: ChangeRequestRow = {
                id: randomId(),
                contractId: contract.id,
                type: r!.kind === 'add' ? 'add_insured' : 'exclude_insured',
                effectiveDate: r!.effectiveDate,
                insuredId: r!.insuredId,
                payload: { familyMembers: r!.familyMembers },
                requestedBy: { id: r!.requestedById, role: 'hr', name: r!.requestedByName },
                status: 'pending',
                createdAt: at,
                description: `${r!.kind === 'add' ? 'Включение' : 'Исключение'}: ${short} (${r!.position})`,
                policyChangeId: r!.id,
                ...(r!.kind === 'add' && deferred ? { newPerson: { fullName: r!.fullName, position: r!.position, familyMembers: r!.familyMembers, ...r!.newPerson! } } : {}),
              };
              d.changeRequests.unshift(cr);
              requests.push(cr);
            }
          }
          if (contract) {
            // Premium of the policy follows at once; the endorsement documents it (monthly, or one per change).
            policy.premium = Math.max(0, policy.premium + delta);
            refreshPolicyTotals(d, policy);
            if (PERIODICITIES[dmsParam('endorsementPeriodicity')] === 'per_change') {
              for (const cr of requests) createEndorsement(d, contract, [cr], 'changes');
              out.endorsements += requests.length;
            }
            continue;
          }
          policy.premium = Math.max(0, policy.premium + delta);
          refreshPolicyTotals(d, policy);
          const doc = endorsementDoc(d, policy, group.filter((r) => r!.kind === 'add').length, group.filter((r) => r!.kind === 'exclude').length, delta, isoDay(Date.now()));
          d.documents.unshift(doc);
          for (const r of group) r!.endorsementId = doc.id;
          out.endorsements += 1;
        }
        out.approved = rows.length;
      }
      audit(user, 'policy_change_decided', {
        targetType: 'policy',
        targetId: rows[0]!.policyId,
        targetLabel: `${rows[0]!.policyNumber}: ${input.decision === 'approve' ? 'подтверждено' : 'отклонено'} ${rows.length}`,
        reason: input.reason,
      });
      return out;
    }),
  ),
];
