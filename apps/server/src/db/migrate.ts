import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './client.ts';

export async function runMigrations(database: Database, migrationsFolder: string) {
  await migrate(database.db, { migrationsFolder });
}
