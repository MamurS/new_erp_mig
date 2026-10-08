/*
 * After the API tests: the shared local database gets the canonical seed back (what `supabase db reset` loads),
 * since the suites load the seed for their own «now» and write to it.
 */
import { createSeed } from '@mig/seed/seed';
import { SEED_NOW } from '@mig/domain/store/sql/seed';
import { hasDb, loadSeed, testPool } from './support';

export default function setup(): () => Promise<void> {
  return async () => {
    if (!hasDb) return;
    const pool = testPool();
    try {
      await loadSeed(pool, createSeed({ now: SEED_NOW }));
    } finally {
      await pool.end();
    }
  };
}
