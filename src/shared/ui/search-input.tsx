import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

export interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** Pressing `/` anywhere focuses this input (SPEC §8.2). */
  slashFocus?: boolean;
  'aria-label'?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, placeholder = 'Поиск', className, slashFocus, 'aria-label': ariaLabel },
  outerRef,
) {
  const ref = useRef<HTMLInputElement>(null);
  useImperativeHandle(outerRef, () => ref.current!);
  useEffect(() => {
    if (!slashFocus) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slashFocus]);
  return (
    <label className={cn('relative flex items-center', className)}>
      <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={value}
        maxLength={100}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="h-8 w-full rounded-btn border border-border bg-surface pl-7 pr-2 placeholder:text-muted/70"
      />
      {slashFocus && (
        <kbd className="pointer-events-none absolute right-2 rounded border border-border px-1 text-[10px] text-muted">/</kbd>
      )}
    </label>
  );
});
