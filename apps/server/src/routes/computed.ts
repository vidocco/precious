import {
  type ComputedStatus,
  type FormulaTryResult,
  formulaTrySchema,
  type HistoryPoint,
  type ItemHistoryPoint,
} from '@precious/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canEditTemplate } from '../auth/access.ts';
import { mustUser } from '../auth/guard.ts';
import { evaluate } from '../connectors/map.ts';
import type { AppContext } from '../context.ts';
import { collections, computedState, computedValues, items, templates } from '../db/schema.ts';
import { forbidden, notFound } from '../errors.ts';
import { assertCanEditItems, loadCollection } from '../services/collections.ts';
import { dueNow, updateValues } from '../services/computed.ts';
import { itemDto, selectItems } from '../services/items.ts';

/** Values kept up to date: their status, running them now, history and formula previews. */
export const computedRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;
  const idParams = z.object({ id: z.string().uuid() });
  const fieldParam = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);

  async function status(templateId: string): Promise<ComputedStatus[]> {
    const rows = await db.execute<{
      field: string;
      items: number;
      failing: number;
      waiting: number;
      last_run: string | null;
      next_run: string | null;
      last_error: string | null;
    }>(sql`
      select s.field,
        count(*)::int as items,
        (count(*) filter (where s.failures > 0))::int as failing,
        (count(*) filter (where s.last_run_at is null))::int as waiting,
        max(s.last_run_at) as last_run,
        min(s.next_run_at) as next_run,
        (array_agg(i.field_meta -> s.field ->> 'error' order by s.last_run_at desc nulls last)
          filter (where s.failures > 0))[1] as last_error
      from ${computedState} s
      join ${items} i on i.id = s.item_id
      join ${collections} c on c.id = i.collection_id
      where c.template_id = ${templateId}
      group by s.field`);
    const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
    return rows.map((r) => ({
      field: r.field,
      items: r.items,
      failing: r.failing,
      waiting: r.waiting,
      lastRunAt: iso(r.last_run),
      nextRunAt: iso(r.next_run),
      lastError: r.last_error,
    }));
  }

  async function loadTemplate(id: string) {
    const [t] = await db.select().from(templates).where(eq(templates.id, id));
    if (!t) throw notFound('Template');
    return t;
  }

  app.get('/api/templates/:id/computed', { schema: { tags: ['computed'], params: idParams } }, async (req) => {
    mustUser(req);
    const t = await loadTemplate(req.params.id);
    return status(t.id);
  });

  // Looks a scheduled field up again for every item of the template, now.
  app.post(
    '/api/templates/:id/computed/:field/run',
    { schema: { tags: ['computed'], params: idParams.extend({ field: fieldParam }) } },
    async (req) => {
      const viewer = mustUser(req);
      const t = await loadTemplate(req.params.id);
      if (!canEditTemplate(viewer, t))
        throw forbidden('Only the person who made this template or an admin can do this.');
      await dueNow(db, { templateId: t.id, field: req.params.field });
      ctx.scheduler.poke();
      return status(t.id);
    },
  );

  // Looks up an item's scheduled values now and returns the updated item.
  app.post('/api/items/:id/compute', { schema: { tags: ['computed'], params: idParams } }, async (req) => {
    const viewer = mustUser(req);
    const [row] = await selectItems(db).where(eq(items.id, req.params.id));
    if (!row) throw notFound('Item');
    const { collection } = await loadCollection(db, row.item.collectionId, viewer);
    assertCanEditItems(viewer, collection);
    const outcome = await updateValues({ db, rt: ctx.connectors }, row.item.id, 'all');
    const [full] = await selectItems(db).where(eq(items.id, row.item.id));
    if (!full) throw notFound('Item');
    return { item: itemDto(full.item, collection.accessionPrefix, full.cover, full.createdByName), ...outcome };
  });

  app.get(
    '/api/items/:id/history',
    { schema: { tags: ['computed'], params: idParams, querystring: z.object({ field: fieldParam }) } },
    async (req): Promise<ItemHistoryPoint[]> => {
      const viewer = mustUser(req);
      const [row] = await db
        .select({ collectionId: items.collectionId })
        .from(items)
        .where(eq(items.id, req.params.id));
      if (!row) throw notFound('Item');
      await loadCollection(db, row.collectionId, viewer);
      const rows = await db
        .select({ value: computedValues.value, at: computedValues.at })
        .from(computedValues)
        .where(and(eq(computedValues.itemId, req.params.id), eq(computedValues.field, req.query.field)))
        .orderBy(asc(computedValues.at))
        .limit(1000);
      return rows.map((r) => ({ value: r.value, at: r.at.toISOString() }));
    },
  );

  // The collection's total of a scheduled number field per day: each item counts with its latest value that day.
  app.get(
    '/api/collections/:id/history',
    {
      schema: {
        tags: ['computed'],
        params: idParams,
        querystring: z.object({ field: fieldParam, days: z.coerce.number().int().min(2).max(730).default(90) }),
      },
    },
    async (req): Promise<HistoryPoint[]> => {
      const viewer = mustUser(req);
      const { collection } = await loadCollection(db, req.params.id, viewer);
      const { field, days } = req.query;
      const rows = await db.execute<{ day: string; total: string | null; items: number }>(sql`
        select to_char(d, 'YYYY-MM-DD') as day, sum((v.value #>> '{}')::numeric) as total, count(v.item_id)::int as items
        from generate_series(date_trunc('day', now()) - ${days - 1} * interval '1 day', date_trunc('day', now()), interval '1 day') d
        left join lateral (
          select distinct on (cv.item_id) cv.item_id, cv.value
          from ${computedValues} cv join ${items} i on i.id = cv.item_id
          where i.collection_id = ${collection.id} and cv.field = ${field}
            and cv.at < d + interval '1 day' and jsonb_typeof(cv.value) = 'number'
          order by cv.item_id, cv.at desc
        ) v on true
        group by d order by d`);
      return rows.map((r) => ({ day: r.day, total: r.total === null ? 0 : Number(r.total), items: r.items }));
    },
  );

  // Previews a formula against example values, for the template editor.
  app.post('/api/formula/try', { schema: { tags: ['computed'], body: formulaTrySchema } }, async (req) => {
    mustUser(req);
    try {
      const value = await evaluate(req.body.formula, { title: req.body.title, ...req.body.data }, 'formula');
      return { value } satisfies FormulaTryResult;
    } catch (err) {
      return { error: (err as Error).message.replace(/^formula: /, '') } satisfies FormulaTryResult;
    }
  });
};
