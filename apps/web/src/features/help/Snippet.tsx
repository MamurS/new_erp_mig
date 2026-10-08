/* A search snippet of the help: the matched parts are highlighted with <mark> (React elements only). */
import type { HelpSnippetPart } from '@mig/contracts/help';
import { cn } from '@/shared/lib/cn';

export function Snippet({ parts, className }: { parts: readonly HelpSnippetPart[]; className?: string }) {
  return (
    <span className={cn('help-snippet', className)}>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-warning-soft px-0.5 text-text">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}
