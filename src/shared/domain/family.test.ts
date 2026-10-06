/* Family members (FAMILY_SPEC): the age limit, who sees what in a family, shared limits (the premium: pricing.test.ts). */
import { describe, expect, it } from 'vitest';
import { ageLimitDate, ageOn, allows, familyAccess, isAdultMember, isDependentChild, limitPoolOf, reachedAgeLimit, type FamilyPerson } from './family';

const LIMITS = { maxChildAge: 18, studentMaxAge: 23 };
const EMPLOYEE: FamilyPerson = { id: 'e1', relation: 'employee', birthDate: '1987-05-12' };
const SPOUSE: FamilyPerson = { id: 's1', relation: 'spouse', principalId: 'e1', birthDate: '1989-08-21' };
const CHILD: FamilyPerson = { id: 'c1', relation: 'child', principalId: 'e1', birthDate: '2016-03-09' };
const GROWN: FamilyPerson = { id: 'c2', relation: 'child', principalId: 'e1', birthDate: '2008-10-06' };
const PARENT: FamilyPerson = { id: 'p1', relation: 'parent', principalId: 'e1', birthDate: '1960-01-01' };
const OTHER_EMPLOYEE: FamilyPerson = { id: 'e2', relation: 'employee', birthDate: '1980-01-01' };
const OTHER_CHILD: FamilyPerson = { id: 'c9', relation: 'child', principalId: 'e2', birthDate: '2015-01-01' };
const TODAY = '2026-10-06';

describe('age and the child age limit', () => {
  it('counts full years', () => {
    expect(ageOn('2008-10-06', '2026-10-05')).toBe(17);
    expect(ageOn('2008-10-06', '2026-10-06')).toBe(18);
    expect(ageOn('1987-05-12', TODAY)).toBe(39);
  });

  it('crossing maxChildAge: a dependent child the day before the 18th birthday, a task from the birthday on', () => {
    expect(ageLimitDate(GROWN, LIMITS)).toBe('2026-10-06');
    expect(isDependentChild(GROWN, '2026-10-05', LIMITS)).toBe(true);
    expect(reachedAgeLimit(GROWN, '2026-10-05', LIMITS)).toBe(false);
    expect(isDependentChild(GROWN, '2026-10-06', LIMITS)).toBe(false);
    expect(reachedAgeLimit(GROWN, '2026-10-06', LIMITS)).toBe(true);
    // No task for an excluded child or for an adult who is not a child.
    expect(reachedAgeLimit({ ...GROWN, status: 'excluded' }, '2026-10-06', LIMITS)).toBe(false);
    expect(reachedAgeLimit(SPOUSE, TODAY, LIMITS)).toBe(false);
  });

  it('a full-time student is covered as a child until studentMaxAge; the limits are parameters', () => {
    const student = { ...GROWN, isStudent: true };
    expect(ageLimitDate(student, LIMITS)).toBe('2031-10-06');
    expect(isDependentChild(student, '2031-10-05', LIMITS)).toBe(true);
    expect(reachedAgeLimit(student, '2031-10-06', LIMITS)).toBe(true);
    expect(isDependentChild(GROWN, '2026-10-06', { maxChildAge: 21, studentMaxAge: 23 })).toBe(true);
    // 29 February: the limit falls on 28 February of a common year.
    expect(ageLimitDate({ birthDate: '2008-02-29' }, LIMITS)).toBe('2026-02-28');
  });

  it('adults of the family sign in with an own phone: spouse, parent, a child over the limit', () => {
    expect([SPOUSE, PARENT, GROWN, CHILD, EMPLOYEE].map((p) => isAdultMember(p, TODAY, LIMITS))).toEqual([true, true, true, false, false]);
  });
});

describe('who in the family sees what', () => {
  const ctx = (consents: [string, string][] = []) => ({ today: TODAY, limits: LIMITS, consent: (o: string, v: string) => consents.some(([a, b]) => a === o && b === v) });

  it('the employee sees a child under the age limit fully', () => {
    expect(familyAccess(EMPLOYEE, CHILD, ctx())).toBe('full');
    expect(allows('full', 'medical')).toBe(true);
  });

  it('the employee sees an adult member only as insured (certificate, QR) until the adult allows more', () => {
    for (const adult of [SPOUSE, PARENT, GROWN]) {
      const level = familyAccess(EMPLOYEE, adult, ctx());
      expect(level, adult.id).toBe('basic');
      expect(allows(level, 'card')).toBe(true);
      expect(allows(level, 'medical')).toBe(false);
    }
    expect(familyAccess(EMPLOYEE, SPOUSE, ctx([['s1', 'e1']]))).toBe('full');
    // A consent is personal: the spouse's consent does not open the parent.
    expect(familyAccess(EMPLOYEE, PARENT, ctx([['s1', 'e1']]))).toBe('basic');
  });

  it('an adult member sees only themselves; nobody sees another family (IDOR: the server answers 404)', () => {
    expect(familyAccess(SPOUSE, SPOUSE, ctx())).toBe('self');
    expect(familyAccess(SPOUSE, EMPLOYEE, ctx())).toBe('none');
    expect(familyAccess(SPOUSE, CHILD, ctx())).toBe('none');
    expect(familyAccess(EMPLOYEE, OTHER_CHILD, ctx())).toBe('none');
    expect(familyAccess(EMPLOYEE, OTHER_EMPLOYEE, ctx())).toBe('none');
    expect(familyAccess(OTHER_EMPLOYEE, SPOUSE, ctx([['s1', 'e2']]))).toBe('none');
    expect(familyAccess(EMPLOYEE, { ...CHILD, status: 'excluded' }, ctx())).toBe('none');
    expect(allows('none', 'card')).toBe(false);
  });
});

describe('limit mode', () => {
  const people = [EMPLOYEE, SPOUSE, CHILD, OTHER_EMPLOYEE, OTHER_CHILD].map((p) => ({ ...p, policyId: 'P' }));
  it('individual: own consumption; family_shared: one pool of the family on the policy', () => {
    expect(limitPoolOf(people[2]!, people, 'individual')).toEqual(['c1']);
    expect(limitPoolOf(people[2]!, people, 'family_shared').sort()).toEqual(['c1', 'e1', 's1']);
    expect(limitPoolOf(people[0]!, people, 'family_shared').sort()).toEqual(['c1', 'e1', 's1']);
    expect(limitPoolOf(people[3]!, people, 'family_shared').sort()).toEqual(['c9', 'e2']);
    // Another policy is another pool.
    expect(limitPoolOf(people[2]!, [...people, { ...SPOUSE, id: 's2', policyId: 'Q' }], 'family_shared')).not.toContain('s2');
  });
});
