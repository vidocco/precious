import { STARTER_TEMPLATES, templateInputSchema } from '@precious/shared';
import { count } from 'drizzle-orm';
import type { Db } from './client.ts';
import { templates, user } from './schema.ts';

/** On a brand-new install (no users, no templates), adds the starter templates. */
export async function seedStarterTemplates(db: Db): Promise<number> {
  const [users] = await db.select({ n: count() }).from(user);
  const [existing] = await db.select({ n: count() }).from(templates);
  if ((users?.n ?? 0) > 0 || (existing?.n ?? 0) > 0) return 0;
  const rows = STARTER_TEMPLATES.map((t) => templateInputSchema.parse(t));
  await db.insert(templates).values(rows);
  return rows.length;
}
