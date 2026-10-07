import {
  buildItemSchema,
  formatAccession,
  type ItemListResponse,
  itemInputSchema,
  itemListQuerySchema,
  itemUpdateSchema,
  searchEntries,
} from '@precious/shared';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canView } from '../auth/access.ts';
import { mustUser } from '../auth/guard.ts';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/client.ts';
import { collections, images, items } from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import { assertCanEditItems, loadCollection } from '../services/collections.ts';
import {
  buildSearchText,
  fieldExpr,
  filterConditions,
  type ItemRow,
  itemDto,
  selectItems,
  touchMeta,
} from '../services/items.ts';
import { findMatch, normalize } from '../services/text.ts';

/** Fuzzy + substring search condition over an item's search text. */
export function searchCondition(q: string) {
  const n = normalize(q.trim());
  const like = `%${n.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`(${items.searchText} ilike ${like} or word_similarity(${n}, ${items.searchText}) >= 0.45)`;
}

export function searchRank(q: string) {
  const n = normalize(q.trim());
  return sql`word_similarity(${n}, ${items.searchText})`;
}

function validationError(error: z.ZodError) {
  return badRequest(
    'Some values are not valid.',
    error.issues.map((i) => ({ path: ['data', ...i.path].join('.'), message: i.message })),
  );
}

async function assertImage(db: Db, id: string | null | undefined) {
  if (!id) return;
  const [img] = await db.select({ id: images.id }).from(images).where(eq(images.id, id));
  if (!img) throw badRequest('That cover image was not found. Upload it again.');
}

export const itemRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;
  const collectionParams = z.object({ id: z.string().uuid() });
  const itemParams = z.object({ id: z.string().uuid() });

  app.get(
    '/api/collections/:id/items',
    { schema: { tags: ['items'], params: collectionParams, querystring: itemListQuerySchema } },
    async (req): Promise<ItemListResponse> => {
      const viewer = mustUser(req);
      const { collection, template } = await loadCollection(db, req.params.id, viewer);
      const { q, sort, dir, filter, limit, offset } = req.query;
      const fields = template.fields;

      const conds = [eq(items.collectionId, collection.id)];
      conds.push(...filterConditions(filter === undefined ? [] : Array.isArray(filter) ? filter : [filter], fields));
      if (q) conds.push(searchCondition(q));
      const where = and(...conds);

      const direction = dir === 'asc' ? asc : desc;
      const sortField = fields.find((f) => f.id === sort);
      const orderBy = q
        ? [desc(searchRank(q)), asc(items.title)]
        : sort === '$title'
          ? [direction(sql`lower(${items.title})`)]
          : sort === '$accession'
            ? [direction(items.accessionNo)]
            : sortField
              ? [sql`${fieldExpr(sortField)} ${sql.raw(dir === 'asc' ? 'asc' : 'desc')} nulls last`, asc(items.title)]
              : [direction(items.createdAt)];

      const [rows, totals] = await Promise.all([
        selectItems(db)
          .where(where)
          .orderBy(...orderBy, asc(items.id))
          .limit(limit)
          .offset(offset),
        db.select({ n: count() }).from(items).where(where),
      ]);

      return {
        total: totals[0]?.n ?? 0,
        items: rows.map((r) => {
          const dto = itemDto(r.item, collection.accessionPrefix, r.cover, r.createdByName);
          if (!q) return dto;
          const match = findMatch(q, searchEntries(dto, fields));
          return match ? { ...dto, match } : dto;
        }),
      };
    },
  );

  app.post(
    '/api/collections/:id/items',
    { schema: { tags: ['items'], params: collectionParams, body: itemInputSchema } },
    async (req, reply) => {
      const viewer = mustUser(req);
      const { collection, template } = await loadCollection(db, req.params.id, viewer);
      assertCanEditItems(viewer, collection);
      const parsed = buildItemSchema(template.fields).safeParse(req.body.data);
      if (!parsed.success) throw validationError(parsed.error);
      const data = parsed.data;
      await assertImage(db, req.body.coverImageId);

      const created = await db.transaction(async (tx) => {
        // Taking the next number locks the collection row, so numbers never repeat.
        const [counter] = await tx
          .update(collections)
          .set({ accessionNext: sql`${collections.accessionNext} + 1`, updatedAt: sql`${collections.updatedAt}` })
          .where(eq(collections.id, collection.id))
          .returning({ next: collections.accessionNext });
        const accessionNo = (counter?.next ?? 1) - 1;
        const accession = formatAccession(collection.accessionPrefix, accessionNo);
        const [row] = await tx
          .insert(items)
          .values({
            collectionId: collection.id,
            accessionNo,
            title: req.body.title,
            coverImageId: req.body.coverImageId ?? null,
            data,
            fieldMeta: touchMeta({}, Object.keys(data), viewer.id, false),
            searchText: buildSearchText({ title: req.body.title, accession, data }, template.fields),
            createdBy: viewer.id,
            updatedBy: viewer.id,
          })
          .returning();
        return row as ItemRow;
      });
      const [full] = await selectItems(db).where(eq(items.id, created.id));
      if (!full) throw notFound('Item');
      return reply.code(201).send(itemDto(full.item, collection.accessionPrefix, full.cover, full.createdByName));
    },
  );

  // Newest items across every collection the viewer can see (home page).
  app.get(
    '/api/items/recent',
    {
      schema: { tags: ['items'], querystring: z.object({ limit: z.coerce.number().int().min(1).max(48).default(12) }) },
    },
    async (req) => {
      const viewer = mustUser(req);
      const all = await db
        .select({
          id: collections.id,
          prefix: collections.accessionPrefix,
          name: collections.name,
          accent: collections.accent,
          ownerId: collections.ownerId,
          visibility: collections.visibility,
          editAccess: collections.editAccess,
        })
        .from(collections);
      const visible = all.filter((c) => canView(viewer, c));
      if (visible.length === 0) return [];
      const byId = new Map(visible.map((c) => [c.id, c]));
      const rows = await selectItems(db)
        .where(inArray(items.collectionId, [...byId.keys()]))
        .orderBy(desc(items.createdAt))
        .limit(req.query.limit);
      return rows.map((r) => {
        const c = byId.get(r.item.collectionId) as (typeof visible)[number];
        return {
          ...itemDto(r.item, c.prefix, r.cover, r.createdByName),
          collection: { id: c.id, name: c.name, accent: c.accent },
        };
      });
    },
  );

  async function loadItem(id: string, viewer: ReturnType<typeof mustUser>) {
    const [row] = await selectItems(db).where(eq(items.id, id));
    if (!row) throw notFound('Item');
    const c = await loadCollection(db, row.item.collectionId, viewer);
    return { ...row, ...c };
  }

  app.get('/api/items/:id', { schema: { tags: ['items'], params: itemParams } }, async (req) => {
    const viewer = mustUser(req);
    const row = await loadItem(req.params.id, viewer);
    return itemDto(row.item, row.collection.accessionPrefix, row.cover, row.createdByName);
  });

  app.patch(
    '/api/items/:id',
    { schema: { tags: ['items'], params: itemParams, body: itemUpdateSchema } },
    async (req) => {
      const viewer = mustUser(req);
      const row = await loadItem(req.params.id, viewer);
      assertCanEditItems(viewer, row.collection);
      const fields = row.template.fields;

      let data = row.item.data;
      let changed: string[] = [];
      if (req.body.data) {
        const incoming = req.body.data;
        const parsed = buildItemSchema(fields, { partial: true }).safeParse(incoming);
        if (!parsed.success) throw validationError(parsed.error);
        // Keys sent empty are cleared; values of hidden fields are kept untouched.
        const cleared = Object.entries(incoming)
          .filter(
            ([k, v]) =>
              fields.some((f) => f.id === k && !f.hidden) &&
              (v === null || v === '' || (Array.isArray(v) && v.length === 0)),
          )
          .map(([k]) => k);
        data = { ...row.item.data, ...parsed.data };
        for (const k of cleared) delete data[k];
        changed = [...Object.keys(parsed.data), ...cleared].filter(
          (k) => JSON.stringify(row.item.data[k]) !== JSON.stringify(data[k]),
        );
      }
      if (req.body.coverImageId !== undefined) await assertImage(db, req.body.coverImageId);
      const title = req.body.title ?? row.item.title;
      const accession = formatAccession(row.collection.accessionPrefix, row.item.accessionNo);
      await db
        .update(items)
        .set({
          title,
          data,
          ...(req.body.coverImageId !== undefined && { coverImageId: req.body.coverImageId }),
          fieldMeta: touchMeta(row.item.fieldMeta, changed, viewer.id, true),
          searchText: buildSearchText({ title, accession, data }, fields),
          updatedBy: viewer.id,
        })
        .where(eq(items.id, row.item.id));
      const [full] = await selectItems(db).where(eq(items.id, row.item.id));
      if (!full) throw notFound('Item');
      return itemDto(full.item, row.collection.accessionPrefix, full.cover, full.createdByName);
    },
  );

  app.delete('/api/items/:id', { schema: { tags: ['items'], params: itemParams } }, async (req, reply) => {
    const viewer = mustUser(req);
    const row = await loadItem(req.params.id, viewer);
    assertCanEditItems(viewer, row.collection);
    await db.delete(items).where(eq(items.id, row.item.id));
    return reply.code(204).send();
  });
};
