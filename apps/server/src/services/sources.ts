import type { EndpointData, EndpointDto, SourceDto } from '@precious/shared';
import { asc, eq } from 'drizzle-orm';
import type { SessionUser } from '../auth/auth.ts';
import type { Db } from '../db/client.ts';
import { dataSources, endpoints } from '../db/schema.ts';
import { notFound } from '../errors.ts';

export type SourceRow = typeof dataSources.$inferSelect;
export type EndpointRow = typeof endpoints.$inferSelect;

export function endpointData(e: EndpointRow): EndpointData {
  return {
    key: e.key,
    name: e.name,
    role: e.role,
    kind: e.kind,
    method: e.method,
    path: e.path,
    query: e.query,
    headers: e.headers,
    body: e.body,
    graphql: e.graphql,
    format: e.format,
    extract: e.extract,
    map: e.map,
    cacheSeconds: e.cacheSeconds,
    sample: e.sample,
  };
}

export function endpointDto(e: EndpointRow): EndpointDto {
  return { ...endpointData(e), id: e.id, sourceId: e.sourceId, updatedAt: e.updatedAt.toISOString() };
}

/** Secret names only: values never leave the server. */
export function sourceDto(s: SourceRow, eps: EndpointRow[], viewer: SessionUser): SourceDto {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    baseUrl: s.baseUrl,
    auth: s.auth,
    headers: s.headers,
    rateLimit: s.rateLimit,
    cacheSeconds: s.cacheSeconds,
    ...(s.userAgent && { userAgent: s.userAgent }),
    secrets: Object.keys(s.secrets)
      .sort()
      .map((name) => ({ name })),
    endpoints: eps.map(endpointDto),
    lastCall: s.lastCall ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    canEdit: viewer.role === 'admin',
  };
}

export async function loadSource(db: Db, id: string) {
  const [s] = await db.select().from(dataSources).where(eq(dataSources.id, id));
  if (!s) throw notFound('Data source');
  const eps = await db.select().from(endpoints).where(eq(endpoints.sourceId, id)).orderBy(asc(endpoints.name));
  return { source: s, endpoints: eps };
}
