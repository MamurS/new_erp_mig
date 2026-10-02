// @vitest-environment node
/*
 * Document templates (LIFECYCLE_SPEC §7.1): stub structure, escaping, watermark, the TEMPLATES.md
 * list, and the pinned hash of approved templates only.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KP_TEMPLATES } from '@/features/kp/templates';
import { fieldsOf, fillFields } from './html';
import { docSrcdoc, renderStubDocument, STUB_WATERMARK } from './render';
import { CLAUSE_CATALOG, clauseByRef, clauseLabel, DECISION_CLAUSES, DOC_TEMPLATES, stubText } from './templates';
import { templatesMarkdown } from './templatesDoc';

/** Approved templates and their pinned SHA-256. A stub (`approved: false`) is not pinned. */
const PINNED: Record<string, string> = {
  gold: '23829eaf1b483b0c2b2bc81609373c26a9279780922f7e1602d4b4b39155c124',
};
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('template hashes', () => {
  const all = [
    ...Object.values(KP_TEMPLATES).map((t) => ({ id: t.id as string, approved: t.approved, content: JSON.stringify(t.pages) })),
    ...Object.values(DOC_TEMPLATES).map((t) => ({ id: t.id as string, approved: t.approved, content: JSON.stringify(t) })),
  ];

  it('apply to approved templates only, and every approved template is pinned', () => {
    for (const t of all) {
      if (!t.approved) {
        expect(PINNED[t.id], `${t.id} is a stub and must not be pinned`).toBeUndefined();
        continue;
      }
      expect(sha256(t.content), t.id).toBe(PINNED[t.id]);
    }
    expect(Object.keys(PINNED).every((id) => all.some((t) => t.id === id && t.approved))).toBe(true);
  });

  it('the four stubs are not approved', () => {
    expect(Object.values(DOC_TEMPLATES).map((t) => [t.id, t.approved])).toEqual([
      ['contract', false],
      ['endorsement', false],
      ['certificate', false],
      ['claimDecisionLetter', false],
    ]);
  });
});

describe('stub templates', () => {
  it('have unique clause ids, stub texts and declared fields', () => {
    for (const t of Object.values(DOC_TEMPLATES)) {
      const ids = t.sections.flatMap((s) => s.clauses.map((c) => c.id));
      expect(new Set(ids).size, t.id).toBe(ids.length);
      const declared = new Set(t.fields.map((f) => f.key));
      const used = [t.heading, t.subheading ?? '', ...t.sections.flatMap((s) => [s.title, ...s.clauses.map((c) => c.data ?? '')])].flatMap(fieldsOf);
      for (const f of used) expect(declared.has(f), `${t.id}: {{${f}}} is not declared`).toBe(true);
      for (const s of t.sections) {
        for (const c of s.clauses) expect(c.text).toBe(stubText(c.id));
        if (s.table) expect(t.tables.some((x) => x.id === s.table), `${t.id}: table ${s.table}`).toBe(true);
      }
    }
  });

  it('the clause catalog has global refs and decision clauses', () => {
    expect(clauseByRef('contract:4.3')?.title).toBe('Исключения из страхового покрытия');
    expect(clauseLabel('contract:8.4')).toBe('п. 8.4 договора «Основания для отказа в выплате»');
    expect(DECISION_CLAUSES.every((c) => c.templateId === 'contract')).toBe(true);
    expect(DECISION_CLAUSES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(CLAUSE_CATALOG.map((c) => c.ref)).size).toBe(CLAUSE_CATALOG.length);
  });

  it('escape values and changed wording, mark missing fields, and put the watermark on every page', () => {
    const r = renderStubDocument({
      templateId: 'contract',
      title: 'Договор',
      values: { 'client.name': 'ООО «<img src=x onerror=alert(1)>»', 'contract.number': 'ДМС-Д-2026-000001' },
      overrides: { '4.3': '<script>alert(1)</script> новая формулировка' },
      showChanges: true,
      tables: { insured: Array.from({ length: 70 }, (_, i) => [String(i + 1), `Сотрудник ${i + 1}`, 'Инженер', '0']) },
    });
    const html = docSrcdoc(r);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; новая формулировка');
    expect(html).toContain('Исходный текст:');
    expect(html).toContain('<span class="missing">{{premium.total}}</span>');
    expect(r.pagesHtml.length).toBeGreaterThan(4);
    for (const p of r.pagesHtml) expect(p).toContain(STUB_WATERMARK);
    expect(r.pagesHtml.at(-1)).toContain(`Страница ${r.pagesHtml.length} из ${r.pagesHtml.length}`);
  });

  it('fillFields keeps text outside fields escaped', () => {
    expect(fillFields('a < {{x}} & {{y}}', { x: '"q"' })).toBe('a &lt; &quot;q&quot; &amp; <span class="missing">{{y}}</span>');
  });
});

describe('docs/TEMPLATES.md', () => {
  it('lists every template, clause and field (regenerate with UPDATE_TEMPLATES_MD=1)', () => {
    const file = resolve(__dirname, '../../../docs/TEMPLATES.md');
    const md = templatesMarkdown();
    if (process.env.UPDATE_TEMPLATES_MD === '1') writeFileSync(file, md);
    expect(readFileSync(file, 'utf8')).toBe(md);
  });
});
