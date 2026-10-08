/*
 * The interface language: a compact button in the top bar of every portal and on the insured app's
 * home, a radio group in the side panel's user menu, a segmented switch on the sign-in screens and in
 * the insured app's profile. The choice is a UI preference (storage.ts).
 */
import * as M from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Languages } from 'lucide-react';
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

/** Compact button with the current language (RU / UZ / EN) and a list of full names: top bars. */
export function LanguageButton({ className }: { className?: string }) {
  const locale = useLocale();
  return (
    <M.Root>
      <M.Trigger asChild>
        <button
          type="button"
          data-testid="lang-button"
          aria-label={t('shell.lang.button', { lang: LOCALE_NAME[locale] })}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1 rounded-btn border border-border bg-surface px-2 text-[12px] font-semibold text-muted hover:text-text data-[state=open]:text-text',
            className,
          )}
        >
          <Languages className="h-3.5 w-3.5" aria-hidden />
          <span lang={locale}>{LOCALE_SHORT[locale]}</span>
          <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[160px] rounded-card border border-border bg-surface p-1 text-[14px] text-text shadow-lg"
        >
          <M.RadioGroup value={locale} onValueChange={(v) => isLocale(v) && setLocale(v)}>
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
                <span className="flex-1">{LOCALE_NAME[l]}</span>
                <span className="text-[11px] text-muted">{LOCALE_SHORT[l]}</span>
              </M.RadioItem>
            ))}
          </M.RadioGroup>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
