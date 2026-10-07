import {
  type CollectionDto,
  DEFAULT_SHELF,
  EMPTY_BINDINGS,
  type FieldDefinition,
  type TemplateData,
} from '@precious/shared';
import { eq, sql } from 'drizzle-orm';
import { canEditItems, canManageCollection, canView } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.ts';
import type { Db } from '../db/client.ts';
import { collections, items, templates, user } from '../db/schema.ts';
import { forbidden, notFound } from '../errors.ts';

export type CollectionRow = typeof collections.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;

export const collectionColumns = {
  collection: collections,
  ownerName: user.name,
  itemCount: sql<number>`(select count(*)::int from ${items} where ${items.collectionId} = ${collections.id})`,
};

export function collectionDto(
  row: { collection: CollectionRow; ownerName: string | null; itemCount: number },
  viewer: SessionUser | null,
): CollectionDto {
  const c = row.collection;
  return {
    id: c.id,
    templateId: c.templateId,
    ownerId: c.ownerId,
    ownerName: row.ownerName ?? '',
    name: c.name,
    accent: c.accent as CollectionDto['accent'],
    icon: c.icon,
    accessionPrefix: c.accessionPrefix,
    defaultView: c.defaultView as CollectionDto['defaultView'],
    visibility: c.visibility,
    publicSlug: c.visibility === 'public' ? c.publicSlug : null,
    editAccess: c.editAccess,
    quickAdd: c.quickAdd,
    itemCount: Number(row.itemCount),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    canEdit: canEditItems(viewer, c),
    canDelete: canManageCollection(viewer, c),
  };
}

/** Loads a collection the viewer may see, with its template. Throws 404 otherwise. */
export async function loadCollection(db: Db, id: string, viewer: SessionUser | null) {
  const [row] = await db
    .select({ ...collectionColumns, template: templates })
    .from(collections)
    .innerJoin(templates, eq(templates.id, collections.templateId))
    .leftJoin(user, eq(user.id, collections.ownerId))
    .where(eq(collections.id, id));
  // A collection you can't see is reported as missing, so its existence doesn't leak.
  if (!row || !canView(viewer, row.collection)) throw notFound('Collection');
  return row;
}

export function assertCanEditItems(viewer: SessionUser | null, c: CollectionRow) {
  if (!canEditItems(viewer, c)) throw forbidden('You can look at this collection but not change it.');
}

export function assertCanManage(viewer: SessionUser | null, c: CollectionRow) {
  if (!canManageCollection(viewer, c)) throw forbidden('Only the owner or an admin can change this collection.');
}

export function templateData(t: TemplateRow): TemplateData {
  return {
    name: t.name,
    description: t.description,
    icon: t.icon,
    accessionPrefix: t.accessionPrefix,
    fields: t.fields,
    card: t.card,
    itemLayout: t.itemLayout,
    header: t.header,
    // Rows saved before a part of the bindings existed get it empty.
    bindings: { ...EMPTY_BINDINGS, ...t.bindings },
    shelf: t.shelf ?? DEFAULT_SHELF,
  };
}

export function visibleFields(fields: FieldDefinition[]) {
  return fields.filter((f) => !f.hidden);
}
