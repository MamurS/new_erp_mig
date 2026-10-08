/* The API process: configuration from the environment, then the API and its worker (assemble.ts). */
import { assemble } from './assemble';
import { readEnv } from './env';

const env = readEnv();
// LOG_LEVEL (info by default): `warn` leaves only failures in the request log (the e2e-backend run).
const { app, pool, worker } = await assemble(env, { logger: { level: process.env.LOG_LEVEL ?? 'info' } });
worker?.start();

const stop = async () => {
  await worker?.stop();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

await app.listen({ host: env.host, port: env.port });
