import { diffTemplateFields, type TemplateDto, templateInputSchema } from '@precious/shared';
import { asc, count, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canEditTemplate, canView } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.ts';
import { mustUser } from '../auth/guard.ts';
import type { AppContext } from '../context.ts';
import { collections, templates, user } from '../db/schema.ts';
import { badRequest, forbidden, HttpError, notFound } from '../errors.ts';
import { type TemplateRow, templateData } from '../services/collections.ts';
import { reindexCollections } from '../services/items.ts';
import { bindingIssues } from '../services/pipeline.ts';

export const templateRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;
  const idParams = z.object({ id: z.string().uuid() });

  async function usageFor(templateIds: string[] | null, viewer: SessionUser) {
    const rows = await db
      .select({
        templateId: collections.templateId,
        id: collections.id,
        name: collections.name,
        ownerId: collections.ownerId,
        visibility: collections.visibility,
        editAccess: collections.editAccess,
        ownerName: user.name,
      })
      .from(collections)
      .leftJoin(user, eq(user.id, collections.ownerId))
      .orderBy(asc(collections.name));
    const map = new Map<string, TemplateDto['usage']>();
    for (const r of rows) {
      if (templateIds && !templateIds.includes(r.templateId)) continue;
      if (!canView(viewer, r)) continue;
      const list = map.get(r.templateId) ?? [];
      list.push({ id: r.id, name: r.name, ownerName: r.ownerName ?? '' });
      map.set(r.templateId, list);
    }
    return map;
  }

  function toDto(t: TemplateRow, usage: TemplateDto['usage'], viewer: SessionUser): TemplateDto {
    return {
      ...templateData(t),
      id: t.id,
      createdBy: t.createdBy,
      version: t.version,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      usage,
      canEdit: canEditTemplate(viewer, t),
    };
  }

  async function load(id: string) {
    const [t] = await db.select().from(templates).where(eq(templates.id, id));
    if (!t) throw notFound('Template');
    return t;
  }

  app.get('/api/templates', { schema: { tags: ['templates'] } }, async (req) => {
    const viewer = mustUser(req);
    const rows = await db.select().from(templates).orderBy(asc(templates.name));
    const usage = await usageFor(null, viewer);
    return rows.map((t) => toDto(t, usage.get(t.id) ?? [], viewer));
  });

  app.get('/api/templates/:id', { schema: { tags: ['templates'], params: idParams } }, async (req) => {
    const viewer = mustUser(req);
    const t = await load(req.params.id);
    const usage = await usageFor([t.id], viewer);
    return toDto(t, usage.get(t.id) ?? [], viewer);
  });

  async function assertBindings(body: { bindings: TemplateRow['bindings'] }) {
    const issues = await bindingIssues(db, body.bindings);
    if (issues.length) throw badRequest(issues[0]?.message as string, issues);
  }

  app.post('/api/templates', { schema: { tags: ['templates'], body: templateInputSchema } }, async (req, reply) => {
    const viewer = mustUser(req);
    await assertBindings(req.body);
    const [t] = await db
      .insert(templates)
      .values({ ...req.body, createdBy: viewer.id })
      .returning();
    return reply.code(201).send(toDto(t as TemplateRow, [], viewer));
  });

  app.put(
    '/api/templates/:id',
    { schema: { tags: ['templates'], params: idParams, body: templateInputSchema } },
    async (req) => {
      const viewer = mustUser(req);
      const before = await load(req.params.id);
      if (!canEditTemplate(viewer, before)) {
        throw forbidden('Only the person who made this template or an admin can change it. Duplicate it instead.');
      }
      const problems = diffTemplateFields(before.fields, req.body.fields);
      if (problems.length) {
        throw badRequest(
          problems[0] as string,
          problems.map((message) => ({ path: 'fields', message })),
        );
      }
      await assertBindings(req.body);
      const [t] = await db
        .update(templates)
        .set({ ...req.body, version: before.version + 1 })
        .where(eq(templates.id, before.id))
        .returning();
      // Labels and hidden flags feed search, so refresh the search text of affected items.
      const using = await db
        .select({ id: collections.id, prefix: collections.accessionPrefix })
        .from(collections)
        .where(eq(collections.templateId, before.id));
      await reindexCollections(db, using, req.body.fields);
      const usage = await usageFor([before.id], viewer);
      return toDto(t as TemplateRow, usage.get(before.id) ?? [], viewer);
    },
  );

  app.delete('/api/templates/:id', { schema: { tags: ['templates'], params: idParams } }, async (req, reply) => {
    const viewer = mustUser(req);
    const t = await load(req.params.id);
    if (!canEditTemplate(viewer, t))
      throw forbidden('Only the person who made this template or an admin can delete it.');
    const [used] = await db.select({ n: count() }).from(collections).where(eq(collections.templateId, t.id));
    if ((used?.n ?? 0) > 0) {
      throw new HttpError(
        409,
        'in_use',
        `${used?.n} collection(s) use this template. Delete them or switch them first.`,
      );
    }
    await db.delete(templates).where(eq(templates.id, t.id));
    return reply.code(204).send();
  });
};
