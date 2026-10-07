import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export function createDb(url: string) {
  const client = postgres(url, { max: 10 });
  const db = drizzle(client, { schema });

  return {
    db,
    async ping(timeoutMs = 2000): Promise<boolean> {
      try {
        await Promise.race([
          db.execute(sql`select 1`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
        ]);
        return true;
      } catch {
        return false;
      }
    },
    close: () => client.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDb>;
export type Db = Database['db'];
