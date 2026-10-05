/*
 * The interface language: a radio group in the side panel's user menu, a segmented switch on the
 * sign-in screens and in the insured app's profile. The choice is a UI preference (storage.ts).
 */
import * as M from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { LOCALES, LOCALE_NAME, LOCALE_SHORT, isLocale, setLocale, t, useLocale } from '@/i18n';
import { cn } from '@/shared/lib/cn';

/** Inside a dropdown menu (the user menu at the bottom of the side panel). */
export function LanguageMenuItems() {
  const locale = useLocale();
  return (
    <M.Group>
      <M.Label className="px-2 py-1 text-[12px] text-muted">{t('shell.lang.label')}</M.Label>
      <M.RadioGroup value={locale} onValueChange={(v) => isLocale(v) && setLocale(v)} data-testid="lang-menu">
        {LOCALES.map((l) => (
          <M.RadioItem
            key={l}
            value={l}
            lang={l}
            className="flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 outline-hidden data-highlighted:bg-rail"
          >
            <span className="flex h-4 w-4 items-center justify-center">
              <M.ItemIndicator>
                <Check className="h-3.5 w-3.5" aria-hidden />
              </M.ItemIndicator>
            </span>
            {LOCALE_NAME[l]}
          </M.RadioItem>
        ))}
      </M.RadioGroup>
    </M.Group>
  );
}

/** Segmented RU · UZ · EN switch (sign-in screens, the insured app's profile). */
export function LanguageSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  return (
    <div
      role="group"
      aria-label={t('shell.lang.label')}
      data-testid="lang-switch"
      className={cn('inline-flex rounded-btn border border-border bg-surface p-0.5', className)}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          title={LOCALE_NAME[l]}
          aria-label={LOCALE_NAME[l]}
          onClick={() => setLocale(l)}
          className={cn(
            'min-w-9 rounded-[6px] px-2 py-1 text-[12px] font-semibold',
            locale === l ? 'bg-accent text-white' : 'text-muted hover:text-text',
          )}
        >
          {LOCALE_SHORT[l]}
        </button>
      ))}
    </div>
  );
}
