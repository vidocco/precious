import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';

const config = loadConfig();
const database = createDb(config.DATABASE_URL);
const app = buildApp({ pingDatabase: () => database.ping() }, { logger: { level: config.LOG_LEVEL } });

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
