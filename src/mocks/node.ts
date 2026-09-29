import { setupServer } from 'msw/node';
import { handlers } from './handlers';
import { initMockDb } from './setup';
import { resetDb } from './db';

export function createMockServer() {
  initMockDb({ restore: false });
  resetDb();
  return setupServer(...handlers);
}
