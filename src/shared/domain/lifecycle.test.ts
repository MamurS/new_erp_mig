/* LIFECYCLE_SPEC §17 unit tests: tariff and quote, authority routing, endorsement formulas, activation, signing, reserves, fraud flags. */
import { tm } from '@/i18n';
import { describe, expect, it } from 'vitest';
import type { ReserveChange, Signing } from '@/shared/types';
import { DMS_DEFAULTS } from '@/shared/config/dmsParameters';
import { ageOn, bandOf, calculateQuote, canApproveQuote, quoteAuthorityProblem, type CensusRow } from './tariff';
import { activationDate, addPendingScan, addSignature, buildPaymentSchedule, defaultStartDate, emptySigning, isFullySigned, originalReminderDue, verifyScan } from './contracts';
import { addLine, coverageStart, excludeLine, programChangeLine, remainingDays } from './endorsements';
import { canApproveDecision, decisionNeedsApproval, decisionProblem, detectFlags, initialReserve, reserveAfter, reserveOn, type FlagContext } from './settlement';
import { censusStats, parseCensusCsv } from './census';

const P = DMS_DEFAULTS;
const row = (birthYear: number, relation: CensusRow['relation'] = 'employee', gender: CensusRow['gender'] = 'm'): CensusRow => ({ gender, birthYear, relation });

describe('demo tariff and quote', () => {
  it('bands by age on the start date', () => {
    expect(ageOn(1990, '2026-11-01')).toBe(36);
    expect(bandOf(17)).toBe('0-17');
    expect(bandOf(18)).toBe('18-29');
    expect(bandOf(59)).toBe('50-59');
    expect(bandOf(60)).toBe('60+');
  });

  it('premium = Σ count × base × coefficient, per-person averages rounded to 1000, total built from them', () => {
    const rows = [row(2000), row(1990), row(1980, 'employee', 'f'), row(1988, 'spouse', 'f'), row(2016, 'child')];
    const q = calculateQuote({ program: 'standard', rows, startDate: '2026-11-01', adjustments: [] }, P);
    const base = P.tariffBaseStandard;
    expect(q.rates.find((r) => r.band === '30-39')!.count).toBe(2);
    expect(q.rates.find((r) => r.band === '30-39')!.coefficient).toBe(P.tariffCoef30to39);
    const emp = (base * (P.tariffCoef18to29 + P.tariffCoef30to39 + P.tariffCoef40to49)) / 3;
    expect(q.premiumEmployee).toBe(Math.round(emp / 1000) * 1000);
    expect(q.total).toBe(q.premiumEmployee * 3 + q.premiumFamily * 2);
    expect(q.groupDiscountPct).toBe(0);
    expect(q.discountFromTariffPct).toBe(0);
  });

  it('group discount from the threshold, manual adjustments move the premium and the discount from the tariff', () => {
    const rows = Array.from({ length: P.groupDiscountFrom }, (_, i) => row(1980 + (i % 20)));
    const plain = calculateQuote({ program: 'basic', rows, startDate: '2026-11-01', adjustments: [] }, P);
    expect(plain.groupDiscountPct).toBe(P.groupDiscountShare);
    const disc = calculateQuote({ program: 'basic', rows, startDate: '2026-11-01', adjustments: [{ label: 'Скидка', pct: -0.15, comment: 'Крупный клиент' }] }, P);
    expect(disc.discountFromTariffPct).toBeCloseTo(0.15);
    expect(disc.total).toBeLessThan(plain.total);
  });

  it('routes a quote by authority: above the discount or premium → someone else with more authority', () => {
    const q = { discountFromTariffPct: 0.15, total: 1_000_000_000, createdById: 'a' };
    expect(tm(quoteAuthorityProblem(q, { quoteDiscountMaxPct: 0.1 }))).toMatch(/Скидка/);
    expect(quoteAuthorityProblem(q, { quoteDiscountMaxPct: 0.25 })).toBeNull();
    expect(tm(quoteAuthorityProblem({ ...q, discountFromTariffPct: 0 }, { quoteDiscountMaxPct: 0.1, quotePremiumMax: 500_000_000 }))).toMatch(/Премия/);
    expect(canApproveQuote({ id: 'b', role: 'underwriter', authority: { quoteDiscountMaxPct: 0.25 } }, q)).toBe(true);
    expect(canApproveQuote({ id: 'a', role: 'underwriter', authority: { quoteDiscountMaxPct: 0.25 } }, q)).toBe(false); // own quote
    expect(canApproveQuote({ id: 'c', role: 'underwriter', authority: { quoteDiscountMaxPct: 0.1 } }, q)).toBe(false);
    expect(canApproveQuote({ id: 'd', role: 'sales_manager', authority: { quoteDiscountMaxPct: 1 } }, q)).toBe(false);
  });
});

describe('census', () => {
  it('drops personal data columns and computes the stats', () => {
    const r = parseCensusCsv('fio,pinfl,gender,birthYear,relation\nИванов,12345678901234,m,1990,employee\nИванова,1,f,1992,spouse\n', '2026-10-01');
    expect(r.dropped).toEqual(['fio', 'pinfl']);
    expect(r.rows).toEqual([row(1990), row(1992, 'spouse', 'f')]);
    expect(JSON.stringify(r.rows)).not.toContain('Иванов');
    const s = censusStats(r.rows, '2026-10-01');
    expect(s).toMatchObject({ total: 2, employees: 1, family: 1, maleShare: 0.5 });
  });
});

describe('payment schedule and activation rule', () => {
  it('splits into equal installments, the last takes the remainder', () => {
    const s = buildPaymentSchedule(1_000_000_001, '2026-01-31', 'quarterly');
    expect(s.map((x) => x.dueDate)).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
    expect(s.reduce((a, x) => a + x.amount, 0)).toBe(1_000_000_001);
  });
  it('on_start_date — the start date regardless of payments', () => {
    expect(activationDate('on_start_date', '2026-11-01', [{ dueDate: '2026-11-01', amount: 100 }], [])).toBe('2026-11-01');
  });
  it('after_first_payment — not before the first installment is paid in full, and not before the start', () => {
    const sched = [{ dueDate: '2026-11-01', amount: 100 }];
    expect(activationDate('after_first_payment', '2026-11-01', sched, [])).toBeNull();
    expect(activationDate('after_first_payment', '2026-11-01', sched, [{ amount: 60, paidAt: '2026-10-20' }])).toBeNull();
    expect(activationDate('after_first_payment', '2026-11-01', sched, [{ amount: 60, paidAt: '2026-10-20' }, { amount: 40, paidAt: '2026-10-25' }])).toBe('2026-11-01');
    expect(activationDate('after_first_payment', '2026-11-01', sched, [{ amount: 100, paidAt: '2026-11-07' }])).toBe('2026-11-07');
  });
  it('default start: the first day of the month after next', () => {
    expect(defaultStartDate('2026-10-02')).toBe('2026-12-01');
    expect(defaultStartDate('2026-12-31')).toBe('2027-02-01');
  });
});

describe('signing rules', () => {
  const at = '2026-10-01T10:00:00+05:00';
  it('signed only when both sides are counted', () => {
    let s: Signing = emptySigning();
    s = addSignature(s, 'mig', { method: 'eimzo', signedAt: at, signerName: 'A' });
    expect(isFullySigned(s)).toBe(false);
    expect(s.paperOriginal.required).toBe(false);
    s = addSignature(s, 'client', { method: 'eimzo', signedAt: at, signerName: 'B' });
    expect(isFullySigned(s)).toBe(true);
    expect(() => addSignature(s, 'client', { method: 'eimzo', signedAt: at, signerName: 'B' })).toThrow();
  });
  it('paper or scan switches on the paper original; a scan counts only after verification', () => {
    const paper = addSignature(emptySigning(), 'mig', { method: 'paper', signedAt: at, signerName: 'A' });
    expect(paper.paperOriginal.required).toBe(true);
    let s = addPendingScan(emptySigning(), 'client', 'file-1', at, 'HR');
    expect(s.paperOriginal.required).toBe(true);
    expect(s.client).toBeUndefined();
    s = verifyScan(s, 'client', { id: 'v', name: 'Проверил' }, at, 'Директор');
    expect(s.client).toMatchObject({ method: 'scan', scanVerifiedByName: 'Проверил', scanFileId: 'file-1' });
    expect(s.pendingScans).toEqual([]);
  });
  it('reminds about a missing original after N days, never before signing', () => {
    let s = addSignature(emptySigning(), 'mig', { method: 'paper', signedAt: at, signerName: 'A' });
    const later = Date.parse(at) + 31 * 86_400_000;
    expect(originalReminderDue(s, later, 30)).toBe(false); // not signed by the client yet
    s = addSignature(s, 'client', { method: 'eimzo', signedAt: at, signerName: 'B' });
    expect(originalReminderDue(s, later, 30)).toBe(true);
    expect(originalReminderDue(s, Date.parse(at) + 29 * 86_400_000, 30)).toBe(false);
    expect(originalReminderDue({ ...s, paperOriginal: { ...s.paperOriginal, clientOriginalReceivedAt: '2026-10-05' } }, later, 30)).toBe(false);
  });
});

describe('endorsements: premium for the remaining term', () => {
  const start = '2026-01-01';
  const end = '2026-12-31'; // 365 days
  it('inclusion: annual × remaining days / days of the term', () => {
    expect(remainingDays('2026-07-01', start, end)).toBe(184);
    const l = addLine(3_650_000, '2026-07-01', start, end);
    expect(l.amount).toBe(Math.round((3_650_000 * 184) / 365));
    expect(l.formula).toContain('× 184 / 365');
  });
  it('exclusion under all three refund rules; with claims deducted never below zero', () => {
    const annual = 3_650_000;
    const proRata = Math.round((annual * 184) / 365);
    expect(excludeLine(annual, '2026-07-01', start, end, 'pro_rata', 500_000).amount).toBe(-proRata);
    expect(excludeLine(annual, '2026-07-01', start, end, 'pro_rata_minus_claims', 500_000).amount).toBe(-(proRata - 500_000));
    expect(excludeLine(annual, '2026-07-01', start, end, 'pro_rata_minus_claims', 9_000_000).amount).toBe(-0);
    expect(excludeLine(annual, '2026-07-01', start, end, 'none', 0).amount).toBe(0);
  });
  it('program change: difference of premiums for the remaining term, may be negative', () => {
    expect(programChangeLine(1_000_000, 2_000_000, '2026-07-01', start, end).amount).toBe(Math.round((1_000_000 * 184) / 365));
    expect(programChangeLine(2_000_000, 1_000_000, '2026-07-01', start, end).amount).toBe(-Math.round((1_000_000 * 184) / 365));
  });
  it('outside the term nothing is charged', () => {
    expect(addLine(1_000_000, '2027-01-02', start, end).amount).toBe(0);
  });
  it('coverage of a new person starts on the HR request or on signing', () => {
    expect(coverageStart('from_hr_request', '2026-10-05', null)).toBe('2026-10-05');
    expect(coverageStart('from_endorsement_signed', '2026-10-05', null)).toBeNull();
    expect(coverageStart('from_endorsement_signed', '2026-10-05', '2026-11-02')).toBe('2026-11-02');
  });
});

describe('claims settlement', () => {
  it('routes decisions by authority; a refusal commits the claimed amount', () => {
    const a = { claimDecisionMax: 5_000_000 };
    expect(decisionNeedsApproval('approve', 4_000_000, 4_000_000, a)).toBe(false);
    expect(decisionNeedsApproval('approve', 6_000_000, 6_000_000, a)).toBe(true);
    expect(decisionNeedsApproval('partial', 3_000_000, 8_000_000, a)).toBe(false);
    expect(decisionNeedsApproval('reject', 0, 8_000_000, a)).toBe(true);
    const pending = { byId: 'a', required: 8_000_000 };
    expect(canApproveDecision({ id: 'b', role: 'claims_officer', authority: { claimDecisionMax: 50_000_000 } }, pending)).toBe(true);
    expect(canApproveDecision({ id: 'a', role: 'claims_officer', authority: { claimDecisionMax: 50_000_000 } }, pending)).toBe(false);
    expect(canApproveDecision({ id: 'c', role: 'claims_officer', authority: { claimDecisionMax: 5_000_000 } }, pending)).toBe(false);
    expect(canApproveDecision({ id: 'd', role: 'underwriter', authority: { claimDecisionMax: 50_000_000 } }, pending)).toBe(false);
  });
  it('refusal and partial approval need a known clause and a reason', () => {
    const known = (r: string) => r === 'contract:4.3';
    expect(tm(decisionProblem('reject', 0, 100, undefined, 'Не покрывается', known))).toMatch(/пункт/);
    expect(tm(decisionProblem('reject', 0, 100, 'contract:99', 'Не покрывается', known))).toMatch(/пункт/);
    expect(tm(decisionProblem('reject', 0, 100, 'contract:4.3', '', known))).toMatch(/причину/);
    expect(decisionProblem('reject', 0, 100, 'contract:4.3', 'Не покрывается', known)).toBeNull();
    expect(tm(decisionProblem('partial', 100, 100, 'contract:4.3', 'Сверх лимита', known))).toMatch(/меньше заявленной/);
    expect(decisionProblem('approve', 100, 100, undefined, '', known)).toBeNull();
  });
  it('reserve: claimed or GP amount at start, decision amount after, zero after payment or refusal; on a date from history', () => {
    expect(initialReserve(1_000)).toBe(1_000);
    expect(initialReserve(1_000, 800)).toBe(800);
    expect(reserveAfter({ type: 'decision', amount: 700 })).toBe(700);
    expect(reserveAfter({ type: 'paid' })).toBe(0);
    expect(reserveAfter({ type: 'rejected' })).toBe(0);
    const h: ReserveChange[] = [
      { at: '2026-09-01T10:00:00+05:00', byName: 'a', from: 0, to: 1_000, reason: 'Регистрация' },
      { at: '2026-09-10T10:00:00+05:00', byName: 'b', from: 1_000, to: 700, reason: 'Решение' },
      { at: '2026-09-20T10:00:00+05:00', byName: 'c', from: 700, to: 0, reason: 'Оплата' },
    ];
    expect(reserveOn(h, '2026-08-31')).toBe(0);
    expect(reserveOn(h, '2026-09-05')).toBe(1_000);
    expect(reserveOn(h, '2026-09-10')).toBe(700);
    expect(reserveOn(h, '2026-09-25')).toBe(0);
  });

  const base: FlagContext = {
    claim: { id: 'c1', insuredId: 'i1', amountClaimed: 250_000, serviceDate: '2026-09-15', providerName: 'Аптека «Дори-Дармон»', createdAt: '2026-09-16T10:00:00+05:00' },
    others: [],
    coverageFrom: '2026-01-01',
    coverageTo: '2026-12-31',
    params: { maxPerMonth: P.fraudMaxClaimsPerMonth, priceExcessShare: P.fraudPriceExcessShare, daysBeforeExclusion: P.fraudDaysBeforeExclusion },
  };
  const codes = (ctx: FlagContext) => detectFlags(ctx).map((f) => f.code);
  it('no flags for an ordinary claim', () => expect(codes(base)).toEqual([]));
  describe('duplicate receipt across all insured', () => {
    const fiscal = { fiscalNumber: '412345678901', issuedAt: '2026-09-15T14:05', amount: 250_000, sellerInn: '201234567' };
    const mine = { ...base.claim, source: 'app' as const, receiptFiscal: fiscal };
    const theirs = { id: 'c0', number: 'U-2026-000100', insuredId: 'i9', amountClaimed: 120_000, serviceDate: '2026-09-15', providerName: 'Другая подпись', source: 'app' as const };
    const message = (ctx: FlagContext) => tm(detectFlags(ctx).find((f) => f.code === 'duplicate_receipt')?.message);
    it('the same fiscal number of another person is a duplicate, whatever the claimed amount', () => {
      expect(message({ ...base, claim: mine, others: [{ ...theirs, receiptFiscal: { ...fiscal } }] })).toBe('Фискальный номер чека совпадает с чеком обращения U-2026-000100 другого застрахованного');
    });
    it('different fiscal numbers are different receipts even with the same amount, date and point', () => {
      expect(codes({ ...base, claim: mine, others: [{ ...theirs, receiptFiscal: { ...fiscal, fiscalNumber: '499999999999' } }] })).toEqual([]);
    });
    it('without a fiscal number: receipt amount, date and seller INN', () => {
      const unreadable = { ...fiscal, fiscalNumber: undefined, issuedAt: '2026-09-15T18:40' };
      expect(message({ ...base, claim: mine, others: [{ ...theirs, receiptFiscal: unreadable }] })).toMatch(/^Та же сумма, дата и точка продажи, что в чеке обращения U-2026-000100/);
      expect(codes({ ...base, claim: mine, others: [{ ...theirs, receiptFiscal: { ...unreadable, sellerInn: '209999999' } }] })).toEqual([]);
      expect(codes({ ...base, claim: mine, others: [{ ...theirs, receiptFiscal: { ...unreadable, issuedAt: '2026-09-16T09:00' } }] })).toEqual([]);
    });
    it('receipts without fiscal data fall back to the claimed amount, date and provider name', () => {
      expect(codes({ ...base, claim: { ...base.claim, source: 'app' }, others: [{ ...theirs, amountClaimed: 250_000, providerName: 'аптека  «дори-дармон» ' }] })).toEqual(['duplicate_receipt']);
    });
    it('clinic invoices are not receipts: two patients with the same price on the same day are not flagged', () => {
      const visit = { ...base.claim, source: 'clinic_invoice' as const };
      expect(codes({ ...base, claim: visit, others: [{ ...theirs, source: 'clinic_invoice', amountClaimed: 250_000, providerName: base.claim.providerName }] })).toEqual([]);
    });
    it('the image hash stays an extra sign: alone it flags, next to the fiscal match it is mentioned', () => {
      expect(message({ ...base, claim: { ...base.claim, receiptHash: 'h' }, others: [{ ...theirs, receiptHash: 'h' }] })).toMatch(/^Изображение чека совпадает/);
      expect(message({ ...base, claim: { ...mine, receiptHash: 'h' }, others: [{ ...theirs, receiptFiscal: { ...fiscal }, receiptHash: 'h' }] })).toMatch(/\(изображение чека тоже совпадает\)$/);
    });
  });
  it('frequent claims above N per month', () => {
    const others = Array.from({ length: P.fraudMaxClaimsPerMonth }, (_, i) => ({ id: `o${i}`, insuredId: 'i1', amountClaimed: 1000 + i, serviceDate: '2026-09-0' + ((i % 9) + 1), providerName: `P${i}` }));
    expect(codes({ ...base, others })).toContain('frequent_claims');
    expect(codes({ ...base, others: others.slice(1) })).not.toContain('frequent_claims');
  });
  it('service date outside coverage or after exclusion', () => {
    expect(codes({ ...base, coverageFrom: '2026-10-01' })).toEqual(['outside_coverage']);
    expect(codes({ ...base, excludedFrom: '2026-09-10' })).toEqual(['outside_coverage']);
  });
  it('claims in the last days before exclusion', () => {
    expect(codes({ ...base, excludedFrom: '2026-09-20' })).toEqual(['before_exclusion']);
    expect(codes({ ...base, excludedFrom: '2026-12-01' })).toEqual([]);
  });
  it('amount noticeably above the price list', () => {
    const over = 1 + P.fraudPriceExcessShare + 0.1;
    expect(codes({ ...base, claim: { ...base.claim, expectedPrice: Math.round(base.claim.amountClaimed / over) } })).toEqual(['above_price']);
    expect(codes({ ...base, claim: { ...base.claim, expectedPrice: base.claim.amountClaimed } })).toEqual([]);
  });
});
