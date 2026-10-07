import type { FillResult, SourceHit } from '@precious/shared';

/**
 * Items found through a data source, waiting on the review screen. Kept in memory only:
 * reloading the review page falls back to the empty form.
 */
export interface Draft {
  collectionId: string;
  provider: string;
  query: string;
  result: SourceHit;
  fill: FillResult;
}

const drafts = new Map<string, Draft>();

export function saveDraft(d: Draft): string {
  const id = Math.random().toString(36).slice(2, 10);
  drafts.set(id, d);
  // Only the latest few are worth keeping.
  if (drafts.size > 10) drafts.delete(drafts.keys().next().value as string);
  return id;
}

export const getDraft = (id: string | undefined) => (id ? drafts.get(id) : undefined);
