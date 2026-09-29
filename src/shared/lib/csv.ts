import { todayISO } from './format';

const DANGEROUS = /^[=+\-@\t\r]/;

/** Escapes one CSV cell: neutralises formula injection and quotes when needed. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (DANGEROUS.test(s)) s = `'${s}`;
  if (/[",;\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

/** File names never contain PII: `clients-2026-09-29.csv`. */
export function exportFileName(kind: string, now: Date = new Date()): string {
  const safeKind = kind.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/_/g, '-');
  return `${safeKind}-${todayISO(now)}.csv`;
}

/** Triggers a browser download of text content. */
export function downloadText(content: string | Blob, fileName: string, mime = 'text/csv;charset=utf-8'): void {
  const blob =
    typeof content === 'string' ? new Blob(['\ufeff', content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
