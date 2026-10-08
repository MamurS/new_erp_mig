/* The demo seed wired to the mock server: the database being seeded becomes the current one. */
import { replaceDb, type Db } from './db';
import { claimsFromRebill } from './assistance-core';
import { createSeed, type SeedOptions } from '@mig/seed/seed';

export function createMockSeed(opts: Omit<SeedOptions, 'hooks'> = {}): Db {
  return createSeed({ ...opts, hooks: { attach: replaceDb, claimsFromRebill } });
}
