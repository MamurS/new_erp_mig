/*
 * The only place allowed to touch localStorage. UI preferences only:
 * never tokens, sessions or personal data.
 */

/** Portals with a side panel; each remembers its own state and width. */
export type NavPortal = 'staff' | 'assist' | 'clinic' | 'hr';

export interface NavPrefs {
  collapsed?: boolean;
  width?: number;
}

export type UiPrefs = {
  lang: 'ru' | 'uz';
  nav: Partial<Record<NavPortal, NavPrefs>>;
};

const KEYS: { [K in keyof UiPrefs]: string } = {
  lang: 'mig.ui.lang',
  nav: 'mig.ui.nav',
};

const PORTALS: readonly NavPortal[] = ['staff', 'assist', 'clinic', 'hr'];

/** Width limits of the side panel, px. */
export const NAV_WIDTH = { min: 224, max: 400, default: 288 } as const;

export const clampNavWidth = (w: number): number => Math.min(NAV_WIDTH.max, Math.max(NAV_WIDTH.min, Math.round(w)));

function parseNav(parsed: unknown): UiPrefs['nav'] | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const out: UiPrefs['nav'] = {};
  for (const p of PORTALS) {
    const v = (parsed as Record<string, unknown>)[p];
    if (typeof v !== 'object' || v === null) continue;
    const { collapsed, width } = v as Record<string, unknown>;
    const prefs: NavPrefs = {};
    if (typeof collapsed === 'boolean') prefs.collapsed = collapsed;
    if (typeof width === 'number' && Number.isFinite(width)) prefs.width = clampNavWidth(width);
    out[p] = prefs;
  }
  return out;
}

export function getPref<K extends keyof UiPrefs>(key: K, fallback: UiPrefs[K]): UiPrefs[K] {
  try {
    const raw = localStorage.getItem(KEYS[key]);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (key === 'lang') return (parsed === 'ru' || parsed === 'uz' ? parsed : fallback) as UiPrefs[K];
    if (key === 'nav') return (parseNav(parsed) ?? fallback) as UiPrefs[K];
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

/** Side panel of one portal: expanded at the default width unless the person changed it. */
export function getNavPrefs(portal: NavPortal): Required<NavPrefs> {
  const p = getPref('nav', {})[portal] ?? {};
  return { collapsed: p.collapsed ?? false, width: p.width ?? NAV_WIDTH.default };
}

export function setNavPrefs(portal: NavPortal, patch: NavPrefs): void {
  const all = getPref('nav', {});
  setPref('nav', { ...all, [portal]: { ...all[portal], ...patch } });
}
