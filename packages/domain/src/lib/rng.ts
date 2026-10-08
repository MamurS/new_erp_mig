/* Deterministic generator for the seed: mulberry32. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED = 20260929;

export function int(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const v = items[Math.floor(rng() * items.length)];
  if (v === undefined) throw new Error('pick from empty list');
  return v;
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function digits(rng: Rng, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String(int(rng, i === 0 ? 1 : 0, 9));
  return s;
}

/** RFC 4122 v4 UUID from the deterministic generator. */
export function uuidFrom(rng: Rng): string {
  const b = Array.from({ length: 16 }, () => int(rng, 0, 255));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Stable 32-bit hash for derived per-entity generators. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Runtime ids and tokens live in the domain (the services create rows); kept here for the seed's callers.
export { randomId, randomToken } from './random';
