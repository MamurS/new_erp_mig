import { describe, expect, it } from 'vitest';
import { unpack } from '@mig/i18n';
import { dealChecklist, insuredTabState, missingItems, staffActionPath, taskLink, type ChecklistContract } from './nextStep';

const contract = (over: Partial<ChecklistContract> = {}): ChecklistContract => ({
  status: 'draft',
  insuredCount: 12,
  clientInn: '301234567',
  clientSignatory: { name: 'Aliyev Rustam', position: 'Director', basis: 'Charter' },
  migSignatoryId: 'mig-1',
  clauseChanges: 0,
  financeDiffers: false,
  financeApproved: false,
  signing: {},
  ...over,
});
const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe('deal checklist («Что нужно для следующего этапа»)', () => {
  it('lead: the assessment data is required, by the manager', () => {
    const items = dealChecklist({ stage: 'lead', census: false, invoicePaid: false });
    expect(keys(items)).toEqual(['census']);
    expect(items[0]).toMatchObject({ done: false, required: true, role: 'sales_manager', action: 'census_upload' });
    expect(keys(missingItems(items))).toEqual(['census']);
    expect(missingItems(dealChecklist({ stage: 'census', census: true, invoicePaid: false }))).toEqual([]);
  });

  it('quote: calculated and approved by the underwriter before the KP is sent', () => {
    const draft = dealChecklist({ stage: 'quote', census: true, quote: { status: 'draft' }, invoicePaid: false });
    expect(draft.map((i) => [i.key, i.done])).toEqual([
      ['quoteCalculated', true],
      ['quoteApproved', false],
    ]);
    expect(missingItems(dealChecklist({ stage: 'quote', census: true, quote: { status: 'approved' }, invoicePaid: false }))).toEqual([]);
  });

  it('contract draft: details, appendix 2, signatories; the underwriter only when terms differ; the lawyer never blocks the submit', () => {
    const ok = dealChecklist({ stage: 'contract_draft', census: true, contract: contract(), invoicePaid: false });
    expect(keys(ok)).toEqual(['requisites', 'annex2', 'signatories', 'financeApproval', 'legal']);
    expect(missingItems(ok)).toEqual([]);
    expect(ok.find((i) => i.key === 'financeApproval')!.required).toBe(false);

    const empty = dealChecklist({ stage: 'contract_draft', census: true, contract: contract({ insuredCount: 0, clientInn: '', financeDiffers: true, clauseChanges: 2 }), invoicePaid: false });
    expect(keys(missingItems(empty))).toEqual(['requisites', 'annex2', 'financeApproval']);
    const legal = empty.find((i) => i.key === 'legal')!;
    expect(legal).toMatchObject({ required: false, role: 'legal' });
    expect(unpack(legal.hint!)).toEqual({ key: 'next.hint.clausesChanged', params: { n: 2 } });
    // Approved by the underwriter: no longer missing.
    expect(keys(missingItems(dealChecklist({ stage: 'contract_draft', census: true, contract: contract({ financeDiffers: true, financeApproved: true }), invoicePaid: false })))).toEqual([]);
    // Signatories: both sides.
    expect(keys(missingItems(dealChecklist({ stage: 'contract_draft', census: true, contract: contract({ migSignatoryId: '' }), invoicePaid: false })))).toEqual(['signatories']);
  });

  it('review, signing, payment: the lawyer, both signatures, the first installment', () => {
    expect(keys(missingItems(dealChecklist({ stage: 'contract_review', census: true, contract: contract({ status: 'legal_review', clauseChanges: 1 }), invoicePaid: false })))).toEqual(['legal']);
    const signing = dealChecklist({ stage: 'signing', census: true, contract: contract({ status: 'signing', signing: { client: { method: 'eimzo', signedAt: '2026-10-01T10:00:00+05:00', signerName: 'X' } } }), invoicePaid: false });
    expect(signing.map((i) => [i.key, i.done, i.role])).toEqual([
      ['signClient', true, 'hr'],
      ['signMig', false, 'sales_manager'],
    ]);
    expect(keys(missingItems(dealChecklist({ stage: 'awaiting_payment', census: true, invoicePaid: false })))).toEqual(['payment']);
    expect(dealChecklist({ stage: 'active', census: true, invoicePaid: true })).toEqual([]);
  });
});

describe('the empty «Застрахованные» tab of a client', () => {
  it('follows the stage of the deal', () => {
    expect(insuredTabState({ hasPolicy: true, hasHr: true })).toBe('list');
    expect(insuredTabState({ hasPolicy: false, hasHr: false })).toBe('no_deal');
    for (const stage of ['lead', 'census', 'quote', 'kp_sent', 'kp_accepted'] as const) expect(insuredTabState({ hasPolicy: false, hasHr: false, dealId: 'd', stage }), stage).toBe('pre_contract');
    for (const stage of ['contract_draft', 'contract_review', 'contract_sent', 'signing'] as const) expect(insuredTabState({ hasPolicy: false, hasHr: true, dealId: 'd', stage }), stage).toBe('contract');
    expect(insuredTabState({ hasPolicy: false, hasHr: true, dealId: 'd', stage: 'awaiting_payment' })).toBe('awaiting_payment');
    expect(insuredTabState({ hasPolicy: false, hasHr: true, dealId: 'd', stage: 'lost' })).toBe('no_deal');
  });
});

describe('where a task leads', () => {
  const refs = { clientId: 'c1', dealId: 'd1', contractId: 'k1' };
  it('MIG: the place with the form open', () => {
    expect(staffActionPath('census_upload', refs)).toBe('/staff/deals/d1/census?upload=1');
    expect(staffActionPath('insured_list', refs)).toBe('/staff/contracts/k1?upload=annex2');
    expect(staffActionPath('legal_review', refs)).toBe('/staff/contracts/k1');
    expect(staffActionPath('contract_draft', refs)).toBe('/staff/deals/d1');
    expect(taskLink('census_upload', 'sales_manager', refs)).toBe('/staff/deals/d1/census?upload=1');
  });
  it('HR: the cabinet home («Задачи от МИГ») or the contract to sign', () => {
    expect(taskLink('insured_list', 'hr', refs)).toBe('/hr');
    expect(taskLink('sign_client', 'hr', refs)).toBe('/hr/contracts/k1');
  });
});
