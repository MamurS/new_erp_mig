import * as C from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

export function Checkbox({
  checked,
  onCheckedChange,
  id,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id?: string;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <C.Root
      id={id}
      checked={checked}
      aria-label={ariaLabel}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border bg-surface data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        className,
      )}
    >
      <C.Indicator>
        <Check className="h-3.5 w-3.5 text-white" />
      </C.Indicator>
    </C.Root>
  );
}
