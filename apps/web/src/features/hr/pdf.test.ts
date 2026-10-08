import { describe, expect, it } from 'vitest';
import { buildPdf, documentPdf, invoicePdf, pdfFileName, pdfLegalName, toPdfAscii } from './pdf';

describe('pdf stub', () => {
  it('produces ASCII-only PDF with correct xref offsets', () => {
    const pdf = buildPdf(['Счёт № 12 (test)', 'Amount: 1 000 UZS']);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect([...pdf].every((c) => c === '\n' || (c >= ' ' && c <= '~'))).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(6);
    entries.forEach((off, i) => expect(pdf.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true));
    const len = Number(/\/Length (\d+)/.exec(pdf)![1]);
    const streamStart = pdf.indexOf('stream\n') + 'stream\n'.length;
    expect(pdf.slice(streamStart + len, streamStart + len + 10)).toBe('\nendstream');
    expect(pdf).toContain('(Schyot No 12 \\(test\\)) Tj');
  });

  it('transliterates Cyrillic', () => {
    expect(toPdfAscii('Шахло Юсупова')).toBe('Shakhlo Yusupova');
  });

  it('invoice stub has no personal data and a PII-free file name', () => {
    const pdf = invoicePdf({
      id: '00000000-0000-4000-8000-000000000000',
      clientId: '00000000-0000-4000-8000-000000000001',
      number: 'INV-2026-001',
      amount: 12_500_000,
      issuedAt: '2026-09-01',
      dueDate: '2026-10-01',
      status: 'unpaid',
    });
    expect(pdf).toContain('INV-2026-001');
    expect(pdf).toContain('12 500 000 UZS');
    expect(pdfFileName('invoice', new Date('2026-09-29T08:00:00Z'))).toBe('invoice-2026-09-29.pdf');
  });

  it('prints the customer with its legal form in English, Uzbek apostrophes as ASCII', () => {
    const inv = {
      id: '00000000-0000-4000-8000-000000000000',
      clientId: '00000000-0000-4000-8000-000000000001',
      number: 'SCh-2026-000001',
      amount: 1_000,
      issuedAt: '2026-09-01',
      dueDate: '2026-10-01',
      status: 'unpaid',
    } as const;
    expect(pdfLegalName('Toshkent Agrologistika', 'llc')).toBe('Toshkent Agrologistika LLC');
    expect(pdfLegalName('Toshkent Agrologistika')).toBe('Toshkent Agrologistika');
    expect(invoicePdf(inv, 'Toshkent Agrologistika', 'llc')).toContain('(Customer: Toshkent Agrologistika LLC) Tj');
    expect(invoicePdf(inv, 'Toshkent Agrologistika')).toContain('(Customer: Toshkent Agrologistika) Tj');
    const doc = documentPdf({ id: inv.id, clientId: inv.clientId, title: 'Policy', kind: 'policy', createdAt: '2026-09-01' }, 'Qoʻqon Gʻalla', 'jsc');
    expect(doc).toContain("(Customer: Qo'qon G'alla JSC) Tj");
  });
});
