// @vitest-environment node
/*
 * Golden set of «Задать вопрос» (help.answer): the expected subsection is among the first three sources
 * in at least `threshold` of the cases, and questions outside the role's part of the guide get no answer.
 */
import { describe, expect, it } from 'vitest';
import type { Role } from '@/shared/types';
import { ALL_ROLES } from '@/shared/help/audience';
import { answerQuestion } from '@/shared/help/answer';
import { contentFor, russianGuide } from '@/mocks/help-content';
import golden from './golden.json';

interface Case {
  role: string;
  question: string;
  expected: string[];
}

const isRole = (r: string): r is Role => (ALL_ROLES as readonly string[]).includes(r);

describe('help answers: golden set', () => {
  const cases = golden.cases as Case[];

  it('has 40 questions over every portal, with existing anchors visible to the role', () => {
    expect(cases).toHaveLength(40);
    const anchors = new Set(russianGuide().articles.flatMap((a) => [a.anchor, ...a.sections.map((s) => s.anchor)]));
    const portals = new Set<string>();
    for (const c of cases) {
      expect(isRole(c.role), c.role).toBe(true);
      const visible = new Set(contentFor(c.role as Role, 'ru').articles.flatMap((a) => [a.anchor, ...a.sections.map((s) => s.anchor)]));
      for (const a of c.expected) {
        expect(anchors.has(a), a).toBe(true);
        expect(visible.has(a), `${c.role}: ${a}`).toBe(true);
      }
      portals.add(c.role.startsWith('clinic') ? 'clinic' : c.role.startsWith('asst') ? 'assist' : c.role === 'hr' || c.role === 'insured' ? c.role : 'staff');
    }
    expect([...portals].sort()).toEqual(['assist', 'clinic', 'hr', 'insured', 'staff']);
  });

  it(`finds the expected subsection in the top 3 sources in at least ${Math.round(golden.threshold * 100)}% of cases`, () => {
    const misses: string[] = [];
    for (const c of cases) {
      const a = answerQuestion(contentFor(c.role as Role, 'ru').index, c.question);
      const top = a.sources.slice(0, 3).map((s) => s.anchor);
      if (a.status !== 'answered' || !c.expected.some((e) => top.includes(e))) misses.push(`${c.role}: ${c.question} → ${a.status} [${top.join(', ')}]`);
    }
    const accuracy = (cases.length - misses.length) / cases.length;
    expect(accuracy, misses.join('\n')).toBeGreaterThanOrEqual(golden.threshold);
  });

  it('gives no answer outside the role, e.g. HR asking about fraud', () => {
    for (const c of golden.noAnswer) {
      const a = answerQuestion(contentFor(c.role as Role, 'ru').index, c.question);
      expect(a, `${c.role}: ${c.question}`).toMatchObject({ status: 'no_answer', sources: [], steps: [] });
    }
  });
});
