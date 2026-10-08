/* The API process: configuration from the environment, then the API and its worker (assemble.ts). */
import { assemble } from './assemble';
import { readEnv } from './env';

const env = readEnv();
const { app, pool, worker } = await assemble(env, { logger: true });
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
