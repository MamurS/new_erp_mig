/* Renewal offer: premium per person with persons transferred from the previous system. */
import { describe, expect, it } from 'vitest';
import { renewalPremiumPerPerson } from './kp';

describe('renewalPremiumPerPerson', () => {
  it('is the even share of the policy premium without transferred persons', () => {
    expect(renewalPremiumPerPerson(12_000_000, 4, [{}, {}, {}])).toBe(3_000_000);
    expect(renewalPremiumPerPerson(12_000_000, 0, [{}, {}, {}])).toBe(4_000_000);
  });

  it('uses the stored premium of transferred persons instead of the even share', () => {
    expect(renewalPremiumPerPerson(12_000_000, 3, [{ migratedPremium: { amount: 2_000_000 } }, { migratedPremium: { amount: 5_000_000 } }])).toBe(3_500_000);
    // Mixed: the others keep the even share (12 000 000 / 3 = 4 000 000).
    expect(renewalPremiumPerPerson(12_000_000, 3, [{ migratedPremium: { amount: 1_000_000 } }, {}, {}])).toBe(3_000_000);
  });
});
