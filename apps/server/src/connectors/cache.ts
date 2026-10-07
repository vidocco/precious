import { createHash } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { httpCache } from '../db/schema.ts';
import type { IncomingResponse, OutgoingRequest } from './http.ts';

/**
 * Cache key for a request. Authorization is left out so a refreshed token doesn't
 * defeat the cache; the key is a hash, so secrets in URLs are never stored as text.
 */
export function cacheKey(req: OutgoingRequest): string {
  const headers = [...req.headers.entries()]
    .filter(([k]) => k.toLowerCase() !== 'authorization')
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256')
    .update(JSON.stringify([req.method, req.url.href, headers, req.body ?? '']))
    .digest('hex');
}

export async function readCache(db: Db, key: string): Promise<IncomingResponse | null> {
  const [row] = await db.select().from(httpCache).where(eq(httpCache.key, key));
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return { status: row.status, statusText: 'OK', contentType: row.contentType, text: row.body, url: '' };
}

export async function writeCache(db: Db, key: string, res: IncomingResponse, seconds: number) {
  const expiresAt = new Date(Date.now() + seconds * 1000);
  await db
    .insert(httpCache)
    .values({ key, status: res.status, contentType: res.contentType, body: res.text, expiresAt })
    .onConflictDoUpdate({
      target: httpCache.key,
      set: { status: res.status, contentType: res.contentType, body: res.text, expiresAt },
    });
}

export async function pruneCache(db: Db) {
  await db.delete(httpCache).where(lt(httpCache.expiresAt, new Date()));
}
