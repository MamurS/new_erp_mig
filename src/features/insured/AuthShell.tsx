import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { LangSwitch } from './components';

/** Frame for /app/login, /app/login/code and /app/consent. */
export function AuthShell({ title, subtitle, children, top }: { title: string; subtitle?: ReactNode; children: ReactNode; top?: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col px-5 pb-8 pt-5">
      <div className="mb-10 flex items-center justify-between gap-2">
        {top ?? (
          <span className="flex items-center gap-2 font-heading text-[17px] font-semibold">
            <span className="flex h-10 w-10 items-center justify-center rounded-btn bg-accent text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            MIG ДМС
          </span>
        )}
        <LangSwitch />
      </div>
      <h1 className="font-heading text-[26px] font-semibold leading-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
      <div className="mt-6 flex flex-1 flex-col">{children}</div>
    </main>
  );
}

export function AuthNotice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'danger' }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'mb-4 rounded-btn px-4 py-3 text-[14px] font-semibold',
        tone === 'danger' ? 'bg-danger-soft text-danger-text' : 'bg-accent-soft text-accent-text',
      )}
    >
      {children}
    </div>
  );
}
