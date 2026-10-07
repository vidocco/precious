import type { SessionUser } from './auth.ts';

/** The collection fields access decisions depend on. */
export interface CollectionAccess {
  ownerId: string;
  visibility: 'private' | 'household' | 'public';
  editAccess: 'owner' | 'household';
}

/**
 * Who can see a collection: its owner and admins always; everyone signed in when it is
 * shared with the household or public. Anonymous visitors only reach public collections
 * through their public link, which has its own read-only route.
 */
export function canView(user: SessionUser | null, c: CollectionAccess): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.id === c.ownerId) return true;
  return c.visibility !== 'private';
}

/** Who can add, edit and delete items: the owner, admins, and household members when allowed. */
export function canEditItems(user: SessionUser | null, c: CollectionAccess): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.id === c.ownerId) return true;
  return c.editAccess === 'household' && c.visibility !== 'private';
}

/** Who can change the collection itself (name, colour, sharing) or delete it. */
export function canManageCollection(user: SessionUser | null, c: Pick<CollectionAccess, 'ownerId'>): boolean {
  return !!user && (user.role === 'admin' || user.id === c.ownerId);
}

/** Templates can be edited by their creator and admins; unowned starter templates by admins. */
export function canEditTemplate(user: SessionUser | null, t: { createdBy: string | null }): boolean {
  if (!user) return false;
  return user.role === 'admin' || (t.createdBy !== null && t.createdBy === user.id);
}
