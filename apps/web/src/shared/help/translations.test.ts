// @vitest-environment node
/*
 * Translations of the user guide (docs/help/USER_GUIDE.uz-Latn.md, USER_GUIDE.en.md) are structurally
 * aligned with the Russian file: the same articles and subsections with the same anchors and numbers, the
 * same audience markers in the same order, the same table shapes. A misaligned part would silently be
 * served in Russian with `fallback: true`, so the test also checks the served content for every role and
 * the API itself.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@mig/contracts';
import type { SessionResponse } from '@mig/contracts/dto';
import type { HelpGuide, HelpLocale } from '@mig/contracts/help';
import { contentFor, guideFor } from '@/mocks/help-content';
import { createMockServer } from '@/mocks/node';
import { lastSession, track, withSession } from '@/mocks/test-session';
import { resetDb } from '@/mocks/db';
import { ALL_ROLES } from './audience';
import { articlesFor, parseGuide, type GuidePart, type ParsedGuide } from './guide';
import { parseGlossary } from './glossary';
import { parseMarkdown } from './markdown';

const read = (locale: string) => readFileSync(resolve(__dirname, `../../../../../docs/help/USER_GUIDE.${locale}.md`), 'utf8');
const RU_TEXT = read('ru');
const RU = parseGuide(RU_TEXT);
const TRANSLATIONS: HelpLocale[] = ['uz-Latn', 'en'];

const parts = (g: ParsedGuide): GuidePart[] => g.articles.flatMap((a) => [a, ...a.sections]);

/** Shape of the blocks of a part: tables as `table:<columns>x<rows>`, lists as `list:<items>`. */
function shape(part: GuidePart): string[] {
  return parseMarkdown(part.lines.map((l) => l.text).join('\n')).flatMap((b) => {
    if (b.type === 'table') return [`table:${b.header.length}x${b.rows.length}`];
    if (b.type === 'list') return [`list:${b.ordered ? 'ol' : 'ul'}:${b.items.length}`];
    return [];
  });
}

describe.each(TRANSLATIONS)('USER_GUIDE.%s.md', (locale) => {
  const text = read(locale);
  const tr = parseGuide(text);

  it('parses without markup errors and has a title, a version line and the review note', () => {
    expect(tr.errors).toEqual([]);
    expect(tr.title).not.toBe(RU.title);
    expect(tr.version).toContain('1.0');
    expect(text.split('\n')[0]).toMatch(
      locale === 'en'
        ? /^<!-- Translation pending MIG review\./
        : /^<!-- Tarjima MIG tomonidan tekshirilishi kerak\./,
    );
  });

  it('has the same articles and subsections with the same anchors, numbers and order', () => {
    expect(tr.articles.map((a) => [a.number, a.anchor])).toEqual(
      RU.articles.map((a) => [a.number, a.anchor]),
    );
    expect(parts(tr).map((p) => p.anchor)).toEqual(parts(RU).map((p) => p.anchor));
    const headings = (t: string) =>
      t
        .split('\n')
        .filter((l) => /^#{1,3}\s/.test(l))
        .map((l) => `${l.split(' ')[0]} ${/\{#([a-z0-9-]+)\}$/.exec(l)?.[1] ?? ''}`);
    expect(headings(text)).toEqual(headings(RU_TEXT));
  });

  it('repeats every audience marker of every part in the same order', () => {
    const ruParts = parts(RU);
    parts(tr).forEach((p, i) => expect(p.markers, p.anchor).toEqual(ruParts[i]!.markers));
    const markers = (t: string) => t.match(/<!--\s*(?:audience:[^>]*?|\/audience)\s*-->/g) ?? [];
    expect(markers(text)).toEqual(markers(RU_TEXT));
  });

  it('keeps the shape of lists and tables, and every line keeps the audience of the Russian line', () => {
    const ruParts = parts(RU);
    parts(tr).forEach((p, i) => expect(shape(p), p.anchor).toEqual(shape(ruParts[i]!)));
    // The marker-bearing lines are the same lines: the n-th trailing marker sits on the same kind of line.
    const trailing = (t: string) =>
      t
        .split('\n')
        .filter((l) => /\S\s*<!--\s*audience:/.test(l))
        .map((l) => (l.trimStart().startsWith('|') ? '|' : l.trimStart().slice(0, 2)));
    expect(trailing(text)).toEqual(trailing(RU_TEXT));
  });

  it('keeps the glossary rows (one term per Russian term) and document data unchanged', () => {
    const glossary = (g: ParsedGuide) =>
      g.articles
        .find((a) => a.anchor === 'glossary')!
        .lines.map((l) => l.text)
        .join('\n');
    expect(parseGlossary(glossary(tr))).toHaveLength(parseGlossary(glossary(RU)).length);
    for (const literal of RU_TEXT.match(/`[^`]+`/g) ?? []) expect(text, literal).toContain(literal);
    for (const n of ['+998 90 000 00 01', '+998 90 000 00 02', '000000']) expect(text).toContain(n);
  });

  it('is served without the Russian fallback to every role, demo build or not', () => {
    const g = guideFor(locale);
    expect(g.articles.filter((a) => a.fallback).map((a) => a.part.anchor)).toEqual([]);
    expect(g.articles.flatMap((a) => a.sections.filter((s) => s.fallback).map((s) => s.part.anchor))).toEqual(
      [],
    );
    for (const role of ALL_ROLES as readonly Role[]) {
      for (const demo of [true, false]) {
        const served = contentFor(role, locale, demo).articles;
        const ru = articlesFor(guideFor('ru'), role, demo);
        expect(
          served.map((a) => [a.anchor, a.sections.map((s) => s.anchor)]),
          `${role} ${demo}`,
        ).toEqual(ru.map((a) => [a.anchor, a.sections.map((s) => s.anchor)]));
        expect(
          served.some((a) => a.fallback || a.sections.some((s) => s.fallback)),
          `${role} ${demo}`,
        ).toBe(false);
      }
    }
  });
});

describe('USER_GUIDE.uz-Latn.md spelling', () => {
  it('uses ʻ (U+02BB) and ʼ (U+02BC), never ASCII or typographic apostrophes, and oʻ / gʻ with the turned comma', () => {
    const text = read('uz-Latn');
    // Code spans (`Demo-2026!`) aside.
    const prose = text.replace(/`[^`]*`/g, '');
    const bad = prose.split('\n').filter((l) => /['’‘]/.test(l));
    expect(bad).toEqual([]);
    expect(prose.split('\n').filter((l) => /[OoGg]ʼ/.test(l))).toEqual([]);
  });

  it('contains no Cyrillic outside glossary equivalents and the watermark name', () => {
    for (const locale of TRANSLATIONS) {
      const lines = read(locale)
        .split('\n')
        .filter((l) => /[А-Яа-яЁё]/.test(l))
        // Glossary rows name the Russian equivalent in parentheses; the search finds the term by it.
        .filter((l) => !/^\| \*\*[^|]*\*\* \([^)]*[А-Яа-яЁё][^)]*\) \|/.test(l))
        // Russian examples kept as typed: the search transliteration and the template watermark.
        .filter((l) => !/«Ташкент»|“Ташкент”|ШАБЛОН-ЗАГЛУШКА/.test(l));
      expect(lines, locale).toEqual([]);
    }
  });
});

describe('GET /api/help in translations', () => {
  const BASE = 'http://localhost/api';
  const server = createMockServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => server.close());
  beforeEach(() => resetDb());

  async function call<T>(
    path: string,
    init: { method?: string; sid?: string; json?: unknown } = {},
  ): Promise<{ status: number; data: T }> {
    const headers = new Headers();
    withSession(headers, init.sid);
    if (init.json !== undefined) headers.set('Content-Type', 'application/json');
    const res = track(await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    }));
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
  }
  async function login(email: string): Promise<string> {
    const a = await call<{ challengeId: string }>('/auth/login', {
      method: 'POST',
      json: { email, password: 'Demo-2026!' },
    });
    await call<SessionResponse>('/auth/otp', {
      method: 'POST',
      json: { challengeId: a.data.challengeId, code: '000000' },
    });
    return lastSession();
  }
  async function loginPhone(phone: string): Promise<string> {
    const a = await call<{ challengeId: string }>('/auth/phone', { method: 'POST', json: { phone } });
    await call<SessionResponse>('/auth/phone/verify', {
      method: 'POST',
      json: { challengeId: a.data.challengeId, code: '000000' },
    });
    return lastSession();
  }

  it('returns no `fallback: true` part for staff, HR, insured, clinic and assistance users', async () => {
    const sessions = [
      await login('admin@demo.mig.uz'),
      await login('claims@demo.mig.uz'),
      await login('hr@demo-client.uz'),
      await login('registrar@demo-clinic.uz'),
      await login('asst-operator@demo-assist.uz'),
      await loginPhone('+998900000001'),
    ];
    for (const sid of sessions) {
      for (const locale of TRANSLATIONS) {
        const r = await call<HelpGuide>(`/help?locale=${locale}`, { sid });
        expect(r.status).toBe(200);
        expect(r.data.locale).toBe(locale);
        expect(r.data.articles.length).toBeGreaterThan(0);
        const fallbacks = r.data.articles.flatMap((a) => [
          ...(a.fallback ? [a.anchor] : []),
          ...a.sections.filter((s) => s.fallback).map((s) => s.anchor),
        ]);
        expect(fallbacks, `${r.data.role} ${locale}`).toEqual([]);
      }
    }
  });
});
