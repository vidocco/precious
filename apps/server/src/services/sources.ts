import type { EndpointData, EndpointDto, SourceDto } from '@precious/shared';
import { asc, eq } from 'drizzle-orm';
import type { SessionUser } from '../auth/auth.ts';
import type { Db } from '../db/client.ts';
import { dataSources, endpoints, templates } from '../db/schema.ts';
import { notFound } from '../errors.ts';
import { boundEndpointIds } from './pipeline.ts';

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
export function sourceDto(
  s: SourceRow,
  eps: EndpointRow[],
  viewer: SessionUser,
  usedBy: SourceDto['usedBy'] = [],
): SourceDto {
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
    usedBy,
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

/** Which templates use each source's endpoints, by source id. */
export async function sourceUsage(db: Db): Promise<Map<string, SourceDto['usedBy']>> {
  const [tpls, eps] = await Promise.all([
    db.select({ id: templates.id, name: templates.name, bindings: templates.bindings }).from(templates),
    db.select({ id: endpoints.id, sourceId: endpoints.sourceId }).from(endpoints),
  ]);
  const sourceOf = new Map(eps.map((e) => [e.id, e.sourceId]));
  const out = new Map<string, SourceDto['usedBy']>();
  for (const t of tpls) {
    const ids = boundEndpointIds(t.bindings);
    for (const sid of new Set(ids.map((id) => sourceOf.get(id)).filter((x): x is string => !!x))) {
      const list = out.get(sid) ?? [];
      list.push({ templateId: t.id, name: t.name });
      out.set(sid, list);
    }
  }
  return out;
}
