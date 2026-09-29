import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  wide?: boolean;
}

/** Accessible modal (Radix: focus trap, Esc, aria). */
export function Modal({ open, onOpenChange, title, description, children, footer, className, wide }: ModalProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <D.Content
          className={cn(
            'animate-modal fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-card border border-border bg-surface p-5 text-text shadow-xl',
            wide ? 'max-w-3xl' : 'max-w-md',
            className,
          )}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <D.Title className="font-heading text-[16px] font-bold">{title}</D.Title>
            <D.Close className="rounded-btn p-1 text-muted hover:bg-rail" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </D.Close>
          </div>
          {description ? (
            <D.Description className="mb-3 text-muted">{description}</D.Description>
          ) : (
            <D.Description className="sr-only">{title}</D.Description>
          )}
          {children}
          {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
