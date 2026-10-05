import { useSyncExternalStore } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(text: string, tone: Tone): void {
  const id = nextId++;
  items = [...items.slice(-3), { id, text, tone }];
  emit();
  setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500);
}

export function dismiss(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Toast text repeats the verb of the button that triggered it (SPEC §10). */
export const toast = {
  success: (text: string) => push(text, 'success'),
  error: (text: string) => push(text, 'error'),
  info: (text: string) => push(text, 'info'),
};

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => items,
  );
  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed bottom-4 left-1/2 z-70 flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-card border px-3 py-2.5 shadow-lg',
            t.tone === 'error' ? 'border-danger/30 bg-danger-soft text-danger-text' : 'border-border bg-surface text-text',
          )}
        >
          {t.tone === 'error' ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          )}
          <span className="flex-1">{t.text}</span>
          <button type="button" aria-label="Закрыть уведомление" onClick={() => dismiss(t.id)} className="text-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
