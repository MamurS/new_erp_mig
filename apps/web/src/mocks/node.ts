import { setupServer } from 'msw/node';
import { handlers } from './handlers';
import { demoHandlers } from './handlers/demo';
import { initMockDb } from './setup';
import { resetDb } from './db';

export function createMockServer() {
  initMockDb({ restore: false });
  resetDb();
  return setupServer(...demoHandlers, ...handlers);
}
