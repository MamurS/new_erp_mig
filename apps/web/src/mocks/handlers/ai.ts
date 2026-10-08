/*
 * AI coverage check gateway (AI_COVERAGE_SPEC §3.3, §4, §5). The logic is the shared service
 * (packages/domain/src/services/ai.ts); this is the MSW adapter. The mock provider's latency is a
 * mock-only knob, set here.
 */
import { http, HttpResponse } from 'msw';
import * as ai from '@mig/domain/services/ai';
import { createMockProvider } from '@mig/domain/lib/aiProvider';
import { personIdParam } from '@mig/domain/services/family';
import { API, authCtx, param, readJson, route } from '../http';
import { mockConfig } from '../config';

const provider = () => createMockProvider({ latency: mockConfig.latency[1] > 0 });

export const aiHandlers = [
  http.get(`${API}/ai/status`, route(async ({ request }) => ai.status(await authCtx(request)))),
  http.post(`${API}/ai/coverage-check`, route(async ({ request, url }) => ai.coverageCheck(await authCtx(request), provider(), personIdParam(url), await readJson(request)))),
  http.post(`${API}/ai/feedback`, route(async ({ request }) => ai.feedback(await authCtx(request), await readJson(request)))),
  http.post(`${API}/rebills/:id/ai-precheck`, route(async (c) => ai.rebillPrecheck(await authCtx(c.request), provider(), param(c, 'id')))),

  // ---- administration: settings by four eyes, metrics, golden cases ----
  http.get(`${API}/ai/admin`, route(async ({ request }) => ai.admin(await authCtx(request)))),
  http.post(`${API}/ai/admin/changes`, route(async ({ request }) => HttpResponse.json(await ai.proposeChange(await authCtx(request), await readJson(request)), { status: 201 }))),
  http.post(
    `${API}/ai/admin/changes/:id/:decision`,
    route(async (c) => ai.decideChange(await authCtx(c.request), param(c, 'id'), String(c.params.decision ?? ''), await readJson(c.request))),
  ),
  http.post(`${API}/ai/admin/eval`, route(async ({ request }) => ai.runEval(await authCtx(request)))),
];
