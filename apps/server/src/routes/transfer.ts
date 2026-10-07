import {
  buildItemSchema,
  csvValue,
  formatAccession,
  type ImportResult,
  importInputSchema,
  toCsv,
} from '@precious/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { mustUser } from '../auth/guard.ts';
import type { AppContext } from '../context.ts';
import { collections, items, user } from '../db/schema.ts';
import { badRequest } from '../errors.ts';
import { assertCanEditItems, loadCollection, templateData } from '../services/collections.ts';
import { applyFormulas, syncComputed } from '../services/computed.ts';
import { buildSearchText, writeMeta } from '../services/items.ts';

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'collection';

/** Collections out as CSV or JSON, and CSV rows in as new items. */
export const transferRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;
  const idParams = z.object({ id: z.string().uuid() });

  app.get(
    '/api/collections/:id/export',
    {
      schema: {
        tags: ['transfer'],
        params: idParams,
        querystring: z.object({ format: z.enum(['csv', 'json']).default('csv') }),
      },
    },
    async (req, reply) => {
      const viewer = mustUser(req);
      const { collection, template } = await loadCollection(db, req.params.id, viewer);
      const rows = await db
        .select()
        .from(items)
        .where(eq(items.collectionId, collection.id))
        .orderBy(asc(items.accessionNo));
      const name = slug(collection.name);

      if (req.query.format === 'json') {
        const t = templateData(template);
        return reply
          .header('content-type', 'application/json; charset=utf-8')
          .header('content-disposition', `attachment; filename="${name}.precious.json"`)
          .send({
            format: 'precious-collection',
            version: 1,
            exportedAt: new Date().toISOString(),
            collection: {
              name: collection.name,
              accent: collection.accent,
              icon: collection.icon,
              accessionPrefix: collection.accessionPrefix,
              defaultView: collection.defaultView,
            },
            template: t,
            items: rows.map((r) => ({
              accession: formatAccession(collection.accessionPrefix, r.accessionNo),
              title: r.title,
              data: r.data,
              externalRefs: r.externalRefs,
              fieldMeta: r.fieldMeta,
              coverImageId: r.coverImageId,
              createdAt: r.createdAt.toISOString(),
              updatedAt: r.updatedAt.toISOString(),
            })),
          });
      }

      const people = new Map((await db.select({ id: user.id, name: user.name }).from(user)).map((u) => [u.id, u.name]));
      const fields = template.fields.filter((f) => !f.hidden);
      const csv = toCsv([
        ['Accession number', 'Title', ...fields.map((f) => f.label)],
        ...rows.map((r) => [
          formatAccession(collection.accessionPrefix, r.accessionNo),
          r.title,
          ...fields.map((f) => csvValue(f, r.data[f.id], (id) => people.get(id))),
        ]),
      ]);
      // The byte-order mark makes Excel read accents correctly.
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${name}.csv"`)
        .send(`﻿${csv}\r\n`);
    },
  );

  app.post(
    '/api/collections/:id/import',
    { schema: { tags: ['transfer'], params: idParams, body: importInputSchema }, bodyLimit: 20 * 1024 * 1024 },
    async (req, reply): Promise<ImportResult> => {
      const viewer = mustUser(req);
      const { collection, template } = await loadCollection(db, req.params.id, viewer);
      assertCanEditItems(viewer, collection);
      const schema = buildItemSchema(template.fields);

      // Every row is checked before anything is saved: an import adds all its rows or none.
      const problems: { path: string; message: string }[] = [];
      const parsed = req.body.rows.map((row) => {
        const r = schema.safeParse(row.data);
        if (!r.success) {
          for (const i of r.error.issues.slice(0, 3)) {
            const label = template.fields.find((f) => f.id === i.path[0])?.label ?? String(i.path[0]);
            problems.push({ path: `line ${row.line}`, message: `Line ${row.line}, ${label}: ${i.message}` });
          }
          return null;
        }
        return { title: row.title, data: r.data };
      });
      if (problems.length) {
        throw badRequest(
          `${problems.length} value${problems.length === 1 ? '' : 's'} can't be imported. Nothing was saved.`,
          problems.slice(0, 50),
        );
      }

      const source = { name: 'CSV import', step: 'import' };
      const prepared: ({ title: string } & Awaited<ReturnType<typeof applyFormulas>>)[] = [];
      for (const row of parsed) {
        if (!row) continue;
        const keys = Object.keys(row.data);
        const meta = writeMeta({}, keys, {
          userId: viewer.id,
          lock: false,
          sources: Object.fromEntries(keys.map((k) => [k, source])),
        });
        prepared.push({ title: row.title, ...(await applyFormulas(template, row.title, row.data, meta)) });
      }

      const created = await db.transaction(async (tx) => {
        // Reserves a block of accession numbers at once; the row lock keeps them consecutive.
        const [counter] = await tx
          .update(collections)
          .set({
            accessionNext: sql`${collections.accessionNext} + ${prepared.length}`,
            updatedAt: sql`${collections.updatedAt}`,
          })
          .where(eq(collections.id, collection.id))
          .returning({ next: collections.accessionNext });
        const first = (counter?.next ?? prepared.length + 1) - prepared.length;
        const values = prepared.map((p, i) => {
          const accession = formatAccession(collection.accessionPrefix, first + i);
          return {
            collectionId: collection.id,
            accessionNo: first + i,
            title: p.title,
            data: p.data,
            fieldMeta: p.meta,
            searchText: buildSearchText({ title: p.title, accession, data: p.data }, template.fields),
            createdBy: viewer.id,
            updatedBy: viewer.id,
          };
        });
        const ids: string[] = [];
        for (let i = 0; i < values.length; i += 500) {
          const inserted = await tx
            .insert(items)
            .values(values.slice(i, i + 500))
            .returning({ id: items.id });
          ids.push(...inserted.map((r) => r.id));
        }
        return { ids, first };
      });

      // Values kept up to date are looked up for the new items too.
      await syncComputed(db, template.id, { itemIds: created.ids });
      ctx.scheduler.poke();
      reply.code(201);
      return {
        created: created.ids.length,
        firstAccession: formatAccession(collection.accessionPrefix, created.first),
        lastAccession: formatAccession(collection.accessionPrefix, created.first + created.ids.length - 1),
      };
    },
  );
};
