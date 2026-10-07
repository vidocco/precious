import {
  type FieldDefinition,
  type FieldMeta,
  type FigureValue,
  formatAccession,
  type HeaderLayout,
  type ItemDto,
  isNumericType,
  searchEntries,
} from '@precious/shared';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { images, items, user } from '../db/schema.ts';
import { normalize } from './text.ts';

export type ItemRow = typeof items.$inferSelect;
type ImageRow = typeof images.$inferSelect;

export function buildSearchText(
  item: { title: string; accession: string; data: Record<string, unknown> },
  fields: FieldDefinition[],
): string {
  return normalize(
    searchEntries({ ...item, createdAt: '' }, fields)
      .map((e) => e.text)
      .join('\n'),
  );
}

export function itemDto(row: ItemRow, prefix: string, cover: ImageRow | null, createdByName: string | null): ItemDto {
  return {
    id: row.id,
    collectionId: row.collectionId,
    accessionNo: row.accessionNo,
    accession: formatAccession(prefix, row.accessionNo),
    title: row.title,
    cover: cover ? { id: cover.id, width: cover.width, height: cover.height, color: cover.color } : null,
    data: row.data,
    fieldMeta: row.fieldMeta,
    createdBy: row.createdBy,
    createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Item rows joined with their cover image and creator name. */
export function selectItems(db: Db) {
  return db
    .select({ item: items, cover: images, createdByName: user.name })
    .from(items)
    .leftJoin(images, eq(images.id, items.coverImageId))
    .leftJoin(user, eq(user.id, items.createdBy));
}

/** Marks the fields a person changed by hand, so a later refresh from a data source leaves them alone. */
export function touchMeta(
  meta: Record<string, FieldMeta>,
  changed: string[],
  userId: string,
  lock: boolean,
): Record<string, FieldMeta> {
  const at = new Date().toISOString();
  const next = { ...meta };
  for (const id of changed) next[id] = { source: 'user', by: userId, at, ...(lock && { locked: true }) };
  return next;
}

/** A JSONB value as SQL, typed for sorting/filtering by the field's type. */
export function fieldExpr(field: FieldDefinition): SQL {
  const path = sql`${items.data}->>${field.id}`;
  if (isNumericType(field.type)) {
    return sql`case when jsonb_typeof(${items.data}->${field.id}) = 'number' then (${path})::numeric end`;
  }
  if (field.type === 'boolean') return sql`(${path})::boolean`;
  return sql`lower(${path})`;
}

/** Turns `fieldId:value` filters into SQL conditions; unknown fields are ignored. */
export function filterConditions(filters: string[], fields: FieldDefinition[]): SQL[] {
  const out: SQL[] = [];
  for (const f of filters) {
    const sep = f.indexOf(':');
    if (sep < 1) continue;
    const id = f.slice(0, sep);
    const value = f.slice(sep + 1);
    const field = fields.find((x) => x.id === id);
    if (!field) continue;
    if (field.type === 'multichoice' || field.type === 'tags') {
      out.push(sql`${items.data} @> ${JSON.stringify({ [id]: [value] })}::jsonb`);
    } else if (field.type === 'boolean') {
      out.push(
        value === 'true'
          ? sql`${items.data}->${id} = 'true'::jsonb`
          : sql`coalesce(${items.data}->>${id}, 'false') = 'false'`,
      );
    } else if (isNumericType(field.type)) {
      const n = Number(value);
      if (Number.isFinite(n)) out.push(sql`${items.data}->${id} = ${JSON.stringify(n)}::jsonb`);
    } else {
      out.push(sql`${items.data}->>${id} = ${value}`);
    }
  }
  return out;
}

/** Computes the template's header figures for one collection in a single query. */
export async function computeFigures(
  db: Db,
  collectionId: string,
  header: HeaderLayout,
  fields: FieldDefinition[],
): Promise<FigureValue[]> {
  if (header.figures.length === 0) return [];
  const parts: SQL[] = [];
  const shapes: Omit<FigureValue, 'value'>[] = [];
  for (const [i, fig] of header.figures.entries()) {
    const alias = sql.raw(`f${i}`);
    if (fig.kind === 'count') {
      parts.push(sql`count(*) as ${alias}`);
      shapes.push({ id: fig.id, label: fig.label, format: 'count' });
      continue;
    }
    const field = fields.find((f) => f.id === fig.field);
    if (!field) {
      parts.push(sql`null as ${alias}`);
      shapes.push({ id: fig.id, label: fig.label, format: 'count' });
      continue;
    }
    if (fig.kind === 'countWhere') {
      let cond: SQL;
      if (typeof fig.equals === 'boolean') {
        cond = fig.equals
          ? sql`${items.data}->${field.id} = 'true'::jsonb`
          : sql`coalesce(${items.data}->>${field.id}, 'false') = 'false'`;
      } else if (field.type === 'multichoice' || field.type === 'tags') {
        cond = sql`${items.data} @> ${JSON.stringify({ [field.id]: [fig.equals] })}::jsonb`;
      } else {
        cond = sql`${items.data}->>${field.id} = ${fig.equals}`;
      }
      parts.push(sql`count(*) filter (where ${cond}) as ${alias}`);
      shapes.push({ id: fig.id, label: fig.label, format: 'count' });
      continue;
    }
    const fn = fig.kind === 'sum' ? sql`sum` : sql`avg`;
    parts.push(sql`${fn}(${fieldExpr(field)}) as ${alias}`);
    shapes.push({
      id: fig.id,
      label: fig.label,
      format: field.type === 'money' || field.type === 'duration' || field.type === 'rating' ? field.type : 'number',
      ...(field.options.currency && { currency: field.options.currency }),
      ...(field.options.unit && { unit: field.options.unit }),
    });
  }
  const rows = await db.execute<Record<string, string | number | null>>(
    sql`select ${sql.join(parts, sql`, `)} from ${items} where ${items.collectionId} = ${collectionId}`,
  );
  const row = rows[0] ?? {};
  return shapes.map((s, i) => {
    const raw = row[`f${i}`];
    return { ...s, value: raw === null || raw === undefined ? (s.format === 'count' ? 0 : null) : Number(raw) };
  });
}

/** Rebuilds search text for every item in the given collections (after a template's fields change). */
export async function reindexCollections(
  db: Db,
  collectionPrefixes: { id: string; prefix: string }[],
  fields: FieldDefinition[],
) {
  if (collectionPrefixes.length === 0) return;
  const prefixById = new Map(collectionPrefixes.map((c) => [c.id, c.prefix]));
  const rows = await db
    .select({
      id: items.id,
      collectionId: items.collectionId,
      accessionNo: items.accessionNo,
      title: items.title,
      data: items.data,
    })
    .from(items)
    .where(inArray(items.collectionId, [...prefixById.keys()]));
  for (const r of rows) {
    const accession = formatAccession(prefixById.get(r.collectionId) ?? '', r.accessionNo);
    await db
      .update(items)
      .set({
        searchText: buildSearchText({ title: r.title, accession, data: r.data }, fields),
        updatedAt: sql`${items.updatedAt}`,
      })
      .where(and(eq(items.id, r.id)));
  }
}
