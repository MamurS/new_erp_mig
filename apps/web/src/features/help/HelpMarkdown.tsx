/*
 * Safe renderer of the help markdown subset (src/shared/help/markdown.ts) into React elements: no HTML
 * strings, no dangerouslySetInnerHTML. Links are internal only: `#anchor` becomes a link when the anchor
 * is available to the role (`anchorHref`), anything else is rendered as plain text. Mentions of sections
 * by number («раздел 12») become links to those articles when the article is available.
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { safeUrl } from '@/shared/lib/safeUrl';
import { parseMarkdown, type Block, type Inline } from '@/shared/help/markdown';
import { SECTION_REF } from '@/shared/help/lang';

export interface HelpMarkdownProps {
  markdown: string;
  /**
   * URL for an anchor of the guide, or null when the role cannot read it (then the text is not a link).
   * Example: `(a) => (available.has(a) ? `/staff/help#${a}` : null)`.
   */
  anchorHref: (anchor: string) => string | null;
  /** Article anchor by its number for «раздел 12» references (optional). */
  articleByNumber?: (n: string) => string | null;
  /** Hook for plain text runs, e.g. to underline glossary terms. Must return text as React nodes only. */
  renderText?: (text: string, key: string) => ReactNode;
  /** Shift of heading levels (`##` → h2 + shift). */
  headingShift?: number;
  className?: string;
}

export function HelpMarkdown({ markdown, className, ...opts }: HelpMarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  return <div className={cn('help-md space-y-3 text-sm leading-relaxed', className)}>{renderBlocks(blocks, opts, 'b')}</div>;
}

type Opts = Omit<HelpMarkdownProps, 'markdown' | 'className'>;

function renderBlocks(blocks: readonly Block[], o: Opts, key: string): ReactNode[] {
  return blocks.map((b, i) => renderBlock(b, o, `${key}.${i}`));
}

function renderBlock(b: Block, o: Opts, key: string): ReactNode {
  switch (b.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(2, b.level + (o.headingShift ?? 0)));
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag key={key} id={b.anchor} className="font-semibold">
          {renderInline(b.children, o, key)}
        </Tag>
      );
    }
    case 'paragraph':
      return <p key={key}>{renderInline(b.children, o, key)}</p>;
    case 'list': {
      const items = b.items.map((it, i) => <li key={`${key}.${i}`}>{renderListItem(it.children, o, `${key}.${i}`)}</li>);
      return b.ordered ? (
        <ol key={key} start={b.start} className="list-decimal space-y-1 pl-6">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 pl-6">
          {items}
        </ul>
      );
    }
    case 'table':
      return (
        <div key={key} className="help-table overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                {b.header.map((c, i) => (
                  <th key={i} scope="col" className="border-b px-2 py-1.5 align-bottom font-semibold">
                    {renderInline(c, o, `${key}.h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className="align-top">
                  {r.map((c, ci) => (
                    <td key={ci} className="border-b px-2 py-1.5">
                      {renderInline(c, o, `${key}.${ri}.${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'blockquote':
      return (
        <blockquote key={key} className="border-l-4 pl-3">
          {renderBlocks(b.children, o, key)}
        </blockquote>
      );
    case 'code':
      return (
        <pre key={key} className="overflow-x-auto rounded p-2 text-xs">
          <code>{b.text}</code>
        </pre>
      );
    case 'hr':
      return <hr key={key} />;
  }
}

/** A list item's first paragraph is rendered inline (no extra margins), the rest as blocks. */
function renderListItem(children: readonly Block[], o: Opts, key: string): ReactNode {
  return children.map((c, i) => (c.type === 'paragraph' && i === 0 ? <Fragment key={i}>{renderInline(c.children, o, `${key}.${i}`)}</Fragment> : renderBlock(c, o, `${key}.${i}`)));
}

function renderInline(nodes: readonly Inline[], o: Opts, key: string): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}.${i}`;
    switch (n.type) {
      case 'text':
        return <Fragment key={k}>{renderText(n.text, o, k)}</Fragment>;
      case 'strong':
        return <strong key={k}>{renderInline(n.children, o, k)}</strong>;
      case 'em':
        return <em key={k}>{renderInline(n.children, o, k)}</em>;
      case 'code':
        return (
          <code key={k} className="rounded px-1 font-mono text-[0.9em]">
            {n.text}
          </code>
        );
      case 'link': {
        const href = internalHref(n.href, o);
        return href ? (
          <a key={k} href={href} className="underline underline-offset-2">
            {renderInline(n.children, o, k)}
          </a>
        ) : (
          <Fragment key={k}>{renderInline(n.children, o, k)}</Fragment>
        );
      }
    }
  });
}

/** Only `#anchor` links of the guide, and only to anchors the role can read. */
function internalHref(href: string, o: Opts): string | null {
  const m = /^#([a-z0-9][a-z0-9-]*)$/.exec(href.trim());
  if (!m) return null;
  const url = o.anchorHref(m[1]!);
  if (!url) return null;
  const safe = safeUrl(url);
  return safe.startsWith('/') || safe.startsWith('#') ? safe : null;
}

/** Plain text with «раздел N» references linked to available articles, then the caller's text hook. */
function renderText(text: string, o: Opts, key: string): ReactNode {
  const parts: ReactNode[] = [];
  let pos = 0;
  if (o.articleByNumber) {
    for (const m of text.matchAll(SECTION_REF)) {
      const anchor = o.articleByNumber(m[1]!);
      const href = anchor ? internalHref(`#${anchor}`, o) : null;
      if (!href) continue;
      if (m.index > pos) parts.push(plain(text.slice(pos, m.index), o, `${key}.t${pos}`));
      parts.push(
        <a key={`${key}.r${m.index}`} href={href} className="underline underline-offset-2">
          {m[0]}
        </a>,
      );
      pos = m.index + m[0].length;
    }
  }
  if (pos < text.length) parts.push(plain(text.slice(pos), o, `${key}.t${pos}`));
  return parts;
}

function plain(text: string, o: Opts, key: string): ReactNode {
  return o.renderText ? <Fragment key={key}>{o.renderText(text, key)}</Fragment> : <Fragment key={key}>{text}</Fragment>;
}
