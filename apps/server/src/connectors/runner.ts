import type { EndpointData, LastCall, NameValue, RunError, RunInput, RunResult, SourceData } from '@precious/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { dataSources, type EncryptedSecret } from '../db/schema.ts';
import { VERSION } from '../version.ts';
import { applyAuth, type FetchLike, TokenCache } from './auth.ts';
import { cacheKey, readCache, writeCache } from './cache.ts';
import { StageError } from './errors.ts';
import { extract, loadHtml, previewHtml } from './html.ts';
import { type IncomingResponse, type OutgoingRequest, send } from './http.ts';
import { RateLimiter } from './limiter.ts';
import { mapOutput } from './map.ts';
import { detectFormat, graphqlData, parseBody } from './parse.ts';
import { decryptAll, maskHeader, maskSecrets } from './secrets.ts';
import { render, type TemplateContext } from './template.ts';
import { validateOutput } from './validate.ts';

export const DEFAULT_USER_AGENT = `Precious/${VERSION} (self-hosted collection manager)`;
const MAX_BODY_ECHO = 400_000;

/** Long-lived pieces shared by every run: rate limits and OAuth tokens. */
export interface ConnectorRuntime {
  db: Db;
  appSecret: string;
  limiter: RateLimiter;
  tokens: TokenCache;
  fetchImpl: FetchLike;
}

export function createRuntime(db: Db, appSecret: string, fetchImpl: FetchLike = fetch): ConnectorRuntime {
  return { db, appSecret, limiter: new RateLimiter(), tokens: new TokenCache(fetchImpl), fetchImpl };
}

export interface SourceForRun extends SourceData {
  id: string;
  secrets: Record<string, EncryptedSecret>;
}

export function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const b = base.replace(/\/+$/, '');
  if (!path) return b;
  return `${b}${path.startsWith('/') || path.startsWith('?') ? '' : '/'}${path}`;
}

async function buildRequest(
  source: SourceForRun,
  endpoint: EndpointData,
  tctx: TemplateContext,
): Promise<OutgoingRequest> {
  const r = (t: string, where: string) => render(t, tctx, where);
  let url: URL;
  const rawUrl = joinUrl(source.baseUrl, await r(endpoint.path, 'path'));
  try {
    url = new URL(rawUrl);
  } catch {
    throw new StageError('template', `"${rawUrl}" is not a valid address.`, 'path');
  }
  if (!/^https?:$/.test(url.protocol))
    throw new StageError('template', 'Only http:// and https:// addresses are allowed.', 'path');
  for (const q of endpoint.query) url.searchParams.append(q.name, await r(q.value, `query parameter "${q.name}"`));

  const headers = new Headers();
  headers.set('user-agent', source.userAgent || DEFAULT_USER_AGENT);
  headers.set(
    'accept',
    endpoint.kind === 'html' ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' : 'application/json, */*;q=0.5',
  );
  const setHeaders = async (list: NameValue[], where: string) => {
    for (const h of list) {
      try {
        headers.set(h.name, await r(h.value, `${where} header "${h.name}"`));
      } catch (err) {
        if (err instanceof StageError) throw err;
        throw new StageError('template', `"${h.name}" is not a valid header name or value.`, `headers.${h.name}`);
      }
    }
  };
  await setHeaders(source.headers, 'default');
  await setHeaders(endpoint.headers, 'endpoint');

  let method: string = endpoint.method;
  let body: string | undefined;
  if (endpoint.kind === 'graphql') {
    const varsText = await r(endpoint.graphql.variables || '{}', 'variables');
    let variables: unknown;
    try {
      variables = JSON.parse(varsText || '{}');
    } catch (err) {
      throw new StageError(
        'template',
        `The variables don't make valid JSON (${(err as Error).message}): ${varsText.slice(0, 120)}`,
        'variables',
      );
    }
    if (endpoint.graphql.useGet) {
      method = 'GET';
      url.searchParams.set('query', endpoint.graphql.query);
      url.searchParams.set('variables', JSON.stringify(variables));
    } else {
      method = 'POST';
      body = JSON.stringify({ query: endpoint.graphql.query, variables });
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
  } else if (endpoint.body.type !== 'none' && method !== 'GET') {
    body = await r(endpoint.body.template, 'body');
    if (endpoint.body.type === 'json') {
      try {
        JSON.parse(body);
      } catch (err) {
        throw new StageError('template', `The body doesn't make valid JSON (${(err as Error).message}).`, 'body');
      }
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    } else if (endpoint.body.type === 'form') {
      if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded');
    } else if (!headers.has('content-type')) {
      headers.set('content-type', 'text/plain; charset=utf-8');
    }
  }
  return { method, url, headers, body };
}

function shownRequest(req: OutgoingRequest, secretValues: string[]): NonNullable<RunResult['request']> {
  return {
    method: req.method,
    url: maskSecrets(req.url.href, secretValues),
    headers: [...req.headers.entries()].map(([name, value]) => ({
      name,
      value: maskHeader(name, value, secretValues),
    })),
    ...(req.body !== undefined && { body: maskSecrets(req.body, secretValues) }),
  };
}

async function recordCall(db: Db, sourceId: string, call: LastCall) {
  await db.update(dataSources).set({ lastCall: call }).where(eq(dataSources.id, sourceId));
}

function errorFrom(err: unknown): RunError {
  if (err instanceof StageError) return { stage: err.stage, message: err.message, ...(err.path && { path: err.path }) };
  return { stage: 'http', message: (err as Error).message ?? String(err) };
}

/**
 * Runs one endpoint end to end: render the request, authenticate, fetch (or reuse
 * the cache), parse, extract, map and validate. Never throws: problems come back
 * as errors tagged with the stage they happened in.
 */
export async function runEndpoint(
  rt: ConnectorRuntime,
  source: SourceForRun,
  endpoint: EndpointData,
  input: RunInput,
  opts: { useCache?: boolean; record?: boolean } = {},
): Promise<RunResult> {
  const { useCache = true, record = true } = opts;
  const secrets = decryptAll(rt.appSecret, source.secrets);
  const secretValues = Object.values(secrets);
  const tctx: TemplateContext = {
    query: input.query ?? '',
    refs: input.refs ?? {},
    item: input.item ?? {},
    previous: input.previous ?? {},
    secrets,
  };
  const result: RunResult = { ok: false, errors: [] };

  let req: OutgoingRequest;
  try {
    req = await buildRequest(source, endpoint, tctx);
    await applyAuth(
      source.auth,
      { sourceId: source.id, secrets, renderText: (t, w) => render(t, tctx, w), tokens: rt.tokens },
      req,
    );
  } catch (err) {
    result.errors.push(errorFrom(err));
    return result;
  }
  result.request = shownRequest(req, secretValues);

  const ttl = endpoint.cacheSeconds ?? source.cacheSeconds;
  const key = cacheKey(req);
  let res: IncomingResponse | null = null;
  let cached = false;
  const started = Date.now();
  try {
    if (useCache && ttl > 0) {
      res = await readCache(rt.db, key);
      cached = !!res;
    }
    if (!res) {
      await rt.limiter.wait(source.id, source.rateLimit);
      res = await send(req, { fetchImpl: rt.fetchImpl });
      if (res.status === 401 && source.auth.type === 'oauth2') {
        // The token may have been revoked early: get a new one and try once more.
        const clientId = await render(source.auth.clientId, tctx, 'client ID');
        rt.tokens.invalidate(source.id, source.auth, clientId);
        await applyAuth(
          source.auth,
          { sourceId: source.id, secrets, renderText: (t, w) => render(t, tctx, w), tokens: rt.tokens },
          req,
        );
        res = await send(req, { fetchImpl: rt.fetchImpl });
      }
    }
  } catch (err) {
    result.errors.push(errorFrom(err));
    if (record)
      await recordCall(rt.db, source.id, {
        at: new Date().toISOString(),
        ok: false,
        message: result.errors[0]?.message,
      });
    return result;
  }

  const timeMs = cached ? 0 : Date.now() - started;
  const ok = res.status >= 200 && res.status < 300;
  result.response = {
    status: res.status,
    timeMs,
    cached,
    contentType: res.contentType,
    body: res.text.length > MAX_BODY_ECHO ? `${res.text.slice(0, MAX_BODY_ECHO)}…` : res.text,
    truncated: res.text.length > MAX_BODY_ECHO,
  };

  if (!ok) {
    result.errors.push({
      stage: 'http',
      message:
        `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}. ${res.text.replace(/\s+/g, ' ').slice(0, 200)}`.trim(),
    });
    try {
      result.response.body = parseBody('json', res.text);
    } catch {
      // Not JSON: leave the text as it is.
    }
    if (record)
      await recordCall(rt.db, source.id, {
        at: new Date().toISOString(),
        ok: false,
        status: res.status,
        message: result.errors[0]?.message,
      });
    return result;
  }
  if (!cached && useCache && ttl > 0) await writeCache(rt.db, key, res, ttl);

  try {
    const format = detectFormat(endpoint, res.contentType, res.text);
    let data: unknown;
    if (format === 'html') {
      const pageUrl = res.url || req.url.href;
      const doc = loadHtml(res.text, pageUrl);
      result.response.preview = previewHtml(doc, pageUrl);
      try {
        data = extract(doc, endpoint.extract, pageUrl);
      } catch (err) {
        result.response.body = {};
        throw err;
      }
      result.response.body = data;
    } else {
      const parsed = parseBody(format, res.text);
      result.response.body = parsed;
      data = endpoint.kind === 'graphql' ? graphqlData(parsed, endpoint.graphql.allowPartial) : parsed;
    }
    const mapped = await mapOutput(endpoint.role, endpoint.map, data);
    const validated = validateOutput(endpoint.role, mapped);
    result.output = validated.output;
    result.errors.push(...validated.errors);
  } catch (err) {
    result.errors.push(errorFrom(err));
  }

  result.ok = result.errors.length === 0;
  if (record && !cached) {
    await recordCall(rt.db, source.id, {
      at: new Date().toISOString(),
      ok: result.ok,
      status: res.status,
      ...(result.errors[0] && { message: result.errors[0].message }),
    });
  }
  return result;
}
