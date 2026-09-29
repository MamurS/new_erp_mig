/*
 * Persistence of the mock *server* state across tab reloads. This emulates the server database,
 * it is not the client session (that lives in src/shared/auth/session.ts). Uploaded file bytes are
 * not persisted. Access to sessionStorage is allowed here by the ESLint config.
 */
import type { Db } from './db';

const DB_KEY = 'mig.mock.db';
const SESS_KEY = 'mig.mock.sessions';

type Snapshot = Omit<Db, 'sessions'>;

export function loadSnapshot(): Db | null {
  try {
    const raw = sessionStorage.getItem(DB_KEY);
    if (!raw) return null;
    const db = JSON.parse(raw) as Snapshot;
    const sessions = JSON.parse(sessionStorage.getItem(SESS_KEY) ?? '[]') as Db['sessions'];
    return { ...db, sessions };
  } catch {
    return null;
  }
}

let dbTimer: ReturnType<typeof setTimeout> | null = null;

export function saveSessions(db: Db): void {
  try {
    sessionStorage.setItem(SESS_KEY, JSON.stringify(db.sessions));
  } catch {
    /* ignore quota */
  }
}

export function scheduleSaveDb(get: () => Db): void {
  if (dbTimer) clearTimeout(dbTimer);
  dbTimer = setTimeout(() => {
    dbTimer = null;
    try {
      const { sessions: _s, ...rest } = get();
      const files = rest.files.map(({ bytes: _b, ...f }) => f);
      sessionStorage.setItem(DB_KEY, JSON.stringify({ ...rest, files }));
    } catch {
      /* quota exceeded: state stays in memory only */
    }
  }, 400);
}

export function clearSnapshot(): void {
  try {
    sessionStorage.removeItem(DB_KEY);
    sessionStorage.removeItem(SESS_KEY);
  } catch {
    /* ignore */
  }
}
