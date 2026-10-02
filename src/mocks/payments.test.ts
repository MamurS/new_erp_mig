// @vitest-environment node
/*
 * Matching the 1C statement on the mock server: invoice number in the purpose first, then INN plus the
 * exact amount; the rest goes to «Ручная разноска». Several contracts of one client, a payment by a third
 * party, partial payments, and the rights of the queue.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Invoice } from '@/shared/types';
import type { BankPaymentView, ImportPaymentsResult, SessionResponse } from '@/shared/types/dto';
import { createMockServer } from './node';
import { db, resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

type Res<T> = { status: number; data: T };
async function call<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; sid?: string; json?: unknown; text?: string } = {},
): Promise<Res<T>> {
  const headers = new Headers();
  if (init.sid) headers.set('Authorization', `Bearer ${init.sid}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  if (init.text !== undefined) headers.set('Content-Type', 'text/csv');
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.text ?? (init.json === undefined ? undefined : JSON.stringify(init.json)),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', {
    method: 'POST',
    json: { email, password: 'Demo-2026!' },
  });
  const b = await call<SessionResponse>('/auth/otp', {
    method: 'POST',
    json: { challengeId: a.data.challengeId, code: '000000' },
  });
  expect(b.status, email).toBe(200);
  return b.data.sessionId;
}

const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
let seq = 0;
/** An unpaid installment of a contract; contracts here are only ids — matching looks at invoices. */
function invoice(clientId: string, contractId: string, amount: number, dueInDays: number, paid = 0): Invoice {
  seq += 1;
  const inv: Invoice = {
    id: crypto.randomUUID(),
    clientId,
    number: `СЧ-2026-${String(900 + seq).padStart(6, '0')}`,
    amount,
    issuedAt: today(),
    dueDate: new Date(Date.now() + dueInDays * 86_400_000).toISOString().slice(0, 10),
    status: 'unpaid',
    contractId,
    paid,
  };
  db().invoices.push(inv);
  return inv;
}
/** A client without contract invoices of its own, so the test controls everything it can match. */
function freshClient(skip: string[] = []) {
  const c = db().clients.find(
    (x) => !skip.includes(x.id) && x.inn && !db().invoices.some((i) => i.clientId === x.id && i.contractId),
  );
  expect(c).toBeTruthy();
  return c!;
}
const statement = (rows: [number, string, string, string?][]) =>
  [
    'date,amount,inn,purpose,payer',
    ...rows.map(([amount, inn, purpose, payer]) => `${today()},${amount},${inn},"${purpose}",${payer ?? ''}`),
  ].join('\n');
const paidOf = (id: string) => db().invoices.find((i) => i.id === id)!;

describe('payment matching (1C statement)', () => {
  it('several contracts of one client: the number in the purpose wins, then INN and exact amount; a tie goes to the queue', async () => {
    const acc = await login('accountant@demo.mig.uz');
    const c = freshClient();
    const k1 = crypto.randomUUID();
    const k2 = crypto.randomUUID();
    const a1 = invoice(c.id, k1, 10_000_000, 5);
    const b1 = invoice(c.id, k2, 10_000_000, 10);
    const b2 = invoice(c.id, k2, 7_000_000, 15);
    const csv = statement([
      [10_000_000, c.inn, 'Страховая премия по ДМС'], // A1 or B1: ambiguous
      [10_000_000, c.inn, `Оплата по сч. ${b1.number.replace(/-/g, ' - ')} за 4 кв.`], // the number, spaced differently
      [7_000_000, c.inn, 'Оплата ДМС'], // only B2 has 7 000 000 left
    ]);
    const r = await call<ImportPaymentsResult>('/payments/import-1c', {
      method: 'POST',
      sid: acc,
      text: csv,
    });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ matched: 2, queued: 1, unmatched: [] });
    expect(paidOf(b1.id)).toMatchObject({ paid: 10_000_000, status: 'paid' });
    expect(paidOf(b2.id)).toMatchObject({ paid: 7_000_000, status: 'paid' });
    expect(paidOf(a1.id).paid).toBe(0);
    expect(db().payments.find((p) => p.invoiceId === b1.id)?.matchedBy).toBe('number');
    expect(db().payments.find((p) => p.invoiceId === b2.id)?.matchedBy).toBe('inn_amount');

    const queue = await call<BankPaymentView[]>('/payments/queue', { sid: acc });
    const tie = queue.data.find((b) => b.payerInn === c.inn)!;
    expect(tie.reason).toBe('ambiguous');
    // B1 is paid by now: the only candidate left is A1, suggested but not allocated automatically.
    expect(tie.candidates.map((x) => [x.number, x.why])).toEqual([[a1.number, 'inn_amount']]);
    const done = await call<BankPaymentView>(`/payments/queue/${tie.id}/allocate`, {
      method: 'POST',
      sid: acc,
      json: { lines: [{ invoiceId: a1.id, amount: 10_000_000 }] },
    });
    expect(done.status).toBe(200);
    expect(done.data).toMatchObject({ status: 'allocated', remaining: 0, allocated: 10_000_000 });
    expect(paidOf(a1.id).status).toBe('paid');
    expect(db().payments.find((p) => p.invoiceId === a1.id)).toMatchObject({
      matchedBy: 'manual',
      bankPaymentId: tie.id,
      payerInn: c.inn,
    });
    expect(
      (await call<BankPaymentView[]>('/payments/queue', { sid: acc })).data.some((b) => b.id === tie.id),
    ).toBe(false);
    expect(
      (await call<BankPaymentView[]>('/payments/queue?status=allocated', { sid: acc })).data.some(
        (b) => b.id === tie.id,
      ),
    ).toBe(true);
    // Allocated payments are closed.
    expect(
      (
        await call(`/payments/queue/${tie.id}/allocate`, {
          method: 'POST',
          sid: acc,
          json: { lines: [{ invoiceId: b2.id, amount: 1 }] },
        })
      ).status,
    ).toBe(409);
  });

  it('a payment by a third party: never automatic even with the invoice number; manual allocation needs a comment', async () => {
    const acc = await login('accountant@demo.mig.uz');
    const c = freshClient();
    const holding = freshClient([c.id]);
    const inv = invoice(c.id, crypto.randomUUID(), 5_000_000, 5);
    const r = await call<ImportPaymentsResult>('/payments/import-1c', {
      method: 'POST',
      sid: acc,
      text: statement([
        [5_000_000, holding.inn, `За ${c.name} по счёту ${inv.number}`, 'Холдинг'],
        [3_000_000, '399000111', 'Без назначения'],
      ]),
    });
    expect(r.data).toMatchObject({ matched: 0, queued: 2 });
    expect(paidOf(inv.id).paid).toBe(0);

    const queue = (await call<BankPaymentView[]>('/payments/queue', { sid: acc })).data;
    const third = queue.find((b) => b.payerInn === holding.inn)!;
    expect(third).toMatchObject({ reason: 'third_party', payerName: 'Холдинг' });
    expect(third.candidates).toEqual([
      expect.objectContaining({ invoiceId: inv.id, why: 'number', clientInn: c.inn }),
    ]);
    expect(queue.find((b) => b.payerInn === '399000111')?.reason).toBe('unknown_payer');

    const noComment = await call<{ fields?: Record<string, string> }>(
      `/payments/queue/${third.id}/allocate`,
      { method: 'POST', sid: acc, json: { lines: [{ invoiceId: inv.id, amount: 5_000_000 }] } },
    );
    expect(noComment.status).toBe(422);
    expect(noComment.data.fields?.comment).toMatch(/другой ИНН/);
    const ok = await call<BankPaymentView>(`/payments/queue/${third.id}/allocate`, {
      method: 'POST',
      sid: acc,
      json: {
        lines: [{ invoiceId: inv.id, amount: 5_000_000 }],
        comment: '  Оплата холдингом за дочернюю компанию по письму  ',
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.data.allocations[0]).toMatchObject({
      invoiceNumber: inv.number,
      comment: 'Оплата холдингом за дочернюю компанию по письму',
    });
    expect(paidOf(inv.id).status).toBe('paid');
    expect(db().payments.find((p) => p.invoiceId === inv.id)).toMatchObject({
      payerInn: holding.inn,
      comment: 'Оплата холдингом за дочернюю компанию по письму',
    });
    expect(
      db().audit.some(
        (a) =>
          a.action === 'payment_allocated' &&
          a.targetId === inv.id &&
          /третье лицо/.test(a.targetLabel ?? ''),
      ),
    ).toBe(true);
  });

  it('partial payments: with the number they apply automatically; without it the accountant splits, the rest stays queued', async () => {
    const acc = await login('accountant@demo.mig.uz');
    const c = freshClient();
    const d1 = invoice(c.id, crypto.randomUUID(), 9_000_000, 5);
    const d2 = invoice(c.id, crypto.randomUUID(), 4_000_000, 30);
    const r = await call<ImportPaymentsResult>('/payments/import-1c', {
      method: 'POST',
      sid: acc,
      text: statement([
        [4_000_000, c.inn, `Частичная оплата счёта ${d1.number}`],
        [6_000_000, c.inn, 'Оплата ДМС'],
      ]),
    });
    // Line 2: 6 000 000 fits no invoice exactly (D1 has 5 000 000 left, D2 has 4 000 000).
    expect(r.data).toMatchObject({ matched: 1, queued: 1 });
    expect(paidOf(d1.id)).toMatchObject({ paid: 4_000_000, status: 'unpaid' });

    const q = (await call<BankPaymentView[]>('/payments/queue', { sid: acc })).data.find(
      (b) => b.payerInn === c.inn,
    )!;
    expect(q.reason).toBe('amount_mismatch');
    expect(q.candidates.map((x) => [x.invoiceId, x.remaining])).toEqual([
      [d1.id, 5_000_000],
      [d2.id, 4_000_000],
    ]);
    const tooMuch = await call(`/payments/queue/${q.id}/allocate`, {
      method: 'POST',
      sid: acc,
      json: { lines: [{ invoiceId: d1.id, amount: 5_000_001 }] },
    });
    expect(tooMuch.status).toBe(422);
    const overPayment = await call(`/payments/queue/${q.id}/allocate`, {
      method: 'POST',
      sid: acc,
      json: {
        lines: [
          { invoiceId: d1.id, amount: 5_000_000 },
          { invoiceId: d2.id, amount: 4_000_000 },
        ],
      },
    });
    expect(overPayment.status).toBe(422);
    const part = await call<BankPaymentView>(`/payments/queue/${q.id}/allocate`, {
      method: 'POST',
      sid: acc,
      json: { lines: [{ invoiceId: d1.id, amount: 5_000_000 }] },
    });
    expect(part.data).toMatchObject({ status: 'pending', allocated: 5_000_000, remaining: 1_000_000 });
    expect(paidOf(d1.id).status).toBe('paid');
    const rest = await call<BankPaymentView>(`/payments/queue/${q.id}/allocate`, {
      method: 'POST',
      sid: acc,
      json: { lines: [{ invoiceId: d2.id, amount: 1_000_000 }] },
    });
    expect(rest.data).toMatchObject({ status: 'allocated', remaining: 0 });
    expect(paidOf(d2.id)).toMatchObject({ paid: 1_000_000, status: 'unpaid' });
  });

  it('rights: only the accountant sees and allocates the queue', async () => {
    const seeded = db().bankPayments[0]!;
    for (const email of ['sales@demo.mig.uz', 'underwriter@demo.mig.uz', 'hr@demo-client.uz']) {
      const sid = await login(email);
      expect((await call('/payments/queue', { sid })).status, email).toBe(403);
      expect(
        (await call(`/payments/queue/${seeded.id}/allocate`, { method: 'POST', sid, json: { lines: [] } }))
          .status,
        email,
      ).toBe(403);
    }
    expect((await call('/payments/queue')).status).toBe(401);
    const acc = await login('accountant@demo.mig.uz');
    expect(
      (
        await call(`/payments/queue/${crypto.randomUUID()}/allocate`, {
          method: 'POST',
          sid: acc,
          json: { lines: [{ invoiceId: crypto.randomUUID(), amount: 1 }] },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(`/payments/queue/${seeded.id}/allocate`, { method: 'POST', sid: acc, json: { lines: [] } }))
        .status,
    ).toBe(422);
  });
});
