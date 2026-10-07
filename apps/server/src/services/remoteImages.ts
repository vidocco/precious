import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { and, eq, lt, notExists, sql } from 'drizzle-orm';
import type { FetchLike } from '../connectors/auth.ts';
import { DEFAULT_USER_AGENT } from '../connectors/runner.ts';
import type { Db } from '../db/client.ts';
import { images, items } from '../db/schema.ts';
import { badRequest } from '../errors.ts';
import { imageDir, storeImage } from './images.ts';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

/** Downloads an image, following a few redirects, with a time limit and a size cap. */
export async function downloadImage(url: string, fetchImpl: FetchLike = fetch): Promise<Buffer> {
  let current = url;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; ; hop++) {
    if (!/^https?:\/\//i.test(current)) throw badRequest('Only http:// and https:// images can be downloaded.');
    let res: Response;
    try {
      res = await fetchImpl(current, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': DEFAULT_USER_AGENT, accept: 'image/avif,image/webp,image/*;q=0.9,*/*;q=0.5' },
      });
    } catch (err) {
      const timedOut = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
      throw badRequest(timedOut ? 'The cover took too long to download.' : "The cover couldn't be downloaded.");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw badRequest('The cover address redirects too many times.');
      current = new URL(res.headers.get('location') as string, current).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw badRequest(`The cover couldn't be downloaded (HTTP ${res.status}).`);
    }
    const type = res.headers.get('content-type') ?? '';
    if (type && !/^(image\/|application\/octet-stream|binary\/octet-stream)/i.test(type)) {
      await res.body?.cancel();
      throw badRequest('The cover address is not an image.');
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      await res.body?.cancel();
      throw badRequest('The cover is larger than 15 MB.');
    }
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw badRequest('The cover is larger than 15 MB.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
}

export interface StoredImage {
  id: string;
  width: number;
  height: number;
  color: string | null;
}

/** Recently downloaded covers, so picking another match doesn't download the same cover again. */
const recent = new Map<string, string>();
const RECENT_MAX = 200;

export async function importRemoteImage(
  db: Db,
  uploadDir: string,
  url: string,
  ownerId: string,
  fetchImpl: FetchLike = fetch,
): Promise<StoredImage> {
  const known = recent.get(url);
  if (known) {
    const [row] = await db.select().from(images).where(eq(images.id, known));
    if (row) return { id: row.id, width: row.width, height: row.height, color: row.color };
    recent.delete(url);
  }
  const buffer = await downloadImage(url, fetchImpl);
  const id = randomUUID();
  let stored: Awaited<ReturnType<typeof storeImage>>;
  try {
    stored = await storeImage(uploadDir, id, buffer);
  } catch {
    throw badRequest("The cover couldn't be read as an image.");
  }
  await db.insert(images).values({ id, ownerId, mime: 'image/webp', bytes: buffer.length, ...stored });
  recent.set(url, id);
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value as string);
  return { id, ...stored };
}

/**
 * Deletes images no item uses that are older than `olderThanHours`: covers replaced,
 * removed, or downloaded for an item that was never saved. Items are the only thing
 * that point at images.
 */
export async function pruneImages(db: Db, uploadDir: string, olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const unused = await db
    .select({ id: images.id })
    .from(images)
    .where(
      and(
        lt(images.createdAt, cutoff),
        notExists(db.select({ one: sql`1` }).from(items).where(eq(items.coverImageId, images.id))),
      ),
    );
  let removed = 0;
  for (const { id } of unused) {
    // Checked again on delete, in case an item picked the image up in the meantime.
    const gone = await db
      .delete(images)
      .where(
        and(eq(images.id, id), notExists(db.select({ one: sql`1` }).from(items).where(eq(items.coverImageId, id)))),
      )
      .returning({ id: images.id });
    if (gone.length === 0) continue;
    await rm(imageDir(uploadDir, id), { recursive: true, force: true });
    removed++;
  }
  return removed;
}
