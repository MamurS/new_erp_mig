/*
 * Tiny single-page PDF generator for client-side document stubs (invoices, policy documents).
 * Output is ASCII-only (Cyrillic is transliterated), so string length equals byte length and
 * xref offsets can be computed directly. Stubs never contain employee personal data.
 */
import type { ClientDocument, Invoice } from '@/shared/types';
import { formatDate, formatMoneyDoc, todayISO } from '@/shared/lib/format';
import { downloadText } from '@/shared/lib/csv';
import { formatLegalName, type LegalFormCode } from '@/shared/config/legalForms';

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
};

/** Transliterates Cyrillic and drops anything outside printable ASCII. */
export function toPdfAscii(input: string): string {
  let out = '';
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const t = TRANSLIT[lower];
    if (t !== undefined) {
      out += ch !== lower && t ? t[0]!.toUpperCase() + t.slice(1) : t;
    } else if (/[\u00a0\u202f\u2007\s]/.test(ch)) {
      out += ' ';
    } else if (ch === '№') {
      out += 'No';
    } else if (/[–—−]/.test(ch)) {
      out += '-';
    } else if (/[«»“”]/.test(ch)) {
      out += '"';
    } else if (/[\u02bb\u02bc\u2018\u2019]/.test(ch)) {
      // Uzbek oʻ / gʻ and the tutuq belgisi of Latin names
      out += "'";
    } else if (/[\x20-\x7e]/.test(ch)) {
      out += ch;
    } else {
      out += '?';
    }
  }
  return out;
}

function escapePdfText(s: string): string {
  return toPdfAscii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Builds a valid one-page A4 PDF with the given text lines (Helvetica). */
export function buildPdf(lines: readonly string[], title = 'MIG DMS'): string {
  const text = lines
    .slice(0, 45)
    .map((l, i) => `${i === 0 ? '' : 'T* '}(${escapePdfText(l)}) Tj`)
    .join('\n');
  const stream = `BT\n/F1 12 Tf\n16 TL\n56 780 Td\n${text}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Title (${escapePdfText(title)}) /Producer (MIG DMS prototype) >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return out;
}

const INVOICE_STATUS_EN: Record<Invoice['status'], string> = { unpaid: 'Awaiting payment', paid: 'Paid', overdue: 'Overdue' };
const DOC_KIND_EN: Record<ClientDocument['kind'], string> = {
  policy: 'Insurance policy',
  contract: 'Contract',
  invoice: 'Invoice',
  act: 'Act',
  program: 'Insurance program',
  kp: 'Commercial offer',
  endorsement: 'Policy endorsement',
  insured_list: 'List of insured persons',
};

/** Legal name as printed in the (English) stubs: `Name LLC`; the bare name when the form is unknown. */
export function pdfLegalName(name: string, legalForm?: LegalFormCode): string {
  return legalForm ? formatLegalName(name, legalForm, 'en') : name;
}

const FOOTER = ['', 'Mosaic Insurance Group - voluntary medical insurance (DMS).', 'Demo document generated in the browser. It contains no personal data of employees.'];

export function invoicePdf(inv: Invoice, companyName?: string, companyLegalForm?: LegalFormCode): string {
  return buildPdf(
    [
      'MIG DMS - Invoice',
      '',
      `Invoice No ${inv.number}`,
      ...(companyName ? [`Customer: ${pdfLegalName(companyName, companyLegalForm)}`] : []),
      `Amount: ${formatMoneyDoc(inv.amount)}`,
      `Issued: ${formatDate(inv.issuedAt)}`,
      `Due date: ${formatDate(inv.dueDate)}`,
      `Status: ${INVOICE_STATUS_EN[inv.status]}`,
      ...FOOTER,
    ],
    `Invoice ${inv.number}`,
  );
}

export function documentPdf(doc: ClientDocument, companyName?: string, companyLegalForm?: LegalFormCode): string {
  return buildPdf(
    [
      `MIG DMS - ${DOC_KIND_EN[doc.kind]}`,
      '',
      `Title: ${doc.title}`,
      ...(companyName ? [`Customer: ${pdfLegalName(companyName, companyLegalForm)}`] : []),
      `Date: ${formatDate(doc.createdAt)}`,
      ...FOOTER,
    ],
    DOC_KIND_EN[doc.kind],
  );
}

/** File names carry only the document kind and today's date — never PII. */
export function pdfFileName(kind: 'invoice' | 'document', now: Date = new Date()): string {
  return `${kind}-${todayISO(now)}.pdf`;
}

export function downloadPdf(content: string, fileName: string): void {
  downloadText(new Blob([content], { type: 'application/pdf' }), fileName, 'application/pdf');
}
