import { randomBytes } from 'node:crypto';
import { arrangementIssues, collectionInputSchema, collectionUpdateSchema } from '@precious/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canView } from '../auth/access.ts';
import { mustUser } from '../auth/guard.ts';
import type { AppContext } from '../context.ts';
import { collections, templates, user } from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import { assertCanManage, collectionColumns, collectionDto, loadCollection } from '../services/collections.ts';
import { computeFigures, reindexCollections } from '../services/items.ts';

const newSlug = () => randomBytes(9).toString('base64url');

export const collectionRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;
  const idParams = z.object({ id: z.string().uuid() });

  app.get('/api/collections', { schema: { tags: ['collections'] } }, async (req) => {
    const viewer = mustUser(req);
    const rows = await db
      .select(collectionColumns)
      .from(collections)
      .leftJoin(user, eq(user.id, collections.ownerId))
      .orderBy(asc(collections.name));
    return rows.filter((r) => canView(viewer, r.collection)).map((r) => collectionDto(r, viewer));
  });

  app.get('/api/collections/:id', { schema: { tags: ['collections'], params: idParams } }, async (req) => {
    const viewer = mustUser(req);
    const row = await loadCollection(db, req.params.id, viewer);
    return collectionDto(row, viewer);
  });

  app.get('/api/collections/:id/figures', { schema: { tags: ['collections'], params: idParams } }, async (req) => {
    const viewer = mustUser(req);
    const row = await loadCollection(db, req.params.id, viewer);
    return computeFigures(db, row.collection.id, row.template.header, row.template.fields);
  });

  app.post(
    '/api/collections',
    { schema: { tags: ['collections'], body: collectionInputSchema } },
    async (req, reply) => {
      const viewer = mustUser(req);
      const [template] = await db.select().from(templates).where(eq(templates.id, req.body.templateId));
      if (!template) throw badRequest('That template no longer exists.');
      const [created] = await db
        .insert(collections)
        .values({
          ...req.body,
          accessionPrefix: req.body.accessionPrefix ?? template.accessionPrefix,
          ownerId: viewer.id,
          publicSlug: req.body.visibility === 'public' ? newSlug() : null,
        })
        .returning({ id: collections.id });
      const row = await loadCollection(db, (created as { id: string }).id, viewer);
      return reply.code(201).send(collectionDto(row, viewer));
    },
  );

  app.patch(
    '/api/collections/:id',
    {
      schema: {
        tags: ['collections'],
        params: idParams,
        // Admins can also hand a collection to someone else.
        body: collectionUpdateSchema.extend({ ownerId: z.string().min(1).optional() }),
      },
    },
    async (req) => {
      const viewer = mustUser(req);
      const row = await loadCollection(db, req.params.id, viewer);
      assertCanManage(viewer, row.collection);
      const { ownerId, ...changes } = req.body;
      if (ownerId !== undefined) {
        if (viewer.role !== 'admin') throw badRequest('Only admins can change who owns a collection.');
        const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, ownerId));
        if (!target) throw notFound('Person');
      }
      if (changes.arrangement) {
        const issues = arrangementIssues(changes.arrangement, row.template.fields, ['arrangement']);
        if (issues.length)
          throw badRequest(
            'That shelf order uses fields this collection doesn’t have.',
            issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          );
      }
      const goingPublic = changes.visibility === 'public' && !row.collection.publicSlug;
      await db
        .update(collections)
        .set({ ...changes, ...(ownerId && { ownerId }), ...(goingPublic && { publicSlug: newSlug() }) })
        .where(eq(collections.id, row.collection.id));
      if (changes.accessionPrefix && changes.accessionPrefix !== row.collection.accessionPrefix) {
        await reindexCollections(db, [{ id: row.collection.id, prefix: changes.accessionPrefix }], row.template.fields);
      }
      return collectionDto(await loadCollection(db, row.collection.id, viewer), viewer);
    },
  );

  app.delete('/api/collections/:id', { schema: { tags: ['collections'], params: idParams } }, async (req, reply) => {
    const viewer = mustUser(req);
    const row = await loadCollection(db, req.params.id, viewer);
    assertCanManage(viewer, row.collection);
    await db.delete(collections).where(eq(collections.id, row.collection.id));
    return reply.code(204).send();
  });
};
