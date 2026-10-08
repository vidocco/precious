import { templateInputSchema } from '@precious/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { collections, items, templates, user } from '../db/schema.ts';
import { notFound } from '../errors.ts';
import { templateData } from '../services/collections.ts';
import { itemDto, selectItems } from '../services/items.ts';

/** Read-only views of collections shared with "anyone with the link". No sign-in needed. */
export const publicRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;
  const slugParams = z.object({ slug: z.string().min(6).max(40) });

  async function loadPublic(slug: string) {
    const [row] = await db
      .select({ c: collections, t: templates, ownerName: user.name })
      .from(collections)
      .innerJoin(templates, eq(templates.id, collections.templateId))
      .leftJoin(user, eq(user.id, collections.ownerId))
      .where(and(eq(collections.publicSlug, slug), eq(collections.visibility, 'public')));
    if (!row) throw notFound('Shared collection');
    return row;
  }

  function publicTemplate(t: typeof templates.$inferSelect) {
    // Defaults filled in; a template saved by a newer version (beyond this one's limits) is shown as stored.
    const stored = templateData(t);
    const data = templateInputSchema.safeParse(stored).data ?? stored;
    return { ...data, fields: data.fields.filter((f) => !f.hidden && f.type !== 'person') };
  }

  app.get('/api/public/:slug', { schema: { tags: ['public'], params: slugParams } }, async (req) => {
    const { c, t, ownerName } = await loadPublic(req.params.slug);
    const rows = await selectItems(db).where(eq(items.collectionId, c.id)).orderBy(asc(items.title)).limit(1000);
    const template = publicTemplate(t);
    const keep = new Set(template.fields.map((f) => f.id));
    return {
      collection: { name: c.name, accent: c.accent, ownerName: ownerName ?? '', accessionPrefix: c.accessionPrefix },
      template,
      items: rows.map((r) => {
        const dto = itemDto(r.item, c.accessionPrefix, r.cover, null);
        return {
          ...dto,
          data: Object.fromEntries(Object.entries(dto.data).filter(([k]) => keep.has(k))),
          fieldMeta: {},
          createdBy: null,
        };
      }),
    };
  });
};
