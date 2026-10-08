/*
 * The only place allowed to touch localStorage. UI preferences only:
 * never tokens, sessions or personal data.
 */
import type { Locale } from '@mig/i18n';

/** Portals with a side panel; each remembers its own state and width. */
export type NavPortal = 'staff' | 'assist' | 'clinic' | 'hr';

export interface NavPrefs {
  collapsed?: boolean;
  width?: number;
}

/** Interface languages. */
export type UiLang = Locale;

/** The details card next to a list (split view): only its width. */
export interface DetailPrefs {
  width?: number;
}

export type UiPrefs = {
  lang: UiLang;
  nav: Partial<Record<NavPortal, NavPrefs>>;
  detail: DetailPrefs;
};

const KEYS: { [K in keyof UiPrefs]: string } = {
  lang: 'mig.ui.lang',
  nav: 'mig.ui.nav',
  detail: 'mig.ui.detail',
};

const PORTALS: readonly NavPortal[] = ['staff', 'assist', 'clinic', 'hr'];

/** Width limits of the side panel, px. */
export const NAV_WIDTH = { min: 224, max: 400, default: 288 } as const;

export const clampNavWidth = (w: number): number => Math.min(NAV_WIDTH.max, Math.max(NAV_WIDTH.min, Math.round(w)));

/** Width limits of the details card of a split view, px (one width for every list and portal). */
export const DETAIL_WIDTH = { min: 360, max: 640, default: 420 } as const;

export const clampDetailWidth = (w: number): number =>
  Number.isFinite(w) ? Math.min(DETAIL_WIDTH.max, Math.max(DETAIL_WIDTH.min, Math.round(w))) : DETAIL_WIDTH.default;

function parseDetail(parsed: unknown): DetailPrefs | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { width } = parsed as Record<string, unknown>;
  return typeof width === 'number' && Number.isFinite(width) ? { width: clampDetailWidth(width) } : {};
}

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

function parseLang(parsed: unknown): UiLang | null {
  if (parsed === 'ru' || parsed === 'uz-Latn' || parsed === 'en') return parsed;
  // Before English was added the Uzbek choice was stored as 'uz'.
  if (parsed === 'uz') return 'uz-Latn';
  return null;
}

export function getPref<K extends keyof UiPrefs>(key: K, fallback: UiPrefs[K]): UiPrefs[K] {
  try {
    const raw = localStorage.getItem(KEYS[key]);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (key === 'lang') return (parseLang(parsed) ?? fallback) as UiPrefs[K];
    if (key === 'nav') return (parseNav(parsed) ?? fallback) as UiPrefs[K];
    if (key === 'detail') return (parseDetail(parsed) ?? fallback) as UiPrefs[K];
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

/** Width of the details card of a split view: the default unless the person changed it. */
export function getDetailWidth(): number {
  return getPref('detail', {}).width ?? DETAIL_WIDTH.default;
}

export function setDetailWidth(width: number): void {
  setPref('detail', { width: clampDetailWidth(width) });
}
