/*
 * Persistence of the mock *server* state across tab reloads. This emulates the server database,
 * it is not the client session (that lives in src/shared/auth/session.ts). Uploaded file bytes are
 * not persisted. Access to sessionStorage is allowed here by the ESLint config.
 */
import type { Db } from './db';

const DB_KEY = 'mig.mock.db';
const SESS_KEY = 'mig.mock.sessions';
/**
 * Version of the seed and of the stored shape. Bump it when the seed changes in a way a saved state
 * must not survive (2: Latin names, legal form codes, ASCII document numbers; 3: migration batches and the
 * transfer marks of records; 4: premiums of transferred insured persons and the per-contract premium check; 5: family members as insured persons,
 * family consents and requests): a stored database with
 * another or no version is discarded and the fresh seed is used.
 */
export const MOCK_DB_VERSION = 6;

type Snapshot = Omit<Db, 'sessions'> & { schemaVersion?: number };

export function loadSnapshot(): Db | null {
  try {
    const raw = sessionStorage.getItem(DB_KEY);
    if (!raw) return null;
    const { schemaVersion, ...db } = JSON.parse(raw) as Snapshot;
    if (schemaVersion !== MOCK_DB_VERSION) {
      clearSnapshot();
      return null;
    }
    const sessions = JSON.parse(sessionStorage.getItem(SESS_KEY) ?? '[]') as Db['sessions'];
    // A snapshot from an older build lacks newer tables: start from a fresh seed instead.
    if (!Array.isArray(db.kp) || !Array.isArray(db.clinicUsers) || !Array.isArray(db.registries) || !Array.isArray(db.policyChanges) || !Array.isArray(db.rebills) || !db.dmsParams || !Array.isArray(db.deals) || !db.ai || !Array.isArray(db.bankPayments) || !Array.isArray(db.statementKeys) || !Array.isArray(db.migrationBatches) || !Array.isArray(db.familyConsents) || !Array.isArray(db.familyRequests)) return null;
    return { ...db, sessions };
  } catch {
    return null;
  }
}

let dbTimer: ReturnType<typeof setTimeout> | null = null;
let pending: (() => Db) | null = null;

function writeDb(get: () => Db): void {
  try {
    const { sessions: _s, ...rest } = get();
    const files = rest.files.map(({ bytes: _b, ...f }) => f);
    sessionStorage.setItem(DB_KEY, JSON.stringify({ ...rest, files, schemaVersion: MOCK_DB_VERSION }));
  } catch {
    /* quota exceeded: state stays in memory only */
  }
}

// A reload right after a change must not lose it: flush the pending write when the page goes away.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!pending) return;
    if (dbTimer) clearTimeout(dbTimer);
    dbTimer = null;
    const get = pending;
    pending = null;
    writeDb(get);
  });
}

export function saveSessions(db: Db): void {
  try {
    sessionStorage.setItem(SESS_KEY, JSON.stringify(db.sessions));
  } catch {
    /* ignore quota */
  }
}

export function scheduleSaveDb(get: () => Db): void {
  if (dbTimer) clearTimeout(dbTimer);
  pending = get;
  dbTimer = setTimeout(() => {
    dbTimer = null;
    pending = null;
    writeDb(get);
  }, 400);
}

export function clearSnapshot(): void {
  if (dbTimer) clearTimeout(dbTimer);
  dbTimer = null;
  pending = null;
  try {
    sessionStorage.removeItem(DB_KEY);
    sessionStorage.removeItem(SESS_KEY);
  } catch {
    /* ignore */
  }
}
