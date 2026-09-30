import { describe, expect, it } from 'vitest';
import type { AssistanceAssignment } from '@/shared/types';
import { assistanceOn, assistanceScope, feeFor, inQaSample, limitLeft, payerOn, qaSample, rebillChecks, splitByPayer, type RebillLineFacts } from './assistance';

const P = 'pol';
const A1 = 'a1';
const A2 = 'a2';
const hist: AssistanceAssignment[] = [
  { policyId: P, assistanceId: A1, from: '2026-01-01', to: '2026-06-30', setById: 'u', setAt: '2026-01-01T00:00:00+05:00' },
  { policyId: P, assistanceId: A2, from: '2026-07-01', setById: 'u', setAt: '2026-06-20T00:00:00+05:00' },
];

describe('assignment on the date of the event (§3)', () => {
  it('finds the assistance or MIG by date', () => {
    expect(assistanceOn(hist, P, '2026-03-10')).toBe(A1);
    expect(assistanceOn(hist, P, '2026-06-30')).toBe(A1);
    expect(assistanceOn(hist, P, '2026-07-01')).toBe(A2);
    expect(assistanceOn(hist, P, '2025-12-31')).toBeNull();
    expect(payerOn(hist, P, '2025-12-31')).toBe('mig');
    expect(assistanceOn(hist, 'other', '2026-03-10')).toBeNull();
  });

  it('requireAssistanceScope: new assistance full, former read-only for 12 months, others none', () => {
    const today = '2026-09-30';
    expect(assistanceScope(hist, A2, P, '2026-08-01', today)).toBe('full');
    expect(assistanceScope(hist, A2, P, '2026-03-01', today)).toBe('none'); // before its period
    expect(assistanceScope(hist, A1, P, '2026-03-01', today)).toBe('read');
    expect(assistanceScope(hist, A1, P, '2026-08-01', today)).toBe('none'); // after the change
    expect(assistanceScope(hist, A1, P, '2026-03-01', '2027-06-30')).toBe('read');
    expect(assistanceScope(hist, A1, P, '2026-03-01', '2027-07-01')).toBe('none'); // 12 months passed
    expect(assistanceScope(hist, 'a3', P, '2026-03-01', today)).toBe('none');
  });
});

describe('registry lines by payer (§5.3)', () => {
  it('splits lines into sub-registries, lines without a payer go to MIG', () => {
    const split = splitByPayer([{ id: 1, payer: A1 }, { id: 2, payer: 'mig' }, { id: 3 }, { id: 4, payer: A1 }]);
    expect([...split.keys()]).toEqual([A1, 'mig']);
    expect(split.get(A1)!.map((l) => l.id)).toEqual([1, 4]);
    expect(split.get('mig')!.map((l) => l.id)).toEqual([2, 3]);
  });
});

describe('fee by the three models (§4)', () => {
  const base = { insuredCount: 1200, claimsAmount: 48_500_000, casesCount: 37 };
  it('PEPM, percent of claims and per case, with a readable formula', () => {
    expect(feeFor('pepm', 15_000, base)).toMatchObject({ amount: 18_000_000, base: 1200, formula: '1 200 застрахованных × 15 000 UZS = 18 000 000 UZS' });
    expect(feeFor('percent_of_claims', 0.07, base)).toMatchObject({ amount: 3_395_000, formula: '48 500 000 UZS × 7% = 3 395 000 UZS' });
    expect(feeFor('per_case', 50_000, base)).toMatchObject({ amount: 1_850_000, formula: '37 обращений × 50 000 UZS = 1 850 000 UZS' });
  });
});

describe('automatic checks of a rebill line (§5.5)', () => {
  const ok: RebillLineFacts = { accepted: true, paidToClinic: true, policyActive: true, assigned: true, amount: 180_000, limitLeft: 1_000_000, requiresGuarantee: false, guaranteeApproved: null, duplicate: false, price: 180_000, contractPrice: 180_000 };
  const codes = (f: Partial<RebillLineFacts>) => rebillChecks({ ...ok, ...f }).map((c) => c.code);
  it('a clean line has no flags', () => expect(codes({})).toEqual([]));
  it('flags every rule', () => {
    expect(codes({ paidToClinic: false })).toEqual(['not_paid_to_clinic']);
    expect(codes({ accepted: false, paidToClinic: false })).toEqual(['not_paid_to_clinic']);
    expect(codes({ policyActive: false })).toEqual(['policy_inactive']);
    expect(codes({ assigned: false })).toEqual(['not_assigned']);
    expect(codes({ limitLeft: 100_000 })).toEqual(['over_limit']);
    expect(codes({ requiresGuarantee: true })).toEqual(['no_guarantee']);
    expect(codes({ requiresGuarantee: true, guaranteeApproved: 150_000 })).toEqual(['no_guarantee']);
    expect(codes({ requiresGuarantee: true, guaranteeApproved: 200_000 })).toEqual([]);
    expect(codes({ duplicate: true })).toEqual(['duplicate']);
    expect(codes({ contractPrice: 170_000 })).toEqual(['price_mismatch']);
    expect(codes({ contractPrice: null })).toEqual(['price_mismatch']);
  });
  it('messages explain the flag', () => {
    expect(rebillChecks({ ...ok, limitLeft: 100_000 })[0]!.message).toBe('Сумма 180 000 больше остатка лимита 100 000');
  });
});

describe('limits and reserves (§5.2)', () => {
  it('reserves reduce what is left and never go below zero', () => {
    expect(limitLeft(5_000_000, 1_000_000)).toBe(4_000_000);
    expect(limitLeft(5_000_000, 1_000_000, 1_800_000)).toBe(2_200_000);
    expect(limitLeft(5_000_000, 4_000_000, 1_800_000)).toBe(0);
  });
});

describe('quality-control sample (§5.6)', () => {
  const ids = Array.from({ length: 4000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  it('is deterministic and about 5%', () => {
    const a = qaSample(ids.map((id) => ({ id })), '2026-09');
    const b = qaSample(ids.map((id) => ({ id })), '2026-09');
    expect(a).toEqual(b);
    expect(a.length / ids.length).toBeGreaterThan(0.035);
    expect(a.length / ids.length).toBeLessThan(0.065);
    expect(inQaSample(ids[0]!, '2026-09', 1)).toBe(true);
    expect(inQaSample(ids[0]!, '2026-09', 0)).toBe(false);
  });
  it('another month gives another sample', () => {
    const a = qaSample(ids.map((id) => ({ id })), '2026-09').map((x) => x.id);
    const b = qaSample(ids.map((id) => ({ id })), '2026-10').map((x) => x.id);
    expect(a).not.toEqual(b);
  });
});
