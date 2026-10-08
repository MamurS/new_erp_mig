import { describe, expect, it } from 'vitest';
import { claimTransitions, requiresMedicalReview } from './claims';
import { canDecideLimitRequest } from './limits';

const operator = { id: 'op-1', role: 'operator' as const };
const accountant = { id: 'acc-1', role: 'accountant' as const };
const underwriter = { id: 'uw-1', role: 'underwriter' as const };

describe('medical review rule', () => {
  it('dental, inpatient or > 5 000 000 require medical review', () => {
    expect(requiresMedicalReview({ category: 'dental', amountClaimed: 100 })).toBe(true);
    expect(requiresMedicalReview({ category: 'inpatient', amountClaimed: 100 })).toBe(true);
    expect(requiresMedicalReview({ category: 'medicines', amountClaimed: 5_000_001 })).toBe(true);
    expect(requiresMedicalReview({ category: 'medicines', amountClaimed: 5_000_000 })).toBe(false);
  });

  it('blocks review → approved when medical review is required', () => {
    const t = claimTransitions(operator, { status: 'review', category: 'dental', amountClaimed: 300_000 });
    expect(t.allowed).toEqual(['medical_review', 'rejected']);
    expect(t.blocked.map((b) => b.to)).toEqual(['approved']);
  });

  it('allows review → approved otherwise', () => {
    const t = claimTransitions(operator, { status: 'review', category: 'medicines', amountClaimed: 300_000 });
    expect(t.allowed).toContain('approved');
  });
});

describe('four eyes', () => {
  it('approver cannot mark paid', () => {
    const t = claimTransitions(accountant, {
      status: 'to_pay',
      category: 'medicines',
      amountClaimed: 1,
      approvedById: accountant.id,
    });
    expect(t.allowed).toEqual([]);
    expect(t.blocked[0]?.to).toBe('paid');
    const other = claimTransitions(accountant, {
      status: 'to_pay',
      category: 'medicines',
      amountClaimed: 1,
      approvedById: 'someone-else',
    });
    expect(other.allowed).toEqual(['paid']);
  });

  it('author cannot decide own limit request', () => {
    expect(canDecideLimitRequest(underwriter, { requestedById: underwriter.id, status: 'pending' })).toBe(false);
    expect(canDecideLimitRequest(underwriter, { requestedById: 'op-1', status: 'pending' })).toBe(true);
    expect(canDecideLimitRequest(underwriter, { requestedById: 'op-1', status: 'approved' })).toBe(false);
    expect(canDecideLimitRequest(operator, { requestedById: 'x', status: 'pending' })).toBe(false);
  });
});
