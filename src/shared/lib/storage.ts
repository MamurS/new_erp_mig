/*
 * The only place allowed to touch localStorage. UI preferences only:
 * never tokens, sessions or personal data.
 */

/** Portals with a side navigation; each remembers its own collapsed state. */
export type NavPortal = 'staff' | 'assist';

export type UiPrefs = {
  lang: 'ru' | 'uz';
  navCollapsed: Partial<Record<NavPortal, boolean>>;
};

const KEYS: { [K in keyof UiPrefs]: string } = {
  lang: 'mig.ui.lang',
  navCollapsed: 'mig.ui.navCollapsed',
};

const PORTALS: readonly NavPortal[] = ['staff', 'assist'];

function parseNav(parsed: unknown): UiPrefs['navCollapsed'] | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const out: UiPrefs['navCollapsed'] = {};
  for (const p of PORTALS) {
    const v = (parsed as Record<string, unknown>)[p];
    if (typeof v === 'boolean') out[p] = v;
  }
  return out;
}

export function getPref<K extends keyof UiPrefs>(key: K, fallback: UiPrefs[K]): UiPrefs[K] {
  try {
    const raw = localStorage.getItem(KEYS[key]);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (key === 'lang') return (parsed === 'ru' || parsed === 'uz' ? parsed : fallback) as UiPrefs[K];
    if (key === 'navCollapsed') return (parseNav(parsed) ?? fallback) as UiPrefs[K];
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

/** Collapsed side navigation of one portal; expanded by default. */
export function getNavCollapsed(portal: NavPortal): boolean {
  return getPref('navCollapsed', {})[portal] ?? false;
}

export function setNavCollapsed(portal: NavPortal, collapsed: boolean): void {
  setPref('navCollapsed', { ...getPref('navCollapsed', {}), [portal]: collapsed });
}
