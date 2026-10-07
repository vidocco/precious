import { mkdir } from 'node:fs/promises';
import { buildApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { loadConfig } from './config.ts';
import { pruneCache } from './connectors/cache.ts';
import { createRuntime } from './connectors/runner.ts';
import { createDb } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { seedStarterTemplates } from './db/seed.ts';
import { pruneImages } from './services/remoteImages.ts';

const config = loadConfig();
const database = createDb(config.DATABASE_URL);
await runMigrations(database, config.MIGRATIONS_DIR);
const seeded = await seedStarterTemplates(database.db);
await mkdir(config.UPLOAD_DIR, { recursive: true });

await pruneCache(database.db);

const auth = createAuth(database.db, config);
const connectors = createRuntime(database.db, config.APP_SECRET);
const app = await buildApp({ config, database, auth, connectors }, { logger: { level: config.LOG_LEVEL } });
if (seeded) app.log.info({ seeded }, 'added starter templates');

// Covers no item uses (replaced, removed, or found for an item never saved) are cleared daily.
async function sweepImages() {
  try {
    const removed = await pruneImages(database.db, config.UPLOAD_DIR);
    if (removed) app.log.info({ removed }, 'removed unused images');
  } catch (err) {
    app.log.warn({ err }, 'could not remove unused images');
  }
}
await sweepImages();
const sweep = setInterval(() => void sweepImages(), 24 * 3600_000);
sweep.unref();

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
