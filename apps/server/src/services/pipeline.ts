import {
  type Bindings,
  coerceToField,
  type EndpointRole,
  type FieldDefinition,
  type FillResult,
  type FillSource,
  type LookupSearchResponse,
  type MatchCandidate,
  matchScore,
  type RunInput,
  type SourceHit,
  type StepReport,
} from '@precious/shared';
import { eq, inArray } from 'drizzle-orm';
import { type ConnectorRuntime, runEndpoint } from '../connectors/runner.ts';
import { render } from '../connectors/template.ts';
import type { Db } from '../db/client.ts';
import { dataSources, endpoints } from '../db/schema.ts';
import { badRequest } from '../errors.ts';
import { sign, stableJson, verify } from './signing.ts';
import { type EndpointRow, endpointData, type SourceRow } from './sources.ts';

/**
 * The search-to-add pipeline: a picked search result fills in what it can, then
 * each lookup step runs in order, finding its own match first when it needs to.
 * A step that fails becomes a warning, so one broken source never blocks an add.
 */

export interface Bound {
  endpoint: EndpointRow;
  source: SourceRow;
}

const MAX_CANDIDATES = 5;
/** The top match must lead the next one by this much to be picked without asking. */
const CLEAR_LEAD = 0.05;

/** Loads every endpoint the bindings use, with its source, in one query. */
export async function loadBound(db: Db, bindings: Bindings): Promise<Map<string, Bound>> {
  const ids = [
    ...new Set([
      ...bindings.search.map((p) => p.endpointId),
      ...bindings.steps.flatMap((s) => [s.endpointId, ...(s.match ? [s.match.endpointId] : [])]),
    ]),
  ];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ endpoint: endpoints, source: dataSources })
    .from(endpoints)
    .innerJoin(dataSources, eq(dataSources.id, endpoints.sourceId))
    .where(inArray(endpoints.id, ids));
  return new Map(rows.map((r) => [r.endpoint.id, r]));
}

/** Endpoints that are missing or have the wrong role, as validation issues. */
export async function bindingIssues(db: Db, bindings: Bindings) {
  const bound = await loadBound(db, bindings);
  const issues: { path: string; message: string }[] = [];
  const check = (id: string, role: EndpointRole, path: string) => {
    const b = bound.get(id);
    if (!b) issues.push({ path, message: 'That endpoint no longer exists' });
    else if (b.endpoint.role !== role)
      issues.push({ path, message: `"${b.endpoint.name}" is a ${b.endpoint.role} endpoint; pick a ${role} one` });
  };
  bindings.search.forEach((p, i) => {
    check(p.endpointId, 'search', `bindings.search.${i}.endpointId`);
  });
  bindings.steps.forEach((s, i) => {
    check(s.endpointId, 'lookup', `bindings.steps.${i}.endpointId`);
    if (s.match) check(s.match.endpointId, 'search', `bindings.steps.${i}.match.endpointId`);
  });
  return issues;
}

async function run(rt: ConnectorRuntime, b: Bound, input: RunInput) {
  const s = b.source;
  return runEndpoint(rt, { ...s, userAgent: s.userAgent ?? undefined }, endpointData(b.endpoint), input);
}

const firstError = (r: { errors: { message: string }[] }) => r.errors[0]?.message ?? 'Something went wrong';

function signHit(appSecret: string, provider: string, result: Record<string, unknown>): SourceHit {
  const { token: _, ...rest } = result;
  return { ...rest, token: sign(appSecret, `hit:${provider}`, stableJson(rest)) } as SourceHit;
}

/** Checks a search result sent back by the browser is one this server returned. */
export function verifyHit(appSecret: string, provider: string, result: Record<string, unknown>) {
  const { token, ...rest } = result;
  if (typeof token !== 'string' || !verify(appSecret, `hit:${provider}`, stableJson(rest), token)) {
    throw badRequest('That search result has expired. Search again.');
  }
  return rest;
}

export function signCover(appSecret: string, url: string) {
  return { url, token: sign(appSecret, 'cover', url) };
}

export function verifyCover(appSecret: string, url: string, token: string) {
  return verify(appSecret, 'cover', url, token);
}

/** Runs one of the template's search providers. */
export async function searchWith(
  rt: ConnectorRuntime,
  bound: Map<string, Bound>,
  bindings: Bindings,
  providerId: string | undefined,
  query: string,
): Promise<LookupSearchResponse> {
  const provider = providerId ? bindings.search.find((p) => p.id === providerId) : bindings.search[0];
  if (!provider) throw badRequest('This template has no search with that name.');
  const b = bound.get(provider.endpointId);
  if (b?.endpoint.role !== 'search') return { results: [], error: 'Its search endpoint no longer exists.' };
  const res = await run(rt, b, { query });
  if (!res.ok) return { results: [], error: `${b.source.name}: ${firstError(res)}` };
  const list = (res.output as Record<string, unknown>[]) ?? [];
  return { results: list.map((r) => signHit(rt.appSecret, provider.id, r)) };
}

export type PipelineStart =
  | { kind: 'add'; query: string; provider: string; result: Record<string, unknown> }
  | { kind: 'refresh'; title: string; data: Record<string, unknown>; refs: Record<string, string> };

export async function runPipeline(
  rt: ConnectorRuntime,
  bound: Map<string, Bound>,
  template: { fields: FieldDefinition[]; bindings: Bindings },
  start: PipelineStart,
  choices: Record<string, string | null> = {},
): Promise<FillResult> {
  const { fields, bindings } = template;
  const out: FillResult = { data: {}, sources: {}, refs: {}, pending: [], warnings: [], steps: [] };
  let coverUrl: string | undefined;
  let coverSource: FillSource | undefined;
  const refs: Record<string, string> = start.kind === 'refresh' ? { ...start.refs } : {};
  const previous: Record<string, unknown> = {};
  // What templates see as {{ item }}: the item as it stands, updated as steps fill it in.
  const item: Record<string, unknown> =
    start.kind === 'refresh' ? { ...start.data, title: start.title } : { title: '' };
  const query = start.kind === 'add' ? start.query : start.title;

  const apply = (fill: Record<string, string>, output: unknown, src: FillSource) => {
    if (!output || typeof output !== 'object') return;
    const o = output as Record<string, unknown>;
    for (const [target, key] of Object.entries(fill)) {
      const v = o[key];
      if (target === '$title') {
        if (typeof v === 'string' && v.trim()) {
          out.title = v.trim().slice(0, 300);
          item.title = out.title;
          out.sources.$title = src;
        } else if (typeof v === 'number') {
          out.title = String(v);
          item.title = out.title;
          out.sources.$title = src;
        }
        continue;
      }
      if (target === '$cover') {
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
          coverUrl = v;
          coverSource = src;
        }
        continue;
      }
      const field = fields.find((f) => f.id === target);
      if (!field || field.hidden) continue;
      const c = coerceToField(field, v);
      if (!c.ok) {
        out.warnings.push({ step: src.step, target, message: `${field.label}: ${c.reason}` });
      } else if (c.value !== undefined) {
        out.data[target] = c.value;
        item[target] = c.value;
        out.sources[target] = src;
        if (c.note) out.warnings.push({ step: src.step, target, message: `${field.label}: ${c.note}` });
      }
    }
  };

  // 1. The picked search result.
  if (start.kind === 'add') {
    const provider = bindings.search.find((p) => p.id === start.provider);
    if (!provider) throw badRequest('This template has no search with that name.');
    const b = bound.get(provider.endpointId);
    const name = b?.source.name ?? provider.id;
    if (start.result.id !== undefined) refs[provider.ref] = String(start.result.id);
    previous[provider.id] = start.result;
    apply(provider.fill, start.result, { name, step: provider.id });
    out.steps.push({
      id: provider.id,
      label: b ? `${name} · ${b.endpoint.name}` : name,
      status: 'ok',
      ref: refs[provider.ref],
    });
  }

  // 2. Each lookup step, in order.
  for (const step of bindings.steps) {
    const b = bound.get(step.endpointId);
    const report: StepReport = {
      id: step.id,
      label: b ? `${b.source.name} · ${b.endpoint.name}` : step.id,
      status: 'ok',
    };
    out.steps.push(report);
    if (b?.endpoint.role !== 'lookup') {
      report.status = 'failed';
      report.message = 'Its lookup endpoint no longer exists';
      out.warnings.push({ step: step.id, message: `${b?.source.name ?? step.id}: ${report.message}` });
      continue;
    }
    const input = () => ({ query, refs: { ...refs }, item: { ...item }, previous: { ...previous } });

    if (step.ref && !refs[step.ref]) {
      const choice = choices[step.id];
      if (choice === null) {
        report.status = 'skipped';
        report.message = 'Skipped: none of the matches was right';
        continue;
      }
      if (choice) {
        refs[step.ref] = choice;
      } else if (step.match) {
        const m = step.match;
        const mb = bound.get(m.endpointId);
        if (mb?.endpoint.role !== 'search') {
          report.status = 'failed';
          report.message = 'Its match search endpoint no longer exists';
          out.warnings.push({ step: step.id, message: `${b?.source.name ?? step.id}: ${report.message}` });
          continue;
        }
        let matchQuery: string;
        try {
          matchQuery = (await render(m.query, { ...input(), secrets: {} }, 'match query')).trim();
        } catch (err) {
          report.status = 'failed';
          report.message = (err as Error).message;
          out.warnings.push({ step: step.id, message: `${b?.source.name ?? step.id}: ${report.message}` });
          continue;
        }
        if (!matchQuery) {
          report.status = 'skipped';
          report.message = 'Nothing to search for yet';
          continue;
        }
        const res = await run(rt, mb, { ...input(), query: matchQuery });
        if (!res.ok) {
          report.status = 'failed';
          report.message = firstError(res);
          out.warnings.push({ step: step.id, message: `${b?.source.name ?? step.id}: ${report.message}` });
          continue;
        }
        const year = m.yearField ? item[m.yearField] : undefined;
        const candidates: MatchCandidate[] = ((res.output as Record<string, unknown>[]) ?? [])
          .map((c) => ({
            id: String(c.id),
            title: String(c.title),
            ...(c.subtitle !== undefined && { subtitle: String(c.subtitle) }),
            ...((typeof c.year === 'string' || typeof c.year === 'number') && { year: c.year }),
            ...(typeof c.image === 'string' && { image: c.image }),
            score: matchScore(matchQuery, { title: String(c.title), year: c.year }, year),
          }))
          .sort((a, b) => b.score - a.score);
        const [top, next] = candidates;
        if (!top) {
          report.status = 'skipped';
          report.message = `No match for "${matchQuery}"`;
          continue;
        }
        if (top.score >= m.threshold && (!next || top.score - next.score >= CLEAR_LEAD)) {
          refs[step.ref] = top.id;
          report.score = top.score;
        } else {
          report.status = 'pending';
          report.message = `${candidates.length} possible matches`;
          out.pending.push({
            step: step.id,
            label: b.source.name,
            query: matchQuery,
            candidates: candidates.slice(0, MAX_CANDIDATES),
          });
          continue;
        }
      } else {
        report.status = 'skipped';
        report.message = `Needs refs.${step.ref}, which nothing earlier provided`;
        continue;
      }
    }
    if (step.ref) report.ref = refs[step.ref];

    const res = await run(rt, b, input());
    if (!res.ok) {
      report.status = 'failed';
      report.message = firstError(res);
      out.warnings.push({ step: step.id, message: `${b?.source.name ?? step.id}: ${report.message}` });
      continue;
    }
    previous[step.id] = res.output;
    apply(step.fill, res.output, { name: b.source.name, step: step.id });
  }

  out.refs = refs;
  if (coverUrl && coverSource) {
    out.cover = signCover(rt.appSecret, coverUrl);
    out.sources.$cover = { ...coverSource, url: coverUrl };
  }
  return out;
}
