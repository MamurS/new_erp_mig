/* Registers the seed and restores persisted server state. Shared by browser and node setups. */
import { registerSeed, replaceDb } from './db';
import { createSeed } from '@mig/seed/seed';
import { mockConfig } from './config';
import { loadSnapshot } from './persist';

export function initMockDb(options: { restore: boolean }): void {
  registerSeed(() => createSeed({ xss: mockConfig.xss }));
  if (options.restore) {
    const snap = loadSnapshot();
    if (snap) replaceDb(snap);
  }
}
