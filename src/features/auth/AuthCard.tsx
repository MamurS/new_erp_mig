import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { LanguageSwitch } from '@/shared/ui/language-switch';
import { ShieldCheck } from 'lucide-react';

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main data-theme="staff" className="flex min-h-[calc(100vh-var(--banner-h,0px))] items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-btn bg-accent text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <div className="font-bold">Mosaic Insurance Group</div>
            <div className="text-[12px] text-muted">{t('auth.card.tagline')}</div>
          </div>
          <LanguageSwitch className="ml-auto" />
        </div>
        <div className="rounded-card border border-border bg-surface p-6">
          <h1 className="text-[20px] font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer}
      </div>
    </main>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'danger' }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={
        tone === 'danger'
          ? 'mb-4 rounded-btn border border-danger/30 bg-danger-soft px-3 py-2 text-danger-text'
          : 'mb-4 rounded-btn border border-accent/20 bg-accent-soft px-3 py-2 text-accent-text'
      }
    >
      {children}
    </div>
  );
}
