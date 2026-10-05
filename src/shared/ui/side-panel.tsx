import { t } from '@/i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

/** Non-modal details panel on the right, 380 px (SPEC §7.1). Esc closes it. */
export function SidePanel({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside
      ref={ref}
      aria-label={t('shell.sidePanel.label')}
      className={cn(
        'animate-panel fixed inset-y-0 right-0 z-40 flex w-full max-w-[380px] flex-col border-l border-border bg-surface shadow-xl lg:sticky lg:top-0 lg:z-0 lg:h-[calc(100vh-52px)] lg:shadow-none',
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0 truncate font-bold">{title}</div>
        <button type="button" onClick={onClose} aria-label={t('shell.sidePanel.close')} className="rounded-btn p-1 text-muted hover:bg-rail">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}
