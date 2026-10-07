import { mkdir } from 'node:fs/promises';
import { buildApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { seedStarterTemplates } from './db/seed.ts';

const config = loadConfig();
const database = createDb(config.DATABASE_URL);
await runMigrations(database, config.MIGRATIONS_DIR);
const seeded = await seedStarterTemplates(database.db);
await mkdir(config.UPLOAD_DIR, { recursive: true });

const auth = createAuth(database.db, config);
const app = await buildApp({ config, database, auth }, { logger: { level: config.LOG_LEVEL } });
if (seeded) app.log.info({ seeded }, 'added starter templates');

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
