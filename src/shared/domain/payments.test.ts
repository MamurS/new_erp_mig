import { describe, expect, it } from 'vitest';
import { tm } from '@/i18n';
import { checkAllocation, invoicesNamedIn, matchPayment, statementLineKey, type OpenInvoice } from './payments';

const inv = (
  id: string,
  number: string,
  clientInn: string,
  amount: number,
  paid = 0,
  dueDate = '2026-10-15',
): OpenInvoice => ({ id, number, clientId: `c-${clientInn}`, clientInn, amount, paid, dueDate });

describe('invoicesNamedIn', () => {
  const list = [
    inv('a', 'SCh-2026-002001', '1', 1),
    inv('b', 'SCh-2026-0020011', '1', 1),
    inv('c', 'SCh-2026-DS1', '1', 1),
  ];
  it('finds a number regardless of case, spaces around dashes and «№»', () => {
    expect(invoicesNamedIn('оплата по счету № sch - 2026 - 002001 от 01.10', list).map((i) => i.id)).toEqual([
      'a',
    ]);
    expect(invoicesNamedIn('Оплата SCH–2026–DS1', list).map((i) => i.id)).toEqual(['c']);
  });
  it('does not take a prefix of a longer number', () => {
    expect(invoicesNamedIn('Оплата SCh-2026-0020011', list).map((i) => i.id)).toEqual(['b']);
    expect(invoicesNamedIn('Оплата по договору', list)).toEqual([]);
  });
});

describe('matchPayment', () => {
  // One client with two contracts: equal installments of 10 000 000 and one of 7 000 000.
  const own = [
    inv('a1', 'SCh-2026-000101', '301', 10_000_000, 0, '2026-10-05'),
    inv('b1', 'SCh-2026-000201', '301', 10_000_000, 0, '2026-10-10'),
    inv('b2', 'SCh-2026-000202', '301', 7_000_000, 0, '2026-11-10'),
  ];
  const other = [inv('x1', 'SCh-2026-000301', '302', 5_000_000)];
  const all = [...own, ...other];

  it('the invoice number in the purpose comes first, even when the amount is partial', () => {
    expect(
      matchPayment({ amount: 3_000_000, payerInn: '301', purpose: 'по счёту SCh-2026-000201' }, all),
    ).toEqual({ kind: 'matched', invoiceId: 'b1', by: 'number' });
  });
  it('then INN plus exact outstanding amount; equal amounts of two contracts are a tie', () => {
    expect(matchPayment({ amount: 7_000_000, payerInn: '301', purpose: 'ДМС' }, all)).toEqual({
      kind: 'matched',
      invoiceId: 'b2',
      by: 'inn_amount',
    });
    expect(matchPayment({ amount: 10_000_000, payerInn: '301', purpose: 'ДМС' }, all)).toEqual({
      kind: 'manual',
      reason: 'ambiguous',
      candidates: [
        { invoiceId: 'a1', why: 'inn_amount' },
        { invoiceId: 'b1', why: 'inn_amount' },
      ],
    });
  });
  it('the outstanding amount counts, not the invoice amount', () => {
    const partly = [inv('a1', 'SCh-2026-000101', '301', 10_000_000, 4_000_000)];
    expect(matchPayment({ amount: 6_000_000, payerInn: '301', purpose: '' }, partly)).toMatchObject({
      kind: 'matched',
      invoiceId: 'a1',
    });
    expect(matchPayment({ amount: 10_000_000, payerInn: '301', purpose: '' }, partly)).toMatchObject({
      kind: 'manual',
      reason: 'amount_mismatch',
    });
  });
  it('a third party: the number points to an invoice of another INN — manual, with that invoice as the candidate', () => {
    expect(
      matchPayment({ amount: 5_000_000, payerInn: '399', purpose: 'за ООО по сч. SCh-2026-000301' }, all),
    ).toEqual({ kind: 'manual', reason: 'third_party', candidates: [{ invoiceId: 'x1', why: 'number' }] });
  });
  it('an unknown payer without a number: invoices of anyone with this exact amount are hints', () => {
    expect(matchPayment({ amount: 5_000_000, payerInn: '399', purpose: 'оплата' }, all)).toEqual({
      kind: 'manual',
      reason: 'unknown_payer',
      candidates: [{ invoiceId: 'x1', why: 'amount' }],
    });
  });
  it('more than the invoice named, several numbers, nothing left to pay', () => {
    expect(
      matchPayment({ amount: 12_000_000, payerInn: '301', purpose: 'SCh-2026-000101' }, all),
    ).toMatchObject({
      kind: 'manual',
      reason: 'over_remaining',
      candidates: [{ invoiceId: 'a1', why: 'number' }, { invoiceId: 'b1' }, { invoiceId: 'b2' }],
    });
    expect(
      matchPayment({ amount: 17_000_000, payerInn: '301', purpose: 'SCh-2026-000201, SCh-2026-000202' }, all),
    ).toMatchObject({ kind: 'manual', reason: 'several_numbers' });
    const paid = [inv('a1', 'SCh-2026-000101', '301', 1_000, 1_000)];
    expect(matchPayment({ amount: 1_000, payerInn: '301', purpose: 'SCh-2026-000101' }, paid)).toMatchObject({
      kind: 'manual',
      reason: 'no_invoices',
    });
  });
});

describe('checkAllocation', () => {
  const a = { amount: 10_000, paid: 0, clientInn: '301', number: 'SCh-1' };
  const payment = { amount: 8_000, allocated: 0, payerInn: '301' };
  it('limits by the rest of the payment and of each invoice', () => {
    expect(checkAllocation(payment, [{ invoice: a, amount: 8_000 }], undefined)).toBeNull();
    expect(
      tm(checkAllocation({ ...payment, allocated: 5_000 }, [{ invoice: a, amount: 4_000 }], undefined)),
    ).toMatch(/остатка платежа/);
    expect(
      tm(checkAllocation({ ...payment, amount: 20_000 }, [{ invoice: a, amount: 10_001 }], undefined)),
    ).toMatch(/остатка по счёту/);
    expect(tm(checkAllocation(payment, [], undefined))).toMatch(/Выберите счёт/);
  });
  it('a payer with another INN needs a comment', () => {
    const third = { ...payment, payerInn: '399' };
    expect(tm(checkAllocation(third, [{ invoice: a, amount: 8_000 }], '  '))).toMatch(/комментарий/);
    expect(checkAllocation(third, [{ invoice: a, amount: 8_000 }], 'Оплата за дочернюю компанию')).toBeNull();
  });
});

describe('statementLineKey', () => {
  const line = { docNumber: '1245', date: '2026-10-01', amount: 1_000_000, payerInn: '301234567' };
  it('is the payment document number, date, amount and payer INN, normalized', () => {
    expect(statementLineKey(line)).toBe('1245|2026-10-01|1000000|301234567');
    expect(statementLineKey({ ...line, docNumber: ' 12 45 ', payerInn: '301 234 567' })).toBe(statementLineKey(line));
    expect(statementLineKey({ ...line, docNumber: 'pp-7' })).toBe(statementLineKey({ ...line, docNumber: 'PP-7' }));
  });
  it('any field changes the key', () => {
    const keys = new Set([line, { ...line, docNumber: '1246' }, { ...line, date: '2026-10-02' }, { ...line, amount: 1_000_001 }, { ...line, payerInn: '301234568' }].map(statementLineKey));
    expect(keys.size).toBe(5);
  });
});
