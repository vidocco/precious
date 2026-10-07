import {
  type FillResult,
  lookupFillSchema,
  lookupSearchSchema,
  type RefreshResult,
  refreshInputSchema,
  remoteImageSchema,
  type TryBindingsResult,
  templateInputSchema,
  tryBindingsSchema,
} from '@precious/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { mustUser } from '../auth/guard.ts';
import type { AppContext } from '../context.ts';
import { items } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import { assertCanEditItems, loadCollection } from '../services/collections.ts';
import { selectItems } from '../services/items.ts';
import { bindingIssues, loadBound, runPipeline, searchWith, verifyCover, verifyHit } from '../services/pipeline.ts';
import { importRemoteImage } from '../services/remoteImages.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Search-to-add: searching a template's sources, filling in a picked result, refreshing an item. */
export const lookupRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;
  const rt = ctx.connectors;
  const idParams = z.object({ id: z.string().uuid() });

  async function editableCollection(id: string, viewer: ReturnType<typeof mustUser>) {
    const row = await loadCollection(db, id, viewer);
    assertCanEditItems(viewer, row.collection);
    return row;
  }

  app.post(
    '/api/collections/:id/lookup/search',
    { schema: { tags: ['lookup'], params: idParams, body: lookupSearchSchema } },
    async (req) => {
      const viewer = mustUser(req);
      const { template } = await editableCollection(req.params.id, viewer);
      const bound = await loadBound(db, template.bindings);
      return searchWith(rt, bound, template.bindings, req.body.provider, req.body.query);
    },
  );

  app.post(
    '/api/collections/:id/lookup/fill',
    { schema: { tags: ['lookup'], params: idParams, body: lookupFillSchema } },
    async (req): Promise<FillResult> => {
      const viewer = mustUser(req);
      const { template } = await editableCollection(req.params.id, viewer);
      const result = verifyHit(rt.appSecret, req.body.provider, req.body.result);
      const bound = await loadBound(db, template.bindings);
      return runPipeline(
        rt,
        bound,
        template,
        { kind: 'add', query: req.body.query, provider: req.body.provider, result },
        req.body.choices,
      );
    },
  );

  app.post(
    '/api/items/:id/refresh',
    { schema: { tags: ['lookup'], params: idParams, body: refreshInputSchema } },
    async (req): Promise<RefreshResult> => {
      const viewer = mustUser(req);
      const [row] = await selectItems(db).where(eq(items.id, req.params.id));
      if (!row) throw notFound('Item');
      const { template } = await editableCollection(row.item.collectionId, viewer);
      const item = row.item;
      if (template.bindings.steps.length === 0) throw badRequest('This template has no data sources to refresh from.');
      const bound = await loadBound(db, template.bindings);
      const fill = await runPipeline(
        rt,
        bound,
        template,
        { kind: 'refresh', title: item.title, data: item.data, refs: item.externalRefs },
        req.body.choices,
      );
      const out: RefreshResult = {
        changes: [],
        kept: [],
        refs: fill.refs,
        pending: fill.pending,
        warnings: fill.warnings,
        steps: fill.steps,
      };
      for (const [target, source] of Object.entries(fill.sources)) {
        if (target === '$cover') continue;
        const before = target === '$title' ? item.title : item.data[target];
        const after = target === '$title' ? fill.title : fill.data[target];
        if (after === undefined || same(before, after)) continue;
        if (item.fieldMeta[target]?.locked) out.kept.push({ target, value: before, offered: after });
        else out.changes.push({ target, before, after, source });
      }
      const coverSource = fill.sources.$cover;
      if (fill.cover && coverSource && item.fieldMeta.$cover?.url !== fill.cover.url) {
        if (item.fieldMeta.$cover?.locked) out.kept.push({ target: '$cover', value: null, offered: fill.cover.url });
        else out.cover = { ...fill.cover, source: coverSource };
      }
      return out;
    },
  );

  // Draft bindings from the template editor, run before they're saved.
  app.post('/api/templates/try', { schema: { tags: ['lookup'], body: tryBindingsSchema } }, async (req) => {
    mustUser(req);
    const { fields, bindings, query, provider, resultIndex, choices } = req.body;
    const parsed = templateInputSchema.safeParse({ name: 'Draft', fields, bindings });
    if (!parsed.success) {
      throw badRequest(
        'Some settings are not valid.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const issues = await bindingIssues(db, bindings);
    if (issues.length) throw badRequest('Some data sources are missing.', issues);
    const bound = await loadBound(db, bindings);
    const providerId = provider ?? bindings.search[0]?.id;
    const out: TryBindingsResult = { results: [] };
    if (!providerId) throw badRequest('Add a search first.');
    const found = await searchWith(rt, bound, bindings, providerId, query);
    out.results = found.results;
    if (found.error) out.error = found.error;
    const picked = found.results[Math.min(resultIndex, found.results.length - 1)];
    if (!picked) return out;
    out.picked = found.results.indexOf(picked);
    const { token: _, ...result } = picked;
    out.fill = await runPipeline(rt, bound, parsed.data, { kind: 'add', query, provider: providerId, result }, choices);
    return out;
  });

  app.post('/api/images/remote', { schema: { tags: ['images'], body: remoteImageSchema } }, async (req, reply) => {
    const viewer = mustUser(req);
    if (!verifyCover(rt.appSecret, req.body.url, req.body.token)) {
      throw new HttpError(403, 'forbidden', 'Only covers found by a data source can be downloaded.');
    }
    const img = await importRemoteImage(db, ctx.config.UPLOAD_DIR, req.body.url, viewer.id, rt.fetchImpl);
    return reply.code(201).send(img);
  });
};
