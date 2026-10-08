// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { approvalOutcome, limitState, parseCardInput, registryLineProblems, coverageStatus } from '@mig/domain/clinics';
import { hmacSha256Hex, parseSignatureHeader, signWebhook, verifyWebhook } from './webhook';
import { tm } from '@/i18n';
import { keyCreateRequest, webhookUrl, webhookUrlProblem } from '@mig/contracts/integration';
import { DMS_DEFAULTS } from '@mig/domain/config/dmsParameters';

describe('webhook signature (HMAC-SHA256)', () => {
  it('matches the RFC 4231 / well-known test vectors', async () => {
    expect(await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    // RFC 4231, test case 2
    expect(await hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('signs "{t}.{raw_body}" and matches Node crypto', async () => {
    const secret = 'whsec_test_secret';
    const body = '{"id":"a","type":"registry.paid","createdAt":"2026-09-30T10:00:00+05:00","objectId":"b"}';
    const header = await signWebhook(secret, body, 1_790_000_000);
    const expected = createHmac('sha256', secret).update(`1790000000.${body}`).digest('hex');
    expect(header).toBe(`t=1790000000,v1=${expected}`);
    expect(parseSignatureHeader(header)).toEqual({ t: 1_790_000_000, v1: expected });
  });

  it('verification rejects tampering, a wrong secret and events older than 5 minutes', async () => {
    const body = '{"id":"x"}';
    const header = await signWebhook('s3cret', body, 1000);
    expect(await verifyWebhook('s3cret', header, body, 1100)).toBe(true);
    expect(await verifyWebhook('s3cret', header, '{"id":"y"}', 1100)).toBe(false);
    expect(await verifyWebhook('other', header, body, 1100)).toBe(false);
    expect(await verifyWebhook('s3cret', header, body, 1000 + 301)).toBe(false);
    expect(await verifyWebhook('s3cret', 'garbage', body, 1000)).toBe(false);
  });
});

describe('webhook URL check (front-end SSRF guard)', () => {
  it('allows public https hosts', () => {
    expect(webhookUrlProblem('https://clinic.uz/hook')).toBeNull();
    expect(webhookUrl.safeParse('https://clinic.uz/hook').success).toBe(true);
    expect(webhookUrlProblem('https://203.0.113.10/hook')).toBeNull();
  });
  it.each([
    'http://clinic.uz/hook',
    'https://localhost/hook',
    'https://10.0.0.5/hook',
    'https://192.168.1.1/hook',
    'https://[::1]/hook',
    'https://clinic.local/hook',
    'https://172.16.4.2/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest',
    'https://[fd00::1]/hook',
    'https://[::ffff:10.0.0.1]/hook',
    'https://user:pass@clinic.uz/hook',
    'https://2130706433/hook',
    'ftp://clinic.uz',
    'не адрес',
  ])('rejects %s', (url) => {
    expect(webhookUrlProblem(url)).not.toBeNull();
    expect(webhookUrl.safeParse(url).success).toBe(false);
  });
});

describe('clinic domain rules', () => {
  it('parses the card code in every accepted form', () => {
    expect(parseCardInput('K7P4-QX2M')).toEqual({ kind: 'short', code: 'K7P4QX2M' });
    expect(parseCardInput(' k7p4qx2m ')).toEqual({ kind: 'short', code: 'K7P4QX2M' });
    expect(parseCardInput('MIG-DMS:abcdefghijklmnop_123')).toEqual({ kind: 'token', token: 'abcdefghijklmnop_123' });
    expect(parseCardInput('K7P4-QX2')).toBeNull();
    expect(parseCardInput('MIG-DMS:<script>')).toBeNull();
  });

  it('limit state and coverage without amounts', () => {
    expect(limitState(1000, 100, DMS_DEFAULTS.limitLowShare)).toBe('available');
    expect(limitState(1000, 850, DMS_DEFAULTS.limitLowShare)).toBe('low');
    expect(limitState(1000, 1000, DMS_DEFAULTS.limitLowShare)).toBe('exhausted');
    expect(coverageStatus('basic', 'dental')).toBe('not_covered');
    expect(coverageStatus('premium', 'inpatient')).toBe('needs_guarantee');
    expect(coverageStatus('standard', 'outpatient')).toBe('covered');
  });

  it('registry line checks: price list price, mandatory guarantee number, dates', () => {
    const base = { serviceDate: '2026-09-10', price: 100, quantity: 1, visitId: 'v1', guaranteeNumber: undefined };
    const item = { code: 'TH-101', name: 'x', category: 'outpatient' as const, price: 100, requiresGuarantee: false };
    const gpItem = { ...item, code: 'IP-602', requiresGuarantee: true };
    expect(registryLineProblems(base, { priceItem: item })).toEqual([]);
    expect(tm(registryLineProblems({ ...base, price: 101 }, { priceItem: item })[0])).toContain('Цена выше прайса');
    expect(tm(registryLineProblems(base, { priceItem: undefined })[0])).toContain('нет в прайсе');
    expect(tm(registryLineProblems(base, { priceItem: gpItem })[0])).toContain('нужен номер гарантийного письма');
    expect(tm(registryLineProblems({ ...base, guaranteeNumber: 'GP-2026-000001' }, { priceItem: gpItem, guarantee: { status: 'requested', visitId: 'v1', serviceCode: 'IP-602' } })[0])).toContain('не одобрено');
    expect(registryLineProblems({ ...base, guaranteeNumber: 'GP-2026-000001' }, { priceItem: gpItem, guarantee: { status: 'approved', approvedAmount: 100, visitId: 'v1', serviceCode: 'IP-602' } })).toEqual([]);
    expect(tm(registryLineProblems(base, { priceItem: item, policyFrom: '2026-10-01', policyTo: '2027-09-30' })[0])).toContain('полиса');
    expect(tm(registryLineProblems(base, { priceItem: item, visitFrom: '2026-09-11', visitTo: '2026-09-12' })[0])).toContain('визита');
  });

  it('four-eyes: above the threshold the same doctor cannot give the second approval', () => {
    expect(approvalOutcome({ approvals: [] }, 5_000_000, 'd1', DMS_DEFAULTS.guaranteeDualApprovalThreshold)).toBe('approved');
    expect(approvalOutcome({ approvals: [] }, 25_000_000, 'd1', DMS_DEFAULTS.guaranteeDualApprovalThreshold)).toBe('first_of_two');
    expect(approvalOutcome({ approvals: [{ byId: 'd1', byName: '', at: '' }] }, 25_000_000, 'd1', DMS_DEFAULTS.guaranteeDualApprovalThreshold)).toBe('same_doctor');
    expect(approvalOutcome({ approvals: [{ byId: 'd1', byName: '', at: '' }] }, 25_000_000, 'd2', DMS_DEFAULTS.guaranteeDualApprovalThreshold)).toBe('approved');
  });

  it('key form: scopes required, IP list parsed', () => {
    expect(keyCreateRequest.safeParse({ name: 'МИС', scopes: [], ipAllowlist: '' }).success).toBe(false);
    const ok = keyCreateRequest.parse({ name: 'МИС', scopes: ['coverage:check'], ipAllowlist: '203.0.113.0/24, 198.51.100.7' });
    expect(ok.ipAllowlist).toEqual(['203.0.113.0/24', '198.51.100.7']);
  });
});
