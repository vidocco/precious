import {
  type EndpointData,
  endpointInputSchema,
  recipeSchema,
  runRequestSchema,
  secretsUpdateSchema,
  sourceInputSchema,
} from '@precious/shared';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { mustAdmin, mustUser } from '../auth/guard.ts';
import { loadPresets, toRecipe } from '../connectors/recipes.ts';
import { runEndpoint } from '../connectors/runner.ts';
import { encryptSecret } from '../connectors/secrets.ts';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/client.ts';
import { dataSources, endpoints } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import { endpointData, endpointDto, loadSource, sourceDto, sourceUsage } from '../services/sources.ts';

function duplicateKeys(eps: { key: string }[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const e of eps) (seen.has(e.key) ? dupes : seen).add(e.key);
  return [...dupes];
}

async function createFromRecipe(db: Db, recipe: z.output<typeof recipeSchema>, createdBy: string) {
  const dupes = duplicateKeys(recipe.endpoints);
  if (dupes.length) throw badRequest(`The recipe has more than one endpoint called "${dupes[0]}".`);
  return db.transaction(async (tx) => {
    const [source] = await tx
      .insert(dataSources)
      .values({ ...recipe.source, createdBy })
      .returning({ id: dataSources.id });
    const id = (source as { id: string }).id;
    if (recipe.endpoints.length) {
      await tx.insert(endpoints).values(recipe.endpoints.map((e) => ({ ...e, sourceId: id })));
    }
    return id;
  });
}

export const sourceRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;
  const idParams = z.object({ id: z.string().uuid() });

  // Everyone signed in can see which sources exist (never their secrets); only admins change or run them.
  app.get('/api/sources', { schema: { tags: ['sources'] } }, async (req) => {
    const viewer = mustUser(req);
    const [sources, eps, usage] = await Promise.all([
      db.select().from(dataSources).orderBy(asc(dataSources.name)),
      db.select().from(endpoints).orderBy(asc(endpoints.name)),
      sourceUsage(db),
    ]);
    return sources.map((s) =>
      sourceDto(
        s,
        eps.filter((e) => e.sourceId === s.id),
        viewer,
        usage.get(s.id),
      ),
    );
  });

  app.get('/api/sources/:id', { schema: { tags: ['sources'], params: idParams } }, async (req) => {
    const viewer = mustUser(req);
    const { source, endpoints: eps } = await loadSource(db, req.params.id);
    const usage = await sourceUsage(db);
    return sourceDto(source, eps, viewer, usage.get(source.id));
  });

  app.post('/api/sources', { schema: { tags: ['sources'], body: sourceInputSchema } }, async (req, reply) => {
    const admin = mustAdmin(req);
    const [row] = await db
      .insert(dataSources)
      .values({ ...req.body, createdBy: admin.id })
      .returning();
    return reply.code(201).send(sourceDto(row as typeof dataSources.$inferSelect, [], admin));
  });

  app.put(
    '/api/sources/:id',
    { schema: { tags: ['sources'], params: idParams, body: sourceInputSchema } },
    async (req) => {
      const admin = mustAdmin(req);
      await loadSource(db, req.params.id);
      await db
        .update(dataSources)
        .set({ ...req.body, userAgent: req.body.userAgent ?? null })
        .where(eq(dataSources.id, req.params.id));
      const { source, endpoints: eps } = await loadSource(db, req.params.id);
      return sourceDto(source, eps, admin);
    },
  );

  app.put(
    '/api/sources/:id/secrets',
    { schema: { tags: ['sources'], params: idParams, body: secretsUpdateSchema } },
    async (req) => {
      const admin = mustAdmin(req);
      const { source } = await loadSource(db, req.params.id);
      const next = { ...source.secrets };
      for (const [name, value] of Object.entries(req.body)) {
        if (value === null || value === '') delete next[name];
        else next[name] = encryptSecret(ctx.config.APP_SECRET, value);
      }
      await db.update(dataSources).set({ secrets: next }).where(eq(dataSources.id, source.id));
      const fresh = await loadSource(db, source.id);
      return sourceDto(fresh.source, fresh.endpoints, admin);
    },
  );

  app.delete('/api/sources/:id', { schema: { tags: ['sources'], params: idParams } }, async (req, reply) => {
    mustAdmin(req);
    await loadSource(db, req.params.id);
    await db.delete(dataSources).where(eq(dataSources.id, req.params.id));
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- endpoints

  async function assertKeyFree(sourceId: string, key: string, exceptId?: string) {
    const [clash] = await db
      .select({ id: endpoints.id })
      .from(endpoints)
      .where(
        and(
          eq(endpoints.sourceId, sourceId),
          eq(endpoints.key, key),
          exceptId ? ne(endpoints.id, exceptId) : undefined,
        ),
      );
    if (clash) throw new HttpError(409, 'key_taken', `This source already has an endpoint called "${key}".`);
  }

  app.post(
    '/api/sources/:id/endpoints',
    { schema: { tags: ['sources'], params: idParams, body: endpointInputSchema } },
    async (req, reply) => {
      mustAdmin(req);
      await loadSource(db, req.params.id);
      await assertKeyFree(req.params.id, req.body.key);
      const [row] = await db
        .insert(endpoints)
        .values({ ...req.body, sourceId: req.params.id })
        .returning();
      return reply.code(201).send(endpointDto(row as typeof endpoints.$inferSelect));
    },
  );

  async function loadEndpoint(id: string) {
    const [row] = await db.select().from(endpoints).where(eq(endpoints.id, id));
    if (!row) throw notFound('Endpoint');
    return row;
  }

  app.put(
    '/api/endpoints/:id',
    { schema: { tags: ['sources'], params: idParams, body: endpointInputSchema } },
    async (req) => {
      mustAdmin(req);
      const before = await loadEndpoint(req.params.id);
      await assertKeyFree(before.sourceId, req.body.key, before.id);
      const [row] = await db.update(endpoints).set(req.body).where(eq(endpoints.id, before.id)).returning();
      return endpointDto(row as typeof endpoints.$inferSelect);
    },
  );

  app.delete('/api/endpoints/:id', { schema: { tags: ['sources'], params: idParams } }, async (req, reply) => {
    mustAdmin(req);
    await loadEndpoint(req.params.id);
    await db.delete(endpoints).where(eq(endpoints.id, req.params.id));
    return reply.code(204).send();
  });

  // Runs an endpoint as currently edited, saved or not, so the console can test changes.
  app.post(
    '/api/sources/:id/run',
    { schema: { tags: ['sources'], params: idParams, body: runRequestSchema } },
    async (req) => {
      mustAdmin(req);
      const { source } = await loadSource(db, req.params.id);
      const forRun = { ...source, userAgent: source.userAgent ?? undefined };
      return runEndpoint(ctx.connectors, forRun, req.body.endpoint as EndpointData, req.body.input, {
        useCache: req.body.useCache,
      });
    },
  );

  // ---------------------------------------------------------------- recipes

  app.get('/api/sources/:id/export', { schema: { tags: ['sources'], params: idParams } }, async (req, reply) => {
    mustAdmin(req);
    const { source, endpoints: eps } = await loadSource(db, req.params.id);
    const slug =
      source.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'source';
    return reply
      .header('content-disposition', `attachment; filename="${slug}.precious.json"`)
      .send(toRecipe(source, eps.map(endpointData)));
  });

  app.post('/api/sources/import', { schema: { tags: ['sources'], body: recipeSchema } }, async (req, reply) => {
    const admin = mustAdmin(req);
    const id = await createFromRecipe(db, req.body, admin.id);
    const { source, endpoints: eps } = await loadSource(db, id);
    return reply.code(201).send({ source: sourceDto(source, eps, admin), missingSecrets: req.body.secretNames });
  });

  app.get('/api/recipes/presets', { schema: { tags: ['sources'] } }, async (req) => {
    mustUser(req);
    return (await loadPresets(ctx.config.RECIPES_DIR)).map(({ recipe: _r, ...dto }) => dto);
  });

  app.post(
    '/api/recipes/presets/:key/install',
    { schema: { tags: ['sources'], params: z.object({ key: z.string().regex(/^[a-z0-9-]+$/) }) } },
    async (req, reply) => {
      const admin = mustAdmin(req);
      const preset = (await loadPresets(ctx.config.RECIPES_DIR)).find((p) => p.key === req.params.key);
      if (!preset) throw notFound('Preset');
      const id = await createFromRecipe(db, preset.recipe, admin.id);
      const { source, endpoints: eps } = await loadSource(db, id);
      return reply.code(201).send({ source: sourceDto(source, eps, admin), missingSecrets: preset.secretNames });
    },
  );
};
