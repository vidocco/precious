import { mkdir } from 'node:fs/promises';
import { buildApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { loadConfig } from './config.ts';
import { pruneCache } from './connectors/cache.ts';
import { createRuntime } from './connectors/runner.ts';
import { createDb } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { fillStarterShelves, seedStarterTemplates } from './db/seed.ts';
import { backupsFrom } from './services/backups.ts';
import { Scheduler, syncAllComputed } from './services/computed.ts';
import { pruneImages } from './services/remoteImages.ts';

const config = loadConfig();
const database = createDb(config.DATABASE_URL);
await runMigrations(database, config.MIGRATIONS_DIR);
const seeded = await seedStarterTemplates(database.db);
await fillStarterShelves(database.db);
await mkdir(config.UPLOAD_DIR, { recursive: true });

await pruneCache(database.db);

const auth = createAuth(database.db, config);
const connectors = createRuntime(database.db, config.APP_SECRET);
// The error handler runs only once started, after the app exists.
const scheduler = new Scheduler({ db: database.db, rt: connectors }, (err) =>
  app.log.warn({ err }, 'scheduled lookups failed'),
);
const backups = backupsFrom(config, (err) => app.log.error({ err }, 'nightly backup failed'));
const app = await buildApp(
  { config, database, auth, connectors, scheduler, backups },
  { logger: { level: config.LOG_LEVEL } },
);
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

// Values kept up to date: catch up with any settings changed while stopped, then check every minute.
await syncAllComputed(database.db);
scheduler.start();
backups?.start();

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  scheduler.stop();
  backups?.stop();
  await app.close();
  await database.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
