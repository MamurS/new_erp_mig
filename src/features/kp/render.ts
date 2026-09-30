/*
 * Commercial offer renderer. Pure functions without DOM access: the backend will repeat them
 * (same substitution, same escaping) to produce the PDF with headless Chromium.
 */
import type { Client, ISODate, KpDocument, KpParams } from '@/shared/types';
import { kpDocumentTitle } from '@/shared/domain/kp';
import { escapeHtml, formatKpMoney, groupDigits } from './format';
import { KP_TEMPLATES } from './templates';
import { offerLetterPage } from './templates/offerLetter';

export interface KpRenderContext {
  number: string;
  /** Offer date (creation date; today for an unsaved draft). */
  date: ISODate;
  clientLegalForm: Client['legalForm'];
  clientName: string;
  clientInn: string;
  underwriterName: string;
  underwriterEmail: string;
  templateVersion: string;
}

export interface KpRenderResult {
  title: string;
  pagesHtml: string[];
}

/** Layout constants shared with the preview (px at 96 dpi: 794×1123 = A4). */
export const KP_PAGE_WIDTH = 794;
export const KP_PAGE_HEIGHT = 1123;
export const KP_PAGE_GAP = 24;

function substitute(page: string, values: Record<string, string>): string {
  let out = page;
  for (const [key, value] of Object.entries(values)) out = out.split(`{{${key}}}`).join(value);
  return out;
}

export function renderKp(params: KpParams, ctx: KpRenderContext): KpRenderResult {
  const template = KP_TEMPLATES[params.templateId];
  const pages = template.pages[`${params.lang}-${params.variant}`];
  const sum = formatKpMoney(params.sumInsured, params.lang);
  const values = {
    SUM: escapeHtml(sum),
    SUM_N: escapeHtml(groupDigits(params.sumInsured, params.lang)),
    PREM_EMP: escapeHtml(formatKpMoney(params.premiumEmployee, params.lang)),
    PREM_FAM: escapeHtml(formatKpMoney(params.premiumFamily, params.lang)),
  };
  return {
    title: kpDocumentTitle(ctx.number, ctx.clientName),
    pagesHtml: [offerLetterPage(params, ctx), ...pages.map((p) => substitute(p, values))],
  };
}

/** Styles of the original generator: page box, base resets and print rules. */
const DOCUMENT_CSS = `
html, body { margin: 0; background: #E9E9E7; }
body { display: flex; flex-direction: column; align-items: center; gap: ${KP_PAGE_GAP}px; }
.page { width: ${KP_PAGE_WIDTH}px; height: ${KP_PAGE_HEIGHT}px; background: #fff; overflow: hidden; flex-shrink: 0;
  font-family: 'Jost', 'Segoe UI', sans-serif; color: #1B1F24; line-height: normal; }
.page > div { width: ${KP_PAGE_WIDTH}px !important; height: ${KP_PAGE_HEIGHT}px !important; box-sizing: border-box; }
.page * { box-sizing: content-box; }
.page > div { box-sizing: border-box; }
.page h1, .page h2, .page h3, .page p { margin: 0; }
.page img { max-width: none; }
@media print {
  @page { size: 210mm 297mm; margin: 0; }
  html, body { background: #fff; height: auto; }
  body { display: block; }
  .page { width: 210mm; height: 297mm; box-shadow: none; page-break-after: always; break-after: page; margin: 0; overflow: hidden; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}`;

/** Full HTML document for the sandboxed iframe (`srcdoc`). No scripts. */
export function kpSrcdoc(result: KpRenderResult, assetBase: string, lang: KpParams['lang']): string {
  const base = escapeHtml(assetBase);
  // Absolute asset URLs: Chrome's preload scanner may resolve the first load of an about:srcdoc
  // document against the parent URL before <base> applies.
  const pages = result.pagesHtml.map((p) => `<div class="page">${p.split('src="assets/').join(`src="${base}assets/`)}</div>`).join('\n');
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'ru'}">
<head>
<meta charset="utf-8">
<base href="${base}">
<title>${escapeHtml(result.title)}</title>
<link rel="stylesheet" href="${base}fonts.css">
<style>${DOCUMENT_CSS}</style>
</head>
<body>
${pages}
</body>
</html>`;
}

/** Render context of a saved offer: everything is taken from the stored document. */
export function kpContextOf(kp: KpDocument): KpRenderContext {
  return {
    number: kp.number,
    date: kp.createdAt.slice(0, 10),
    clientLegalForm: kp.clientLegalForm,
    clientName: kp.clientName,
    clientInn: kp.clientInn,
    underwriterName: kp.createdByName,
    underwriterEmail: kp.createdByEmail,
    templateVersion: kp.templateVersion,
  };
}

/** Title and iframe document of a saved offer, reproduced from its parameters. */
export function kpDocumentHtml(kp: KpDocument): { title: string; html: string } {
  const result = renderKp(kp.params, kpContextOf(kp));
  return { title: result.title, html: kpSrcdoc(result, KP_TEMPLATES[kp.params.templateId].assetBase, kp.params.lang) };
}
