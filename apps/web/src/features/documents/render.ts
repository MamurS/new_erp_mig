/*
 * Renderer of stub documents (contract, endorsement, certificate, claim decision letter).
 * Same rules as the commercial offer (KP_SPEC §3, §6): pure functions, every value escaped, the
 * result is shown only in the sandboxed DocFrame and printed to PDF from it. Each page carries the
 * «ШАБЛОН-ЗАГЛУШКА» watermark while the template is not approved.
 */
import { escapeHtml, fillFields } from './html';
import { DOC_TEMPLATES, type DocTemplateId } from '@mig/domain/documents/templates/index';

export const DOC_PAGE_WIDTH = 794;
export const DOC_PAGE_HEIGHT = 1123;
export const DOC_PAGE_GAP = 24;
export const STUB_WATERMARK = 'ШАБЛОН-ЗАГЛУШКА';

export interface StubRenderInput {
  templateId: DocTemplateId;
  /** Values of `{{fields}}`, plain text (escaped here). */
  values: Readonly<Record<string, string>>;
  /** Rows of the template tables by table id, plain text cells. */
  tables?: Readonly<Record<string, readonly (readonly string[])[]>>;
  /** Changed wording by clause id. */
  overrides?: Readonly<Record<string, string>>;
  /** Show changed clauses highlighted with the original text (editor preview). */
  showChanges?: boolean;
  /** Signature lines: who signed and how, plain text. */
  signatures?: { mig?: string; client?: string };
  title: string;
}

export interface StubRenderResult {
  title: string;
  pagesHtml: string[];
}

/** Rough height budget of a page in «lines»: enough to keep A4 pages without overflow. */
const PAGE_LINES = 44;
const CHARS_PER_LINE = 92;

interface Block {
  html: string;
  lines: number;
}

const linesOf = (text: string) => Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));

function clauseBlock(
  id: string,
  title: string,
  text: string,
  data: string | undefined,
  values: Readonly<Record<string, string>>,
  override: string | undefined,
  showChanges: boolean,
): Block {
  const body = override ?? text;
  const changed = override !== undefined;
  const dataHtml = data ? `<p class="data">${fillFields(data, values)}</p>` : '';
  const original = changed && showChanges ? `<p class="orig"><span>Исходный текст:</span> ${escapeHtml(text)}</p>` : '';
  const html =
    `<div class="clause${changed && showChanges ? ' changed' : ''}" data-clause="${escapeHtml(id)}">` +
    `<p class="ct"><b>${escapeHtml(id)}.</b> ${escapeHtml(title)}${changed && showChanges ? ' <i>изменено</i>' : ''}</p>` +
    `<p class="tx">${escapeHtml(body)}</p>${dataHtml}${original}</div>`;
  return { html, lines: 1 + linesOf(body) + (data ? linesOf(data) : 0) + (original ? linesOf(text) + 1 : 0) + 0.4 };
}

function tableBlocks(columns: readonly string[], rows: readonly (readonly string[])[]): Block[] {
  const head = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
  if (!rows.length) return [{ html: `<table><thead>${head}</thead><tbody><tr><td colspan="${columns.length}">Нет строк</td></tr></tbody></table>`, lines: 2 }];
  // Long lists are split into several tables so that pages break between rows.
  const out: Block[] = [];
  for (let i = 0; i < rows.length; i += 30) {
    const chunk = rows.slice(i, i + 30);
    const body = chunk.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
    out.push({ html: `<table><thead>${head}</thead><tbody>${body}</tbody></table>`, lines: chunk.length * 0.8 + 1.5 });
  }
  return out;
}

export function renderStubDocument(input: StubRenderInput): StubRenderResult {
  const t = DOC_TEMPLATES[input.templateId];
  const overrides = input.overrides ?? {};
  const blocks: Block[] = [];
  blocks.push({
    html: `<h1>${fillFields(t.heading, input.values)}</h1>${t.subheading ? `<p class="sub">${fillFields(t.subheading, input.values)}</p>` : ''}`,
    lines: 4,
  });
  for (const s of t.sections) {
    const appendix = s.id.startsWith('A');
    blocks.push({ html: `<h2${appendix ? ' class="appendix"' : ''}>${fillFields(s.title, input.values)}</h2>`, lines: appendix ? 99 : 2 });
    for (const c of s.clauses) blocks.push(clauseBlock(c.id, c.title, c.text, c.data, input.values, overrides[c.id], input.showChanges === true));
    if (s.table) {
      const def = t.tables.find((x) => x.id === s.table);
      if (def) blocks.push(...tableBlocks(def.columns, input.tables?.[def.id] ?? []));
    }
  }
  if (t.signatures !== 'none') {
    const mig = `<div class="sig"><p><b>Страховщик</b></p><p>${fillFields('{{mig.name}}', input.values)}</p><p class="line">${escapeHtml(input.signatures?.mig ?? '____________________ /')}</p></div>`;
    const client =
      t.signatures === 'both'
        ? `<div class="sig"><p><b>Страхователь</b></p><p>${fillFields('{{client.name}}', input.values)}</p><p class="line">${escapeHtml(input.signatures?.client ?? '____________________ /')}</p></div>`
        : '';
    blocks.push({ html: `<div class="sigs">${mig}${client}</div>`, lines: 6 });
  }

  // Pagination: an appendix heading always starts a new page.
  const pages: string[][] = [[]];
  let used = 0;
  for (const b of blocks) {
    const forceBreak = b.lines >= 99;
    const lines = forceBreak ? 2 : b.lines;
    const current = pages[pages.length - 1]!;
    if ((forceBreak && current.length > 0) || (used + lines > PAGE_LINES && current.length > 0)) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1]!.push(b.html);
    used += lines;
  }
  const total = pages.length;
  const watermark = t.approved ? '' : `<div class="wm" aria-hidden="true">${STUB_WATERMARK}</div>`;
  const pagesHtml = pages.map(
    (content, i) =>
      `${watermark}<header>${escapeHtml(t.name)} · ${escapeHtml(t.version)}</header><main>${content.join('')}</main><footer>Страница ${i + 1} из ${total}</footer>`,
  );
  return { title: input.title, pagesHtml };
}

const STUB_CSS = `
html, body { margin: 0; background: #E9E9E7; }
body { display: flex; flex-direction: column; align-items: center; gap: ${DOC_PAGE_GAP}px; font-family: 'Golos Text', 'Segoe UI', Arial, sans-serif; color: #1B1F24; }
.page { position: relative; width: ${DOC_PAGE_WIDTH}px; height: ${DOC_PAGE_HEIGHT}px; background: #fff; overflow: hidden; flex-shrink: 0; box-sizing: border-box; padding: 56px 64px 64px; font-size: 12.5px; line-height: 1.45; }
.page header { position: absolute; top: 20px; left: 64px; right: 64px; font-size: 10px; color: #8A8F98; border-bottom: 1px solid #E3E5E8; padding-bottom: 4px; }
.page footer { position: absolute; bottom: 22px; left: 64px; right: 64px; font-size: 10px; color: #8A8F98; text-align: right; }
.wm { position: absolute; top: 46%; left: -6%; width: 112%; text-align: center; transform: rotate(-32deg); font-size: 74px; font-weight: 700; letter-spacing: 6px; color: rgba(200, 40, 40, 0.10); pointer-events: none; white-space: nowrap; }
h1 { font-size: 19px; margin: 8px 0 4px; text-align: center; }
p.sub { text-align: center; color: #5B6170; margin: 0 0 14px; }
h2 { font-size: 14px; margin: 14px 0 6px; }
h2.appendix { font-size: 15px; }
.clause { margin: 0 0 8px; }
.clause p { margin: 0; }
.clause .ct { font-weight: 600; }
.clause .tx { color: #5B6170; }
.clause .data { margin-top: 2px; }
.clause.changed { background: #FFF6D6; outline: 1px solid #E8C55A; padding: 4px 6px; border-radius: 4px; }
.clause .ct i { font-style: normal; font-size: 10px; background: #E8C55A; color: #3A2E05; border-radius: 3px; padding: 1px 4px; margin-left: 4px; }
.clause .orig { margin-top: 4px; color: #8A6D12; text-decoration: line-through; }
.clause .orig span { text-decoration: none; font-weight: 600; }
.missing { color: #B42318; background: #FDECEC; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 11.5px; }
th, td { border: 1px solid #D5D8DD; padding: 3px 6px; text-align: left; }
th { background: #F3F4F6; }
.sigs { display: flex; gap: 32px; margin-top: 18px; }
.sig { flex: 1; }
.sig p { margin: 0 0 4px; }
.sig .line { margin-top: 14px; }
@media print {
  @page { size: 210mm 297mm; margin: 0; }
  html, body { background: #fff; height: auto; }
  body { display: block; }
  .page { width: 210mm; height: 297mm; page-break-after: always; break-after: page; margin: 0; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}`;

/** Full HTML document for the sandboxed DocFrame (`srcdoc`). No scripts, no external resources. */
export function docSrcdoc(result: StubRenderResult): string {
  const pages = result.pagesHtml.map((p) => `<div class="page">${p}</div>`).join('\n');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(result.title)}</title>
<style>${STUB_CSS}</style>
</head>
<body>
${pages}
</body>
</html>`;
}

/** Height of the stacked preview for `pages` pages. */
export function docPreviewHeight(pages: number): number {
  return pages * DOC_PAGE_HEIGHT + Math.max(0, pages - 1) * DOC_PAGE_GAP;
}
