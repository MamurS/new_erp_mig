/*
 * Policy issuance by MIG (POLICY_SPEC): the check of the initial list, issuing a policy with its insured
 * persons, the queue of insured-list changes and MIG's decision on them.
 */
import { issueInvitation } from './invitations';
import { msg, translate } from '@mig/i18n';
import type { Contract, Policy, PolicyChange } from '@mig/contracts';
import type { PolicyChangeDecisionResult, PolicyListCheck } from '@mig/contracts/dto';
import { policyChangeDecisionSchema, policyIssueSchema } from '@mig/contracts/forms';
import { DEMO_PASSWORD } from '../auth/demo';
import { certificateNumber } from '../contracts';
import { COVERAGE_START_RULES, PERIODICITIES } from '../endorsements';
import { DRAFT_IF_STARTS_IN_DAYS, policyPeriodProblem, policyPremium } from '../policies';
import { contractPricing, pricingProblem } from '../pricing';
import { randomId } from '../lib/random';
import { DAY, isoDay, parseIso, tzIso } from '../lib/time';
import type { ChangeRequestRow, ClientRow, HrUserRow, PolicyChangeRow } from '../store/db';
import { allOf } from './list';
import { audit, conflict, DomainError, errorOf, notFound, requirePermission, validate, type AuthCtx, type BaseCtx } from './kernel';
import { loadParams } from './params';
import { currentAssistance, notifyAssistance } from './assistance';
import { createEndorsement, premiumOf } from './lifecycle';
import { activePolicyOf, createInsured, createListedInsured, endorsementDoc, nextPolicyNumber, parsePolicyList, refreshPolicyTotals, toListRow, toPolicyChange } from './policy';

/**
 * Annual premium of the person of a change under the contract and its rule: a transferred person's own, else by
 * the contract's pricing basis (by type, or by the age band on the effective date).
 */
async function premiumOfChange(ctx: BaseCtx, contract: Contract, r: PolicyChangeRow): Promise<ReturnType<typeof premiumOf>> {
  const person = r.insuredId ? await ctx.repos.insured.get(r.insuredId) : null;
  return premiumOf(contract, person ?? { relation: r.relation, birthDate: r.newPerson?.birthDate ?? '' }, r.effectiveDate);
}

async function clientOf(ctx: BaseCtx, id: string): Promise<ClientRow> {
  const c = await ctx.repos.clients.get(id);
  if (!c) throw notFound();
  return c;
}

/** Preview of the initial list (`text`: the CSV file). */
export async function checkPolicyList(ctx: AuthCtx, clientId: string, text: string): Promise<PolicyListCheck> {
  requirePermission(ctx.user, 'policies.write');
  await clientOf(ctx, clientId);
  const { total, rows, errors } = parsePolicyList(text);
  const family = rows.filter((r) => r.relation !== 'employee').length;
  return { total, valid: rows.length, employees: rows.length - family, familyMembers: family, errors };
}

export async function issuePolicy(ctx: AuthCtx, clientId: string, body: unknown): Promise<Policy> {
  const { user } = ctx;
  const r = ctx.repos;
  requirePermission(user, 'policies.write');
  const client = await clientOf(ctx, clientId);
  if (await activePolicyOf(ctx, client)) throw conflict('srv.policy.alreadyActive');
  const input = validate(policyIssueSchema, body);
  const period = policyPeriodProblem(input.startDate, input.endDate);
  if (period) throw errorOf(422, 'validation', period, { endDate: period });
  const { rows } = parsePolicyList(input.csv);
  if (!rows.length) throw new DomainError(422, 'validation', 'srv.policy.noValidRows', { fields: { csv: msg('srv.policy.noValidRowsShort') } });
  if (input.hr && (await r.hrUsers.list({ where: { email: input.hr.email } })).some((h) => h.companyId !== client.id)) {
    throw new DomainError(409, 'conflict', 'srv.policy.emailOtherCompany', { fields: { email: msg('srv.users.emailInUse') } });
  }
  const now = ctx.now();
  const family = rows.filter((x) => x.relation !== 'employee').length;
  const policy: Policy = {
    id: randomId(),
    number: await nextPolicyNumber(ctx, Number(input.startDate.slice(0, 4))),
    clientId: client.id,
    clientName: client.name,
    program: input.program,
    startDate: input.startDate,
    endDate: input.endDate,
    status: parseIso(input.startDate) - now > DRAFT_IF_STARTS_IN_DAYS * DAY ? 'draft' : 'active',
    premium: policyPremium(input.tariff, rows.length - family, family),
    insuredCount: rows.length,
    tariff: input.tariff,
    familyCount: family,
  };
  await r.policies.insert(policy, { at: 'start' });
  await createListedInsured(ctx, client, policy, rows.map(toListRow), input.startDate, 'not_invited');
  await refreshPolicyTotals(ctx, policy);
  await r.clients.update(client.id, { status: 'active', activePolicyId: policy.id, program: policy.program, premium: policy.premium, renewalDate: policy.endDate, lossRatio: client.lossRatio ?? 0 });
  const today = isoDay(now);
  await r.documents.insertMany(
    [
      { id: randomId(), clientId: client.id, title: `Полис ${policy.number}`, kind: 'policy', createdAt: today },
      { id: randomId(), clientId: client.id, title: `Список застрахованных (приложение 1 к полису ${policy.number})`, kind: 'insured_list', createdAt: today },
    ],
    { at: 'start' },
  );
  if (input.hr && !(await r.hrUsers.exists({ companyId: client.id }))) {
    const hr: HrUserRow = { id: randomId(), email: input.hr.email, password: DEMO_PASSWORD, fullName: input.hr.fullName, companyId: client.id };
    await r.hrUsers.insert(hr);
    await issueInvitation(ctx, hr, user);
    await r.clients.update(client.id, { hrContact: { ...client.hrContact, name: hr.fullName, email: hr.email } });
  }
  await audit(ctx, user, 'policy_issued', { targetType: 'policy', targetId: policy.id, targetLabel: `${policy.number}: ${rows.length} застр.` });
  return policy;
}

export async function listPolicyChanges(ctx: AuthCtx, qs: URLSearchParams): Promise<PolicyChange[]> {
  const { user } = ctx;
  requirePermission(user, 'policy_changes.read');
  if (user.role === 'hr') throw notFound(); // HR works with its own list through /hr/employees
  const status = qs.get('status');
  const clientId = qs.get('clientId');
  const policyId = qs.get('policyId');
  return (
    await ctx.repos.policyChanges.list({
      where: allOf<PolicyChangeRow>(status && { status: { in: status.split(',') as PolicyChangeRow['status'][] } }, clientId && { clientId }, policyId && { policyId }),
      orderBy: [['requestedAt', 'desc']],
      ties: 'desc',
    })
  ).map(toPolicyChange);
}

export async function decidePolicyChanges(ctx: AuthCtx, body: unknown): Promise<PolicyChangeDecisionResult> {
  const { user } = ctx;
  const repo = ctx.repos;
  requirePermission(user, 'policy_changes.decide');
  const input = validate(policyChangeDecisionSchema, body);
  const found = await Promise.all(input.ids.map((id) => repo.policyChanges.get(id)));
  if (found.some((r) => !r)) throw notFound();
  const rows = found as PolicyChangeRow[];
  if (rows.some((r) => r.status !== 'pending')) throw conflict('srv.policyChanges.someDecided');
  // Validate everything before changing anything (atomic batch).
  for (const r of rows) {
    const policy = await repo.policies.get(r.policyId);
    if (!policy || (policy.status !== 'active' && policy.status !== 'draft')) throw conflict('srv.policyChanges.policyInactive', { number: r.policyNumber });
    if (input.decision === 'approve' && r.kind === 'exclude') {
      const person = r.insuredId ? await repo.insured.get(r.insuredId) : null;
      if (!person || person.status !== 'active') throw conflict('srv.policyChanges.personExcluded', { name: r.fullName });
    }
    // An age-banded contract without a usable band table cannot price a change.
    const contract = input.decision === 'approve' && policy.contractId ? await activeContract(ctx, policy.contractId) : undefined;
    const pricing = contract ? pricingProblem(contractPricing(contract.params)) : null;
    if (pricing) throw errorOf(422, 'validation', pricing);
  }
  const at = tzIso(ctx.now());
  const out: PolicyChangeDecisionResult = { approved: 0, rejected: 0, endorsements: 0 };
  if (input.decision === 'reject') {
    for (const r of rows) {
      Object.assign(r, { status: 'rejected', decidedAt: at, decidedByName: user.displayName, rejectionReason: input.reason });
      await repo.policyChanges.update(r.id, { status: r.status, decidedAt: r.decidedAt, decidedByName: r.decidedByName, rejectionReason: r.rejectionReason });
    }
    out.rejected = rows.length;
  } else {
    const P = await loadParams(ctx);
    const byPolicy = new Map<string, PolicyChangeRow[]>();
    for (const r of rows) byPolicy.set(r.policyId, [...(byPolicy.get(r.policyId) ?? []), r]);
    for (const [policyId, group] of byPolicy) {
      const policy = (await repo.policies.get(policyId))!;
      const client = (await repo.clients.get(policy.clientId))!;
      // A policy issued under a contract: accepted changes accumulate into an endorsement (LIFECYCLE_SPEC §11).
      const contract = policy.contractId ? await activeContract(ctx, policy.contractId) : undefined;
      const deferred = !!contract && COVERAGE_START_RULES[P.dmsParam('coverageStartRule')] === 'from_endorsement_signed';
      const requests: ChangeRequestRow[] = [];
      let delta = 0;
      for (const r of group) {
        if (r.kind === 'add' && deferred) {
          // Coverage starts when the endorsement is signed: the person is created then.
        } else if (r.kind === 'add') {
          const person = await createInsured(ctx, client, policy, { ...r, ...r.newPerson!, principalId: r.principalId }, r.effectiveDate, 'invited');
          r.insuredId = person.id;
          if (contract) {
            await repo.insured.update(person.id, { contractId: contract.id });
            const n = await repo.insured.count({ contractId: contract.id });
            await repo.insured.update(person.id, { certificateNumber: certificateNumber(contract.number, n, P.numbering()) });
          }
        } else {
          await repo.insured.update(r.insuredId!, { status: 'excluded', excludedFrom: r.effectiveDate, updatedAt: at });
        }
        // The assistance of the policy sees the change at once (ASSISTANCE_SPEC §5.7).
        if (r.insuredId) await notifyAssistance(ctx, await currentAssistance(ctx, policy.id), r.kind === 'add' ? 'insured.added' : 'insured.excluded', r.insuredId);
        delta += r.premiumDelta;
        Object.assign(r, { status: 'approved', decidedAt: at, decidedByName: user.displayName });
        await repo.policyChanges.update(r.id, { status: r.status, decidedAt: r.decidedAt, decidedByName: r.decidedByName, insuredId: r.insuredId });
        if (contract) {
          const short = r.fullName
            .split(' ')
            .map((w, k) => (k === 0 ? w : `${w[0] ?? ''}.`))
            .join(' ');
          const cr: ChangeRequestRow = {
            id: randomId(),
            contractId: contract.id,
            type: r.kind === 'add' ? 'add_insured' : 'exclude_insured',
            effectiveDate: r.effectiveDate,
            insuredId: r.insuredId,
            // The annual premium of the person by the contract terms and the rule used: the endorsement line shows both.
            payload: { relation: r.relation, ...(await premiumOfChange(ctx, contract, r)) },
            requestedBy: { id: r.requestedById, role: 'hr', name: r.requestedByName },
            status: 'pending',
            createdAt: at,
            // A family member: the relation and the employee instead of the position (documents are in Russian).
            description: `${r.kind === 'add' ? 'Включение' : 'Исключение'}: ${short} (${r.relation === 'employee' ? r.position : `${translate('ru', `labels.censusRelation.${r.relation}`).toLowerCase()} сотрудника ${r.principalName ?? ''}`.trim()})`,
            policyChangeId: r.id,
            ...(r.kind === 'add' && deferred ? { newPerson: { fullName: r.fullName, position: r.position, relation: r.relation, ...(r.principalId ? { principalId: r.principalId } : {}), ...r.newPerson! } } : {}),
          };
          await repo.changeRequests.insert(cr, { at: 'start' });
          requests.push(cr);
        }
      }
      if (contract) {
        // Premium of the policy follows at once; the endorsement documents it (monthly, or one per change).
        policy.premium = Math.max(0, policy.premium + delta);
        await repo.policies.update(policy.id, { premium: policy.premium });
        await refreshPolicyTotals(ctx, policy);
        if (PERIODICITIES[P.dmsParam('endorsementPeriodicity')] === 'per_change') {
          for (const cr of requests) await createEndorsement(ctx, contract, [cr], 'changes');
          out.endorsements += requests.length;
        }
        continue;
      }
      policy.premium = Math.max(0, policy.premium + delta);
      await repo.policies.update(policy.id, { premium: policy.premium });
      await refreshPolicyTotals(ctx, policy);
      const doc = await endorsementDoc(
        ctx,
        policy,
        group.filter((r) => r.kind === 'add').length,
        group.filter((r) => r.kind === 'exclude').length,
        delta,
        isoDay(ctx.now()),
      );
      await repo.documents.insert(doc, { at: 'start' });
      for (const r of group) {
        r.endorsementId = doc.id;
        await repo.policyChanges.update(r.id, { endorsementId: doc.id });
      }
      out.endorsements += 1;
    }
    out.approved = rows.length;
  }
  await audit(ctx, user, 'policy_change_decided', {
    targetType: 'policy',
    targetId: rows[0]!.policyId,
    targetLabel: `${rows[0]!.policyNumber}: ${input.decision === 'approve' ? 'подтверждено' : 'отклонено'} ${rows.length}`,
    reason: input.reason,
  });
  return out;
}

async function activeContract(ctx: BaseCtx, id: string): Promise<Contract | undefined> {
  const c = await ctx.repos.contracts.get(id);
  return c && c.status === 'active' ? c : undefined;
}
