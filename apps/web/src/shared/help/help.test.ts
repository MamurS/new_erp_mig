// @vitest-environment node
/*
 * Help module: markdown parsing and anchors, audience markers and role filtering, translations with a
 * fallback, normalisation and synonyms of the search, assembly of answers.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Role } from '@mig/contracts';
import { contentFor, guideFor, russianGuide } from '@/mocks/help-content';
import { ALL_ROLES, audienceVisible, parseAudience } from './audience';
import { articlesFor, localizeGuide, parseGuide } from './guide';
import { parseGlossary, splitTerms } from './glossary';
import { blocksText, inlineText, parseInline, parseMarkdown, sentences } from './markdown';
import { editDistance, searchHelp, stem, words } from './search';
import { answerQuestion } from './answer';
import { stripDemoArticles } from './demoStrip';
import { STAFF_ROLES } from '@mig/domain/labels';

const EXTERNAL: Role[] = ['hr', 'insured', 'clinic_registrar', 'clinic_admin', 'asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'];
const RU = readFileSync(resolve(__dirname, '../../../../../docs/help/USER_GUIDE.ru.md'), 'utf8');

describe('the guide file', () => {
  const g = russianGuide();

  it('parses without markup errors: every ## and ### has an anchor and an audience', () => {
    expect(g.errors).toEqual([]);
    expect(g.title).toMatch(/Руководство/);
    expect(g.version).toMatch(/Версия/);
    expect(g.articles).toHaveLength(20);
    const headings = RU.split('\n').filter((l) => /^#{2,3}\s/.test(l));
    expect(headings.every((h) => /\{#[a-z0-9][a-z0-9-]*\}$/.test(h)), 'every heading ends with {#anchor}').toBe(true);
    const anchors = g.articles.flatMap((a) => [a.anchor, ...a.sections.map((s) => s.anchor)]);
    expect(anchors).toHaveLength(headings.length);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const a of anchors) expect(a).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(g.articles.map((a) => a.number)).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
  });

  it('has the anchors other parts of the system rely on', () => {
    const anchors = new Set(g.articles.flatMap((a) => [a.anchor, ...a.sections.map((s) => s.anchor)]));
    for (const a of ['glossary', 'new-client', 'kp', 'guarantee-letter', 'claims-fraud', 'manual-allocation', 'admin-params', 'portfolio-migration', 'troubleshooting', 'statuses', 'demo']) expect(anchors.has(a), a).toBe(true);
  });

  it('marks the audience of every subsection; the fraud subsection is MIG-only', () => {
    const fraud = g.articles.flatMap((a) => a.sections).find((s) => s.anchor === 'claims-fraud')!;
    expect([...fraud.audience.roles].sort()).toEqual([...STAFF_ROLES].sort());
    const migration = g.articles.find((a) => a.anchor === 'portfolio-migration')!;
    expect([...migration.audience.roles]).toEqual(['admin']);
    expect(g.articles.find((a) => a.anchor === 'demo')!.audience.demoOnly).toBe(true);
  });
});

describe('audience markers', () => {
  it('maps the vocabulary to roles', () => {
    expect(parseAudience('all').roles.size).toBe(ALL_ROLES.length);
    expect([...parseAudience('staff').roles]).toEqual([...STAFF_ROLES]);
    expect([...parseAudience('staff:admin').roles]).toEqual(['admin']);
    expect([...parseAudience('clinic').roles]).toEqual(['clinic_registrar', 'clinic_admin']);
    expect([...parseAudience('clinic:admin').roles]).toEqual(['clinic_admin']);
    expect([...parseAudience('assist:billing hr').roles]).toEqual(['asst_billing', 'hr']);
    const demo = parseAudience('demo');
    expect(demo.demoOnly).toBe(true);
    expect(audienceVisible(demo, 'hr', false)).toBe(false);
    expect(audienceVisible(demo, 'hr', true)).toBe(true);
    expect(() => parseAudience('everyone')).toThrow();
    expect(() => parseAudience('staff:boss')).toThrow();
  });

  const SAMPLE = [
    '# Guide',
    '',
    'v1',
    '',
    '## 1. Intro {#intro}',
    '',
    '<!-- audience: all -->',
    '',
    'For all.',
    '',
    '### Internal {#internal}',
    '',
    '<!-- audience: staff -->',
    '',
    'Secret of MIG.',
    '',
    '### Mixed {#mixed}',
    '',
    '<!-- audience: staff hr -->',
    '',
    '<!-- audience: staff -->',
    'Staff block.',
    '',
    '- staff item one',
    '<!-- /audience -->',
    '',
    'Shared text.',
    '',
    '- item for hr too',
    '- staff only item <!-- audience: staff -->',
    '   - nested line of the staff item',
    '- insured item that hr must not see <!-- audience: insured -->',
    '',
    '| A | B |',
    '| --- | --- |',
    '| row staff | x | <!-- audience: staff -->',
    '| row all | y | <!-- audience: all -->',
    '',
    '| C | D |',
    '| --- | --- |',
    '| only staff | z | <!-- audience: staff -->',
  ].join('\n');

  it('filters blocks, list items and table rows; nested levels narrow; empty tables disappear', () => {
    const g = parseGuide(SAMPLE);
    expect(g.errors).toEqual([]);
    const loc = localizeGuide(g, 'ru', null);
    const hr = articlesFor(loc, 'hr', false);
    expect(hr[0]!.sections.map((s) => s.anchor)).toEqual(['mixed']);
    const md = hr[0]!.sections[0]!.markdown;
    expect(md).toContain('Shared text.');
    expect(md).toContain('item for hr too');
    expect(md).toContain('| row all | y |');
    for (const hidden of ['Staff block', 'staff item one', 'staff only item', 'nested line', 'insured item', 'row staff', 'only staff', '| C | D |', 'audience']) expect(md).not.toContain(hidden);
    const admin = articlesFor(loc, 'admin', false)[0]!.sections.find((s) => s.anchor === 'mixed')!.markdown;
    for (const shown of ['Staff block', 'staff only item', 'nested line', 'row staff', 'only staff']) expect(admin).toContain(shown);
    // A marker never widens: «insured» inside a «staff hr» subsection is visible to nobody.
    expect(admin).not.toContain('insured item');
    expect(articlesFor(loc, 'insured', false)[0]!.sections).toEqual([]);
  });

  it('reports headings without an anchor or an audience and unknown tokens', () => {
    const g = parseGuide('## 1. A\n\ntext\n\n### B {#b}\n\n<!-- audience: nobody -->\n');
    expect(g.errors.join('\n')).toMatch(/no anchor/);
    expect(g.errors.join('\n')).toMatch(/no audience/);
    expect(g.errors.join('\n')).toMatch(/unknown audience token: nobody/);
    // Without a marker an article is MIG-only (the safe default).
    expect(articlesFor(localizeGuide(g, 'ru', null), 'hr', false)).toEqual([]);
  });
});

describe('filtering by role on the real guide', () => {
  it('external roles never get MIG-only content, in particular the fraud subsection', () => {
    for (const role of EXTERNAL) {
      const { articles, index } = contentFor(role, 'ru', true);
      const all = JSON.stringify(articles);
      expect(all, role).not.toMatch(/мошеннич/i);
      expect(all, role).not.toContain('claims-fraud');
      expect(all, role).not.toContain('повтор чека');
      expect(index.units.some((u) => /мошеннич/i.test(u.text) || u.anchor === 'claims-fraud'), role).toBe(false);
      expect(articles.some((a) => a.anchor === 'portfolio-migration' || a.anchor === 'claims' || a.anchor === 'finance'), role).toBe(false);
      const s = searchHelp(index, 'мошенничество флаг повтор чека');
      expect(JSON.stringify([s.terms, s.articles]), role).not.toMatch(/мошеннич|claims-fraud/i);
      const a = answerQuestion(index, 'какие признаки мошенничества');
      expect(a.status, role).toBe('no_answer');
    }
  });

  it('gives each role its parts', () => {
    const anchors = (role: Role) => contentFor(role, 'ru').articles.flatMap((a) => [a.anchor, ...a.sections.map((s) => s.anchor)]);
    expect(anchors('hr')).toEqual(expect.arrayContaining(['guide-hr', 'kp', 'enrolment', 'family', 'signing-methods', 'troubleshooting', 'glossary']));
    expect(anchors('hr')).not.toContain('guide-insured');
    expect(anchors('insured')).toEqual(expect.arrayContaining(['guide-insured', 'appointment', 'receipt-refund', 'coverage-check']));
    expect(anchors('insured')).not.toContain('guarantee-letter');
    expect(anchors('clinic_registrar')).toEqual(expect.arrayContaining(['patient-check', 'guarantee-letter', 'guide-clinic', 'admin-integrations']));
    expect(anchors('asst_operator')).toEqual(expect.arrayContaining(['assistance-rebill', 'monthly-registry', 'guide-assistance', 'admin-integrations']));
    expect(anchors('asst_operator')).not.toContain('assistance-qa');
    expect(anchors('admin')).toContain('portfolio-migration');
    expect(anchors('accountant')).not.toContain('portfolio-migration');
    expect(anchors('accountant')).toContain('claims-fraud');

    // HR: «Ответ клиента» of stage 4 without MIG's steps; the troubleshooting rows about employees only.
    const kp = contentFor('hr', 'ru').articles.find((a) => a.anchor === 'new-client')!.sections.find((s) => s.anchor === 'kp')!.markdown;
    expect(kp).toContain('Ответ клиента');
    expect(kp).not.toContain('Подготовить КП');
    const rows = contentFor('hr', 'ru').articles.find((a) => a.anchor === 'troubleshooting')!.markdown;
    expect(rows).toContain('Сотрудник клиента уволился');
    expect(rows).not.toContain('Платёж не разнёсся');
    // Clinics see the partner's part of «Интеграции», not what MIG sees of it.
    const integ = contentFor('clinic_admin', 'ru').articles.find((a) => a.anchor === 'administration')!;
    expect(integ.markdown).toBe('');
    expect(integ.sections.map((s) => s.anchor)).toEqual(['admin-integrations']);
    expect(integ.sections[0]!.markdown).toContain('Ключи API');
    expect(integ.sections[0]!.markdown).not.toContain('может отозвать любой ключ');
  });

  it('shows the demo article only in a demo build', () => {
    expect(contentFor('hr', 'ru', false).articles.some((a) => a.anchor === 'demo')).toBe(false);
    expect(contentFor('hr', 'ru', true).articles.some((a) => a.anchor === 'demo')).toBe(true);
  });

  it('a build without the demo flag does not even contain the demo article', () => {
    const stripped = stripDemoArticles(RU);
    expect(stripped).not.toContain('Демо-версия');
    expect(stripped).not.toContain('Demo-2026!');
    expect(stripped).not.toContain('Войти как');
    expect(stripped).toContain('## 19. Справочник статусов');
    expect(parseGuide(stripped).errors).toEqual([]);
  });
});

describe('translations', () => {
  const ru = parseGuide(['# T', '', '## 1. Один {#one}', '', '<!-- audience: all -->', '', 'Текст.', '', '### Два {#two}', '', '<!-- audience: staff -->', '', 'Секрет.'].join('\n'));

  it('uses translated parts with the same anchors and markers, Russian with `fallback` otherwise', () => {
    const en = parseGuide(['# T', '', '## 1. One {#one}', '', '<!-- audience: all -->', '', 'Text.'].join('\n'));
    const g = localizeGuide(ru, 'en', en);
    const staff = articlesFor(g, 'admin', false);
    expect(staff[0]).toMatchObject({ title: 'One', markdown: 'Text.', fallback: false });
    expect(staff[0]!.sections[0]).toMatchObject({ title: 'Два', markdown: 'Секрет.', fallback: true });
  });

  it('a translation cannot widen access: different markers mean the Russian part', () => {
    const tr = parseGuide(['# T', '', '## 1. One {#one}', '', '<!-- audience: all -->', '', 'Text.', '', '### Two {#two}', '', '<!-- audience: all -->', '', 'Secret.'].join('\n'));
    const g = localizeGuide(ru, 'uz-Latn', tr);
    expect(articlesFor(g, 'hr', false)[0]!.sections).toEqual([]);
    expect(articlesFor(g, 'admin', false)[0]!.sections[0]).toMatchObject({ markdown: 'Секрет.', fallback: true });
  });

  it('without translation files every part is Russian with `fallback: true`', () => {
    const g = guideFor('en');
    if (g.articles.every((a) => a.fallback)) expect(articlesFor(g, 'hr', false).every((a) => a.fallback && a.sections.every((s) => s.fallback))).toBe(true);
    expect(articlesFor(guideFor('ru'), 'hr', false).every((a) => !a.fallback)).toBe(true);
  });
});

describe('markdown subset', () => {
  it('parses headings with anchors, nested lists, tables, inline markup; drops comments', () => {
    const b = parseMarkdown(['### Title {#a-b}', '', '1. **Bold** and *em* and `co|de`', '   - nested _it_', '2. [link](#target) <!-- audience: staff -->', '', '| A | B |', '| --- | --- |', '| `x|y` | **z** |', '', '> quote'].join('\n'));
    expect(b[0]).toMatchObject({ type: 'heading', level: 3, anchor: 'a-b' });
    expect(b[1]).toMatchObject({ type: 'list', ordered: true });
    const list = b[1] as Extract<(typeof b)[number], { type: 'list' }>;
    expect(list.items).toHaveLength(2);
    expect(list.items[0]!.children[1]).toMatchObject({ type: 'list', ordered: false });
    expect(list.items[1]!.children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'link', href: '#target' }] });
    expect(b[2]).toMatchObject({ type: 'table', rows: [[[{ type: 'code', text: 'x|y' }], [{ type: 'strong' }]]] });
    expect(b[3]).toMatchObject({ type: 'blockquote' });
    expect(blocksText(b)).not.toContain('audience');
    expect(parseInline('a_b_c **x** `y`').map((n) => n.type)).toEqual(['text', 'strong', 'text', 'code']);
    expect(inlineText(parseInline('<script>alert(1)</script>'))).toBe('<script>alert(1)</script>');
  });

  it('splits sentences without breaking at abbreviations', () => {
    expect(sentences('Услуга (МРТ и т. п.) оплачена. Второе предложение!')).toEqual(['Услуга (МРТ и т. п.) оплачена.', 'Второе предложение!']);
  });
});

describe('search: normalisation, typos, synonyms', () => {
  const idx = contentFor('accountant', 'ru').index;
  const found = (q: string) => searchHelp(idx, q);

  it('normalises like searchNormalize: Cyrillic ↔ Latin, ё, apostrophes', () => {
    expect(words('Платёж ПЛАТЕЖ platej')).toEqual(['platej', 'platej', 'platej']);
    expect(words('sugʻurta')).toEqual(['sugurta']);
    expect(stem('garantiynoe')).toBe('garantiyn');
    expect(editDistance('raznoska', 'raznsoka', 2)).toBe(1);
    expect(found('garantiynoe pismo').articles.map((a) => a.anchor)).toContain('guarantee-letter');
  });

  it('«гп» finds the term and «Гарантийное письмо»', () => {
    const r = found('гп');
    expect(r.terms[0]!.term.term).toBe('ГП — гарантийное письмо');
    expect(r.articles.some((a) => /Гарантийное письмо/.test(a.title))).toBe(true);
  });

  it('synonyms of the glossary and the extra list', () => {
    expect(found('ДС').terms[0]!.term.term).toMatch(/^ДС/);
    expect(found('доп. соглашение').terms.some((t) => t.term.term.startsWith('ДС'))).toBe(true);
    expect(found('доп соглашение').articles.some((a) => a.anchor === 'endorsement')).toBe(true);
    expect(found('коммерческое предложение').terms.some((t) => t.term.term.startsWith('КП'))).toBe(true);
    expect(found('JShShIR').terms.some((t) => t.term.term.startsWith('ПИНФЛ'))).toBe(true);
    expect(found('ИНН').terms.some((t) => t.term.term.startsWith('STIR'))).toBe(true);
    expect(found('E-IMZO').terms.some((t) => t.term.term.includes('ЭЦП'))).toBe(true);
    expect(found('ЭЦП').articles.some((a) => a.anchor === 'signing-methods')).toBe(true);
  });

  it('tolerates typos and inflections; highlights the match in the snippet', () => {
    expect(found('ручная разнска').articles[0]!.anchor).toBe('manual-allocation');
    expect(found('выписки 1С').articles.map((a) => a.anchor)).toContain('statement-1c');
    const hit = found('разноска').articles.find((a) => a.anchor === 'manual-allocation')!;
    expect(hit.snippet.some((p) => p.match)).toBe(true);
    expect(hit.snippet.map((p) => p.text).join('')).toMatch(/разнос/i);
  });

  it('returns nothing for an empty query or noise', () => {
    expect(found('   ')).toEqual({ query: '', terms: [], articles: [] });
    expect(found('qwzx').articles).toEqual([]);
  });
});

describe('answers', () => {
  const plain = (role: Role) => contentFor(role, 'ru').index.units.map((u) => u.text).join('\n').replace(/\s+/g, ' ');

  it('«как разнести платёж от другой компании»: steps of «Ручная разноска» with the source', () => {
    const a = answerQuestion(contentFor('accountant', 'ru').index, 'как разнести платёж от другой компании', { openRoutes: (t) => (t.includes('«Ручная разноска»') ? [{ route: '/staff/invoices/queue', label: 'Ручная разноска' }] : []) });
    expect(a.status).toBe('answered');
    expect(a.sources[0]!.anchor).toBe('manual-allocation');
    expect(a.sources[0]!.articleAnchor).toBe('finance');
    expect(a.steps.length).toBeGreaterThanOrEqual(3);
    expect(a.steps.join(' ')).toMatch(/комментарий обязателен/);
    expect(a.openRoutes).toEqual([{ route: '/staff/invoices/queue', label: 'Ручная разноска' }]);
  });

  it('is extractive: every line of an answer is text of the role-visible guide', () => {
    for (const [role, q] of [
      ['accountant', 'как загрузить выписку из 1С'],
      ['hr', 'как подписать договор ЭЦП'],
      ['insured', 'как вернуть деньги за чек'],
      ['clinic_admin', 'как отправить реестр за месяц'],
    ] as const) {
      const a = answerQuestion(contentFor(role, 'ru').index, q);
      expect(a.status, q).toBe('answered');
      expect(a.sources.length, q).toBeGreaterThan(0);
      const text = plain(role);
      for (const line of [a.short, ...a.steps, ...a.warnings]) {
        // Steps may join an item with its nested items («a; b»): each part is in the guide.
        for (const part of line.split('; ')) expect(text, `${q}: ${part}`).toContain(part.replace(/\s+/g, ' ').trim());
      }
    }
  });

  it('says honestly that there is no answer', () => {
    expect(answerQuestion(contentFor('hr', 'ru').index, 'как снять флаг мошенничества').status).toBe('no_answer');
    expect(answerQuestion(contentFor('insured', 'ru').index, 'как применить пакет переноса портфеля').status).toBe('no_answer');
    expect(answerQuestion(contentFor('admin', 'ru').index, 'погода в Ташкенте завтра').status).toBe('no_answer');
    expect(answerQuestion(contentFor('admin', 'ru').index, 'как').status).toBe('no_answer');
  });
});

describe('glossary', () => {
  const terms = parseGlossary(contentFor('hr', 'ru').articles.find((a) => a.anchor === 'glossary')!.markdown);

  it('parses terms with synonyms in other languages', () => {
    expect(terms.length).toBeGreaterThan(40);
    expect(terms.find((t) => t.id === 'gp')).toMatchObject({ term: 'ГП — гарантийное письмо', synonyms: ['ГП', 'гарантийное письмо'] });
    expect(terms.find((t) => t.term === 'ПИНФЛ')!.synonyms).toEqual(['ПИНФЛ', 'JShShIR', 'PINFL']);
    expect(terms.find((t) => t.term.startsWith('Страхователь'))!.synonyms).toEqual(expect.arrayContaining(['sugʻurta qildiruvchi', 'policyholder']));
    expect(new Set(terms.map((t) => t.id)).size).toBe(terms.length);
  });

  it('finds term mentions in a text, once per term with `seen`', () => {
    const seen = new Set<string>();
    const parts = splitTerms('Клиника запрашивает ГП, а ГП одобряет ассистанс; лимита не хватает.', terms, seen);
    expect(parts.filter((p) => p.term).map((p) => p.text)).toEqual(['ГП', 'ассистанс', 'лимита']);
    expect(parts.map((p) => p.text).join('')).toBe('Клиника запрашивает ГП, а ГП одобряет ассистанс; лимита не хватает.');
  });
});

it('every role sees the glossary and the common articles', () => {
  for (const role of ALL_ROLES) {
    const anchors = contentFor(role, 'ru').articles.map((a) => a.anchor);
    expect(anchors, role).toEqual(expect.arrayContaining(['about', 'getting-started', 'glossary', 'troubleshooting', 'security', 'statuses']));
  }
});
