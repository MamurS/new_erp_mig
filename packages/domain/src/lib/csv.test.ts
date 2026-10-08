import { describe, expect, it } from 'vitest';
import { csvCell, exportFileName, toCsv } from './csv';

describe('csv', () => {
  it.each(['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx', '\rx'])('neutralises formula %j', (v) => {
    expect(csvCell(v).replace(/^"/, '').startsWith("'")).toBe(true);
  });
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });
  it('leaves plain values', () => {
    expect(csvCell('ООО Ромашка')).toBe('ООО Ромашка');
    expect(csvCell(12500000)).toBe('12500000');
    expect(csvCell(null)).toBe('');
  });
  it('builds rows with CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, '=x']])).toBe("a,b\r\n1,'=x\r\n");
  });
  it('file names have no PII', () => {
    expect(exportFileName('clients', new Date('2026-09-29T10:00:00+05:00'))).toBe('clients-2026-09-29.csv');
    expect(exportFileName('claims_financial', new Date('2026-09-29T10:00:00+05:00'))).toBe(
      'claims-financial-2026-09-29.csv',
    );
  });
});
