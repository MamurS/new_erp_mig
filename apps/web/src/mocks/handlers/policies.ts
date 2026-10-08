/*
 * Policy issuance and the queue of insured-list changes (POLICY_SPEC). The logic is the shared service
 * (packages/domain/src/services/policies.ts); this is the MSW adapter.
 */
import { http } from 'msw';
import * as policies from '@mig/domain/services/policies';
import { API, authCtx, param, readJson, route } from '../http';

export const policyHandlers = [
  http.post(`${API}/clients/:id/policies/check`, route(async (c) => policies.checkPolicyList(await authCtx(c.request), param(c, 'id'), await c.request.text()))),
  http.post(`${API}/clients/:id/policies`, route(async (c) => policies.issuePolicy(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.get(`${API}/policy-changes`, route(async ({ request, url }) => policies.listPolicyChanges(await authCtx(request), url.searchParams))),
  http.post(`${API}/policy-changes/decision`, route(async ({ request }) => policies.decidePolicyChanges(await authCtx(request), await readJson(request)))),
];
