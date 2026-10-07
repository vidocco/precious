import { STARTER_TEMPLATES, shelfIssues, templateInputSchema } from '@precious/shared';
import { count, eq, isNull } from 'drizzle-orm';
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

/**
 * Starter templates made before shelves existed get the starter's shelf rules, as long
 * as the fields those rules use are still there. Templates with their own rules are left alone.
 */
export async function fillStarterShelves(db: Db): Promise<number> {
  const rows = await db.select().from(templates).where(isNull(templates.shelf));
  let filled = 0;
  for (const t of rows) {
    const starter = STARTER_TEMPLATES.find((s) => s.name === t.name);
    if (!starter) continue;
    const { shelf } = templateInputSchema.parse(starter);
    if (shelfIssues(shelf, t.fields).length) continue;
    await db.update(templates).set({ shelf }).where(eq(templates.id, t.id));
    filled++;
  }
  return filled;
}
