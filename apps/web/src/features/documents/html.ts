/*
 * HTML helpers shared by every generated document (KP, contract, endorsement, certificate, letter).
 * Pure functions without DOM access: the backend repeats them to print the same PDF.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Placeholders of stub templates: `{{client.name}}`, `{{premium.total}}`. */
export const FIELD_RE = /\{\{([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)\}\}/g;

/** Names of the fields used in a text, in order of first appearance. */
export function fieldsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FIELD_RE)) if (m[1] && !out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * Replaces `{{field}}` with the escaped value. A field without a value stays visible as `{{field}}`
 * (escaped too), so a missing value is obvious in the preview and never breaks the markup.
 */
export function fillFields(text: string, values: Readonly<Record<string, string>>): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(FIELD_RE)) {
    out += escapeHtml(text.slice(last, m.index));
    const key = m[1] ?? '';
    const value = values[key];
    out += value === undefined ? `<span class="missing">${escapeHtml(m[0])}</span>` : escapeHtml(value);
    last = (m.index ?? 0) + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}
