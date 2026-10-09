/*
 * The background worker as its own process (`node apps/api/dist/worker.js`): for deployments that run the API
 * with WORKER=off on several instances and one worker next to them. Same configuration as the API.
 */
import { writeFileSync } from 'node:fs';

import { GoTrue } from './auth/gotrue';
import { createPool } from './db';
import { supabaseStorage } from './files/storage';
import { readEnv } from './env';
import { identitySync } from './jobs/identity';
import { createWorker } from './jobs/worker';
import { serverLog } from './log';

const env = readEnv();
const pool = createPool(env.databaseUrl, Math.min(env.poolSize, 4));
const gotrue = new GoTrue({ url: env.supabaseUrl, serviceKey: env.serviceKey });
const identity = identitySync({
  pool,
  crypto: env.crypto,
  gotrue,
  demoPassword: env.demoPassword,
  testMfa: env.testTotp,
  inviteRedirectTo: env.inviteRedirectTo,
  log: serverLog,
});
const storage = supabaseStorage({ url: env.supabaseUrl, serviceKey: env.serviceKey });
const worker = createWorker({ pool, crypto: env.crypto, identity, storage, log: serverLog, ...(env.workerIntervalMs ? { intervalMs: env.workerIntervalMs } : {}) });
worker.start();
// The worker's own timer is unref'd (inside the API it must not keep the process alive); alone, the process has
// nothing else to wait for and would exit at once: this handle keeps it running until a signal. It also refreshes
// a heartbeat file, the container health check of deploy/docker-compose.yml (`docker compose up --wait` needs one).
const HEARTBEAT_FILE = '/tmp/worker-heartbeat';
const beat = () => {
  try {
    writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  } catch {
    // Outside a container /tmp may be read-only: the heartbeat only serves the health check.
  }
};
beat();
const keepAlive = setInterval(beat, 15_000);

const stop = async () => {
  clearInterval(keepAlive);
  await worker.stop();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
serverLog('worker started', {});
