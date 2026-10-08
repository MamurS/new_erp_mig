/*
 * In-memory "server" database: the current state built from the seed. The row shapes live in the seed package.
 */
import type { Db } from '@mig/seed/db';

export * from '@mig/seed/db';

let current: Db | null = null;
let factory: (() => Db) | null = null;

export function registerSeed(fn: () => Db): void {
  factory = fn;
}

export function db(): Db {
  if (!current) {
    if (!factory) throw new Error('seed not registered');
    current = factory();
  }
  return current;
}

export function replaceDb(next: Db): void {
  current = next;
}

export function resetDb(): Db {
  if (!factory) throw new Error('seed not registered');
  current = factory();
  return current;
}
