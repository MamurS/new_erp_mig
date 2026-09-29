import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/shared/lib/cn';

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  large?: boolean;
  autoFocus?: boolean;
  groupLabel?: string;
  digitLabel?: (n: number) => string;
}

/** Six separate boxes with auto-advance and paste support (SPEC §8.1). */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  large,
  autoFocus,
  groupLabel = 'Код подтверждения',
  digitLabel = (n) => `Цифра ${n}`,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  const setAt = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    const joined = next.join('').slice(0, 6);
    onChange(joined);
    if (/^\d{6}$/.test(joined)) onComplete?.(joined);
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
      setAt(i - 1, '');
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    e.preventDefault();
    onChange(text);
    refs.current[Math.min(text.length, 5)]?.focus();
    if (text.length === 6) onComplete?.(text);
  };

  return (
    <div className="flex gap-2" role="group" aria-label={groupLabel}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={digitLabel(i + 1)}
          aria-invalid={invalid || undefined}
          onPaste={onPaste}
          onKeyDown={(e) => onKey(i, e)}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (!v) {
              setAt(i, '');
              return;
            }
            if (v.length > 1) {
              // Some keyboards insert the whole code into one box.
              const all = (digits.slice(0, i).join('') + v).slice(0, 6);
              onChange(all);
              refs.current[Math.min(all.length, 5)]?.focus();
              if (all.length === 6) onComplete?.(all);
              return;
            }
            setAt(i, v);
            if (i < 5) refs.current[i + 1]?.focus();
          }}
          className={cn(
            'rounded-btn border border-border bg-surface text-center font-semibold num focus-visible:outline-2 focus-visible:outline-accent',
            large ? 'h-14 w-12 text-[22px]' : 'h-11 w-10 text-[18px]',
            invalid && 'border-danger',
          )}
        />
      ))}
    </div>
  );
}
