import * as T from '@radix-ui/react-tabs';
import { cn } from '@/shared/lib/cn';
import type { ComponentPropsWithoutRef } from 'react';

export const Tabs = T.Root;
export const TabsContent = (p: ComponentPropsWithoutRef<typeof T.Content>) => (
  <T.Content {...p} className={cn('pt-4 focus-visible:outline-hidden', p.className)} />
);
export const TabsList = (p: ComponentPropsWithoutRef<typeof T.List>) => (
  <T.List {...p} className={cn('flex gap-1 overflow-x-auto border-b border-border', p.className)} />
);
export const TabsTrigger = (p: ComponentPropsWithoutRef<typeof T.Trigger>) => (
  <T.Trigger
    {...p}
    className={cn(
      '-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-muted hover:text-text data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-text',
      p.className,
    )}
  />
);
