/* Time helpers for the mock server (Asia/Tashkent, UTC+5, no DST). */
export const DAY = 86_400_000;
const OFFSET = 5 * 3600_000;

export function nowMs(): number {
  return Date.now();
}

/** `2026-09-29T14:21:00+05:00` */
export function tzIso(ms: number): string {
  return `${new Date(ms + OFFSET).toISOString().slice(0, 19)}+05:00`;
}

/** `2026-09-29` */
export function isoDay(ms: number): string {
  return tzIso(ms).slice(0, 10);
}

/** Midnight (Tashkent) of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const shifted = ms + OFFSET;
  return shifted - (shifted % DAY) - OFFSET;
}

export function parseIso(s: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00+05:00`);
  return Date.parse(s);
}

export function at(dayMs: number, hh: number, mm: number): number {
  return startOfDay(dayMs) + hh * 3600_000 + mm * 60_000;
}
