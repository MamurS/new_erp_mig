import * as M from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end'; className?: string }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={4}
        className={cn('z-50 min-w-[180px] rounded-card border border-border bg-surface p-1 text-text shadow-lg', className)}
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({ className, danger, ...p }: ComponentPropsWithoutRef<typeof M.Item> & { danger?: boolean }) {
  return (
    <M.Item
      {...p}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 outline-hidden data-disabled:cursor-not-allowed data-highlighted:bg-rail data-disabled:opacity-50',
        danger && 'text-danger-text',
        className,
      )}
    />
  );
}

export function MenuCheckbox({ checked, onCheckedChange, children }: { checked: boolean; onCheckedChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <M.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
      className="flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 outline-hidden data-highlighted:bg-rail"
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-sm border border-border">
        <M.ItemIndicator>
          <Check className="h-3 w-3" />
        </M.ItemIndicator>
      </span>
      {children}
    </M.CheckboxItem>
  );
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <M.Label className="px-2 py-1 text-[12px] text-muted">{children}</M.Label>
);
