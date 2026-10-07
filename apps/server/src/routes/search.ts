import { type SearchGroup, type SearchResponse, searchEntries } from '@precious/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canView } from '../auth/access.ts';
import { mustUser } from '../auth/guard.ts';
import type { AppContext } from '../context.ts';
import { collections, images, items, templates, user } from '../db/schema.ts';
import { itemDto } from '../services/items.ts';
import { findMatch } from '../services/text.ts';
import { searchCondition, searchRank } from './items.ts';

const PER_GROUP = 4;

export const searchRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;

  app.get(
    '/api/search',
    { schema: { tags: ['search'], querystring: z.object({ q: z.string().trim().min(1).max(200) }) } },
    async (req): Promise<SearchResponse> => {
      const viewer = mustUser(req);
      const { q } = req.query;
      const visible = (
        await db
          .select({ c: collections, fields: templates.fields })
          .from(collections)
          .innerJoin(templates, eq(templates.id, collections.templateId))
      ).filter((r) => canView(viewer, r.c));
      if (visible.length === 0) return { q, total: 0, groups: [] };
      const byId = new Map(visible.map((r) => [r.c.id, r]));

      // Rank every match, then keep the best few per collection.
      const ranked = db
        .select({
          id: items.id,
          rank: sql<number>`row_number() over (partition by ${items.collectionId} order by ${searchRank(q)} desc, ${items.title})`.as(
            'rank',
          ),
          total: sql<number>`count(*) over (partition by ${items.collectionId})`.as('total'),
          score: sql<number>`max(${searchRank(q)}) over (partition by ${items.collectionId})`.as('score'),
        })
        .from(items)
        .where(and(inArray(items.collectionId, [...byId.keys()]), searchCondition(q)))
        .as('ranked');

      const rows = await db
        .select({ item: items, cover: images, createdByName: user.name, total: ranked.total, score: ranked.score })
        .from(ranked)
        .innerJoin(items, eq(items.id, ranked.id))
        .leftJoin(images, eq(images.id, items.coverImageId))
        .leftJoin(user, eq(user.id, items.createdBy))
        .where(sql`${ranked.rank} <= ${PER_GROUP}`)
        .orderBy(desc(ranked.score), ranked.rank);

      const groups = new Map<string, SearchGroup>();
      for (const r of rows) {
        const col = byId.get(r.item.collectionId);
        if (!col) continue;
        let group = groups.get(col.c.id);
        if (!group) {
          group = {
            collection: { id: col.c.id, name: col.c.name, accent: col.c.accent as SearchGroup['collection']['accent'] },
            total: Number(r.total),
            hits: [],
          };
          groups.set(col.c.id, group);
        }
        const dto = itemDto(r.item, col.c.accessionPrefix, r.cover, r.createdByName);
        const match = findMatch(q, searchEntries(dto, col.fields)) ?? { label: 'Title', snippet: dto.title };
        group.hits.push({ item: dto, match });
      }
      const list = [...groups.values()];
      return { q, total: list.reduce((n, g) => n + g.total, 0), groups: list };
    },
  );
};
