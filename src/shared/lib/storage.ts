/*
 * The only place allowed to touch localStorage. UI preferences only:
 * never tokens, sessions or personal data.
 */

export type UiPrefs = {
  lang: 'ru' | 'uz';
  navCollapsed: boolean;
};

const KEYS: { [K in keyof UiPrefs]: string } = {
  lang: 'mig.ui.lang',
  navCollapsed: 'mig.ui.navCollapsed',
};

export function getPref<K extends keyof UiPrefs>(key: K, fallback: UiPrefs[K]): UiPrefs[K] {
  try {
    const raw = localStorage.getItem(KEYS[key]);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (key === 'lang') return (parsed === 'ru' || parsed === 'uz' ? parsed : fallback) as UiPrefs[K];
    if (key === 'navCollapsed') return (typeof parsed === 'boolean' ? parsed : fallback) as UiPrefs[K];
    return fallback;
  } catch {
    return fallback;
  }
}

export function setPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void {
  try {
    localStorage.setItem(KEYS[key], JSON.stringify(value));
  } catch {
    /* storage unavailable: preference is simply not persisted */
  }
}
