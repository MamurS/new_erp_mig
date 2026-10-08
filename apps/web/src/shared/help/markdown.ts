/*
 * The markdown subset of the help (docs/help/USER_GUIDE.*.md) parsed into a small AST. No HTML is ever
 * produced: the AST is rendered to React elements by src/features/help/HelpMarkdown.tsx, and used as
 * plain text by the search and the answers.
 *
 * Blocks: headings (`## Title {#anchor}`), paragraphs, ordered and bulleted lists (nested by indentation),
 * tables (GFM, the first row is the header), blockquotes, fenced code, thematic breaks.
 * Inline: **bold**, *italic* / _italic_, `code`, [text](#anchor) links, backslash escapes.
 * HTML comments (audience markers, editor notes) are dropped; any other HTML is plain text.
 */

import { ABBREVIATION_END } from './lang';

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };

export interface ListItem {
  /** The item's own text, then nested lists or paragraphs. */
  children: Block[];
}

export type Block =
  | { type: 'heading'; level: number; children: Inline[]; anchor?: string }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'blockquote'; children: Block[] }
  | { type: 'code'; text: string }
  | { type: 'hr' };

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+\{#([a-z0-9][a-z0-9-]*)\})?\s*$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const FENCE = /^\s*```/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const COMMENT_ONLY = /^\s*<!--.*-->\s*$/;
const INLINE_COMMENT = /<!--.*?-->/g;

const indentOf = (line: string) => /^ */.exec(line)![0].length;
const isBlank = (line: string) => line.trim() === '';

function startsBlock(line: string): boolean {
  return HEADING.test(line) || LIST_ITEM.test(line) || FENCE.test(line) || HR.test(line) || line.trimStart().startsWith('>') || line.trimStart().startsWith('|');
}

/** Splits a table row into cells (pipes inside `code` and escaped pipes do not split). */
export function splitRow(line: string): string[] {
  let s = line.replace(INLINE_COMMENT, '').trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (ch === '`') code = !code;
    if (ch === '|' && !code) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function parseMarkdown(markdown: string): Block[] {
  return parseLines(markdown.replace(/\r\n?/g, '\n').split('\n'));
}

function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line) || COMMENT_ONLY.test(line)) {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ type: 'heading', level: h[1]!.length, children: parseInline(h[2]!), ...(h[3] ? { anchor: h[3] } : {}) });
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    if (line.trimStart().startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const header = splitRow(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith('|')) {
        const cells = splitRow(lines[i]!);
        rows.push(header.map((_, k) => parseInline(cells[k] ?? '')));
        i++;
      }
      blocks.push({ type: 'table', header: header.map((c) => parseInline(c)), rows });
      continue;
    }
    if (line.trimStart().startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith('>')) body.push(lines[i++]!.trimStart().replace(/^>\s?/, ''));
      blocks.push({ type: 'blockquote', children: parseLines(body) });
      continue;
    }
    const li = LIST_ITEM.exec(line);
    if (li) {
      const r = parseList(lines, i);
      blocks.push(r.block);
      i = r.next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]!) && !COMMENT_ONLY.test(lines[i]!) && (para.length === 0 || !startsBlock(lines[i]!))) para.push(lines[i++]!.trim());
    blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) });
  }
  return blocks;
}

function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = LIST_ITEM.exec(lines[start]!)!;
  const base = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]!);
    if (!m || m[1]!.length !== base || /\d/.test(m[2]!) !== ordered) break;
    const contentIndent = base + m[2]!.length + 1;
    const body: string[] = [m[3]!];
    i++;
    while (i < lines.length) {
      const l = lines[i]!;
      if (isBlank(l)) {
        // A blank line continues the item only if the next non-blank line is indented under it.
        let j = i + 1;
        while (j < lines.length && isBlank(lines[j]!)) j++;
        if (j < lines.length && indentOf(lines[j]!) > base && !COMMENT_ONLY.test(lines[j]!)) {
          body.push('');
          i = j;
          continue;
        }
        break;
      }
      if (COMMENT_ONLY.test(l)) break;
      if (indentOf(l) > base) {
        body.push(l.slice(Math.min(indentOf(l), contentIndent)));
        i++;
        continue;
      }
      // Lazy continuation of the item's paragraph.
      if (!startsBlock(l)) {
        body.push(l.trim());
        i++;
        continue;
      }
      break;
    }
    items.push({ children: parseLines(body) });
    // Items of a loose list are separated by blank lines.
    let j = i;
    while (j < lines.length && isBlank(lines[j]!)) j++;
    const nx = j < lines.length ? LIST_ITEM.exec(lines[j]!) : null;
    if (nx && nx[1]!.length === base && /\d/.test(nx[2]!) === ordered) i = j;
    else break;
  }
  return { block: { type: 'list', ordered, start: ordered ? Number.parseInt(first[2]!, 10) || 1 : 1, items }, next: i };
}

/** Inline markup of one line or cell. */
export function parseInline(src: string): Inline[] {
  return inline(src.replace(INLINE_COMMENT, '').trim());
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}]/u.test(ch);
}

function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\' && i + 1 < s.length && /[\\`*_[\]()#|<>!{}-]/.test(s[i + 1]!)) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ type: 'code', text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: 'strong', children: inline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && !isWordChar(s[i - 1]) && s[i + 1] && s[i + 1] !== ' ' && s[i + 1] !== ch) {
      let end = i + 1;
      while ((end = s.indexOf(ch, end)) !== -1 && (s[end - 1] === ' ' || isWordChar(s[end + 1]) || s[end + 1] === ch)) end++;
      if (end > i + 1) {
        flush();
        out.push({ type: 'em', children: inline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const close = s.indexOf('](', i + 1);
      const paren = close > -1 ? s.indexOf(')', close + 2) : -1;
      if (close > i && paren > close) {
        flush();
        out.push({ type: 'link', href: s.slice(close + 2, paren).trim(), children: inline(s.slice(i + 1, close)) });
        i = paren + 1;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

export function inlineText(nodes: readonly Inline[]): string {
  return nodes.map((n) => (n.type === 'text' || n.type === 'code' ? n.text : inlineText(n.children))).join('');
}

/** Plain text of blocks: one line per paragraph, list item and table row (cells joined by « — »). */
export function blocksText(blocks: readonly Block[]): string {
  const out: string[] = [];
  const walk = (bs: readonly Block[]) => {
    for (const b of bs) {
      if (b.type === 'heading' || b.type === 'paragraph') out.push(inlineText(b.children));
      else if (b.type === 'list') for (const it of b.items) walk(it.children);
      else if (b.type === 'table') for (const r of b.rows) out.push(r.map(inlineText).join(' — '));
      else if (b.type === 'blockquote') walk(b.children);
      else if (b.type === 'code') out.push(b.text);
    }
  };
  walk(blocks);
  return out.join('\n');
}

/** Sentences of a text (abbreviations, see ABBREVIATION_END, do not end a sentence). */
export function sentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?…]+(?:[.!?…]+|$)/gu;
  let buf = '';
  for (const m of text.matchAll(re)) {
    buf += m[0];
    const t = buf.trim();
    // Abbreviations and «1.» — not the end of a sentence.
    if (ABBREVIATION_END.test(t) || /\d\.$/u.test(t)) continue;
    if (t) out.push(t);
    buf = '';
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
