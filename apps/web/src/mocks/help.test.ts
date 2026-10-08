// @vitest-environment node
/*
 * Help on the mock server: content filtered by the session's role (401 without a session, 404 for an
 * article the role may not read), the search over the role's content, «Задать вопрос» with the AI
 * switches, redacted storage of questions, feedback by the asker only, the admin list.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AiAdminView, SessionResponse } from '@mig/contracts/dto';
import type { HelpAnswer, HelpArticle, HelpGlossary, HelpGuide, HelpQuestionsAdminView, HelpSearchResult, HelpToc } from '@mig/contracts/help';
import { createMockServer } from './node';
import { db, resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

type Res<T> = { status: number; data: T };
async function call<T = Record<string, unknown>>(path: string, init: { method?: string; sid?: string; json?: unknown } = {}): Promise<Res<T>> {
  const headers = new Headers();
  if (init.sid) headers.set('Authorization', `Bearer ${init.sid}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status, email).toBe(200);
  return b.data.sessionId;
}
async function loginPhone(phone: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/phone', { method: 'POST', json: { phone } });
  const b = await call<SessionResponse>('/auth/phone/verify', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return b.data.sessionId;
}
const ask = (sid: string, question: string, locale = 'ru') => call<HelpAnswer>('/ai/help-answer', { method: 'POST', sid, json: { question, locale } });

describe('help API', () => {
  it('requires a session', async () => {
    for (const p of ['/help', '/help/toc', '/help/glossary', '/help/search?q=гп', '/help/articles/kp']) expect((await call(p)).status, p).toBe(401);
    expect((await call('/ai/help-answer', { method: 'POST', json: { question: 'как войти' } })).status).toBe(401);
  });

  it('filters the content by role on the server: external roles never get MIG-only fragments', async () => {
    const hr = await login('hr@demo-client.uz');
    const insured = await loginPhone('+998900000001');
    const clinic = await login('registrar@demo-clinic.uz');
    for (const sid of [hr, insured, clinic]) {
      const toc = await call<HelpToc>('/help/toc', { sid });
      expect(toc.status).toBe(200);
      const anchors = toc.data.articles.flatMap((a) => [a.anchor, ...a.sections.map((s) => s.anchor)]);
      expect(anchors).not.toContain('claims-fraud');
      expect(anchors).not.toContain('claims');
      const guide = await call<HelpGuide>('/help', { sid });
      expect(JSON.stringify(guide.data)).not.toMatch(/мошеннич/i);
      expect((await call('/help/articles/claims-fraud', { sid })).status).toBe(404);
      expect((await call('/help/articles/claims', { sid })).status).toBe(404);
      const s = await call<HelpSearchResult>(`/help/search?q=${encodeURIComponent('мошенничество повтор чека')}`, { sid });
      expect(JSON.stringify([s.data.terms, s.data.articles])).not.toMatch(/мошеннич|claims-fraud/i);
      const a = await ask(sid, 'какие признаки мошенничества проверяет система');
      expect(a.data.status).toBe('no_answer');
    }
    const toc = await call<HelpToc>('/help/toc', { sid: hr });
    expect(toc.data.role).toBe('hr');
    expect(toc.data.title).toMatch(/Руководство/);
    // The demo article only in a demo build (the tests run without VITE_DEMO_MODE).
    expect(toc.data.articles.some((a) => a.anchor === 'demo')).toBe(false);
    const accountant = await login('accountant@demo.mig.uz');
    const art = await call<HelpArticle>('/help/articles/claims-fraud', { sid: accountant });
    expect(art.status).toBe(200);
    expect(art.data.anchor).toBe('claims');
    expect(art.data.sections.map((x) => x.anchor)).toContain('claims-fraud');
    expect((await call('/help/articles/portfolio-migration', { sid: accountant })).status).toBe(404);
    expect((await call('/help/articles/..%2Fetc', { sid: accountant })).status).toBe(404);
  });

  it('serves a locale with the Russian fallback marked', async () => {
    const hr = await login('hr@demo-client.uz');
    const en = await call<HelpToc>('/help/toc?locale=en', { sid: hr });
    expect(en.status).toBe(200);
    expect(en.data.locale).toBe('en');
    const ru = await call<HelpToc>('/help/toc?locale=xx', { sid: hr });
    expect(ru.data.locale).toBe('ru');
    expect(ru.data.articles.every((a) => !a.fallback)).toBe(true);
    const g = await call<HelpGlossary>('/help/glossary', { sid: hr });
    expect(g.data.terms.find((t) => t.id === 'gp')?.synonyms).toEqual(['ГП', 'гарантийное письмо']);
  });

  it('searches the role\'s content: «гп» finds «Гарантийное письмо»', async () => {
    const sid = await login('registrar@demo-clinic.uz');
    const r = await call<HelpSearchResult>(`/help/search?q=${encodeURIComponent('гп')}`, { sid });
    expect(r.status).toBe(200);
    expect(r.data.terms[0]!.term.term).toBe('ГП — гарантийное письмо');
    expect(r.data.articles.some((a) => a.anchor === 'guarantee-letter')).toBe(true);
    expect((await call(`/help/search?q=${'x'.repeat(201)}`, { sid })).status).toBe(422);
  });
});

describe('«Задать вопрос» (AI scenario help)', () => {
  it('answers from the guide with sources and the screens the role may open', async () => {
    const sid = await login('accountant@demo.mig.uz');
    const a = await ask(sid, 'как разнести платёж от другой компании');
    expect(a.status).toBe(200);
    expect(a.data.status).toBe('answered');
    expect(a.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.data.sources[0]).toMatchObject({ anchor: 'manual-allocation', articleAnchor: 'finance' });
    expect(a.data.steps.length).toBeGreaterThanOrEqual(3);
    expect(a.data.openRoutes).toContainEqual({ route: '/staff/invoices/queue', label: 'Ручная разноска', labelKey: 'staff.nav.paymentQueue' });
    // A role without access to the screen gets no button.
    const sales = await login('sales@demo.mig.uz');
    const b = await ask(sales, 'как разнести платёж от другой компании');
    expect(b.data.openRoutes.some((r) => r.route === '/staff/invoices/queue')).toBe(false);
  });

  it('validates the question', async () => {
    const sid = await login('hr@demo-client.uz');
    expect((await ask(sid, 'a')).status).toBe(422);
    expect((await ask(sid, 'x'.repeat(301))).status).toBe(422);
    expect((await ask(sid, 'как подписать договор', 'fr')).status).toBe(422);
  });

  it('stores questions without personal data; the asker alone rates the answer; admins see the list', async () => {
    const hr = await login('hr@demo-client.uz');
    const a = await ask(hr, 'сотрудник Sobirov Akmal Ravshanovich 12345678901234 уволился как исключить');
    expect(a.data.status).toBe('answered');
    const stored = db().help.questions[0]!;
    expect(stored.question).not.toContain('Sobirov');
    expect(stored.question).not.toContain('12345678901234');
    expect(stored.role).toBe('hr');
    const none = await ask(hr, 'как снять флаг мошенничества');
    expect(none.data).toMatchObject({ status: 'no_answer', sources: [] });

    const other = await login('accountant@demo.mig.uz');
    expect((await call(`/ai/help-answer/${a.data.id}/feedback`, { method: 'POST', sid: other, json: { helpful: false } })).status).toBe(404);
    expect((await call(`/ai/help-answer/${a.data.id}/feedback`, { method: 'POST', sid: hr, json: { helpful: false } })).status).toBe(200);

    expect((await call('/ai/admin/help-questions', { sid: hr })).status).toBe(403);
    expect((await call('/ai/admin/help-questions', { sid: other })).status).toBe(403);
    const admin = await login('admin@demo.mig.uz');
    const list = await call<HelpQuestionsAdminView>('/ai/admin/help-questions', { sid: admin });
    expect(list.status).toBe(200);
    expect(list.data).toMatchObject({ total: 2, answered: 1, noAnswer: 1, notHelpful: 1 });
    expect(list.data.unanswered[0]!.question).toBe('как снять флаг мошенничества');
    expect(list.data.notHelpfulQuestions[0]!.id).toBe(a.data.id);
    expect(JSON.stringify(list.data)).not.toContain('askerId');
    const view = await call<AiAdminView>('/ai/admin', { sid: admin });
    expect(view.data.metrics.find((m) => m.scenario === 'help')).toMatchObject({ calls: 2, rated: 1, agreeShare: 0 });
  });

  it('obeys the scenario switch and «Отключить ИИ везде»; the search keeps working', async () => {
    const sid = await login('hr@demo-client.uz');
    db().ai.settings.scenarios.help.enabled = false;
    expect((await ask(sid, 'как подписать договор ЭЦП')).data).toMatchObject({ status: 'disabled', sources: [] });
    db().ai.settings.scenarios.help.enabled = true;
    expect((await ask(sid, 'как подписать договор ЭЦП')).data.status).toBe('answered');

    const admin = await login('admin@demo.mig.uz');
    const settings = (await call<AiAdminView>('/ai/admin', { sid: admin })).data.settings;
    const kill = await call('/ai/admin/changes', { method: 'POST', sid: admin, json: { to: { ...settings, killSwitch: true }, reason: 'Массовая проблема' } });
    expect(kill.status).toBe(201);
    const off = await ask(sid, 'как подписать договор ЭЦП');
    expect(off.data.status).toBe('disabled');
    expect(db().help.questions.length).toBe(1);
    const s = await call<HelpSearchResult>(`/help/search?q=${encodeURIComponent('ЭЦП')}`, { sid });
    expect(s.status).toBe(200);
    expect(s.data.articles.length).toBeGreaterThan(0);
    expect((await call<{ scenarios: Record<string, boolean> }>('/ai/status', { sid })).data.scenarios.help).toBe(false);
  });
});
