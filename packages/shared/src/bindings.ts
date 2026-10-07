import { z } from 'zod';
import type { FieldDefinition } from './template.ts';

/**
 * Bindings tie a template to data sources: which search endpoints find items,
 * and which lookups fill in their fields afterwards. They're saved with the
 * template, so every collection linked to it uses them.
 */

/** Provider and step ids double as keys in `previous`; refs are keys in `external_refs`. */
export const bindingSlugSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'Use lowercase letters, digits and _');

/** What a value can fill: a field id, the title or the cover. */
export const BINDING_SYSTEM_TARGETS = { $title: 'Title', $cover: 'Cover' } as const;
export const bindingTargetSchema = z.string().regex(/^(\$title|\$cover|[a-z][a-z0-9_]{0,31})$/, 'Unknown field');

/** Target → output key of the endpoint (or the search result). */
export const fillSchema = z.record(bindingTargetSchema, z.string().trim().min(1).max(60)).default({});
export type Fill = Record<string, string>;

export const matchSchema = z.object({
  /** A search endpoint used to find this step's ref when it isn't known yet. */
  endpointId: z.string().uuid(),
  /** Liquid: what to search for, e.g. {{ item.title }}. */
  query: z.string().max(2000).default('{{ item.title }}'),
  /** Below this score (0–1) the person picks the match. */
  threshold: z.number().min(0).max(1).default(0.85),
  /** A field whose year is compared with each candidate's year. */
  yearField: z.string().optional(),
});
export type MatchConfig = z.output<typeof matchSchema>;

export const searchProviderSchema = z.object({
  id: bindingSlugSchema,
  endpointId: z.string().uuid(),
  /** The picked result's id is saved under this key, e.g. refs.igdb. */
  ref: bindingSlugSchema,
  fill: fillSchema,
});
export type SearchProvider = z.output<typeof searchProviderSchema>;

export const enrichStepSchema = z.object({
  id: bindingSlugSchema,
  endpointId: z.string().uuid(),
  /** The ref this lookup needs. Without one the step always runs. */
  ref: bindingSlugSchema.optional(),
  match: matchSchema.optional(),
  fill: fillSchema,
});
export type EnrichStep = z.output<typeof enrichStepSchema>;

export const bindingsSchema = z
  .object({
    search: z.array(searchProviderSchema).max(8).default([]),
    steps: z.array(enrichStepSchema).max(12).default([]),
  })
  .superRefine((b, ctx) => {
    const ids = new Set<string>();
    const check = (id: string, path: (string | number)[]) => {
      if (ids.has(id)) ctx.addIssue({ code: 'custom', path, message: `"${id}" is used twice` });
      ids.add(id);
    };
    b.search.forEach((p, i) => {
      check(p.id, ['search', i, 'id']);
    });
    b.steps.forEach((s, i) => {
      check(s.id, ['steps', i, 'id']);
      if (s.match && !s.ref) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'ref'],
          message: 'A step that searches for its match needs a ref',
        });
      }
    });
  });
export type Bindings = z.output<typeof bindingsSchema>;
export type BindingsInput = z.input<typeof bindingsSchema>;

export const EMPTY_BINDINGS: Bindings = { search: [], steps: [] };

/** Checks fill targets and year fields against a template's field ids (used by templateInputSchema). */
export function bindingTargetIssues(
  b: Bindings,
  fieldIds: Set<string>,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const known = (t: string) => t in BINDING_SYSTEM_TARGETS || fieldIds.has(t);
  const fills = (fill: Fill, path: (string | number)[]) => {
    for (const t of Object.keys(fill))
      if (!known(t)) issues.push({ path: [...path, t], message: `Unknown field "${t}"` });
  };
  b.search.forEach((p, i) => {
    fills(p.fill, ['bindings', 'search', i, 'fill']);
  });
  b.steps.forEach((s, i) => {
    fills(s.fill, ['bindings', 'steps', i, 'fill']);
    if (s.match?.yearField && !fieldIds.has(s.match.yearField)) {
      issues.push({
        path: ['bindings', 'steps', i, 'match', 'yearField'],
        message: `Unknown field "${s.match.yearField}"`,
      });
    }
  });
  return issues;
}

// ---------------------------------------------------------------- matching

const ARTICLES = /^(the|a|an|el|la|los|las|le|les|l|der|die|das|il|lo|gli)\s+/;

export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(ARTICLES, '');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, ' ');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient over character pairs: 1 for the same text, 0 for nothing in common. */
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let shared = 0;
  for (const [g, n] of bx) shared += Math.min(n, by.get(g) ?? 0);
  return (2 * shared) / (x.length - 1 + (y.length - 1));
}

function toYear(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v >= 1000 && v <= 9999 ? Math.trunc(v) : undefined;
  if (typeof v === 'string') {
    const m = /\b(\d{4})\b/.exec(v);
    return m ? Number(m[1]) : undefined;
  }
  return undefined;
}

/**
 * How well a candidate matches what was searched for, from 0 to 1. Titles are compared
 * without accents, case, punctuation or a leading article; a matching year adds 0.1 and
 * a year more than one off takes away 0.2.
 */
export function matchScore(query: string, candidate: { title: string; year?: unknown }, year?: unknown): number {
  let score = titleSimilarity(query, candidate.title);
  const want = toYear(year);
  const got = toYear(candidate.year);
  if (want !== undefined && got !== undefined) {
    if (want === got) score += 0.1;
    else if (Math.abs(want - got) > 1) score -= 0.2;
  }
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
}

// ---------------------------------------------------------------- values from sources

export type Coerced = { ok: true; value: unknown; note?: string } | { ok: false; reason: string };

const isEmpty = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

function asText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ');
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const t = v.trim().replace(/[\s,](?=\d{3}\b)/g, '');
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (/^-?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  }
  return undefined;
}

function asList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const out = v.map(asText).filter((x): x is string => !!x);
    return out.length === v.length ? out : undefined;
  }
  if (typeof v === 'string')
    return v
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return undefined;
}

function asDate(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v >= 1000 && v <= 9999) return `${Math.trunc(v)}-01-01`;
    // Unix time, in seconds or milliseconds.
    const ms = v > 1e11 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (/^\d{4}$/.test(t)) return `${t}-01-01`;
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`;
  const d = new Date(`${t} UTC`);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const d2 = new Date(t);
  return Number.isNaN(d2.getTime()) ? undefined : d2.toISOString().slice(0, 10);
}

const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

/**
 * Turns a value from a data source into what a field stores (see values.ts).
 * `{ ok: true, value: undefined }` means "no value". Values that can't be used say why.
 */
export function coerceToField(field: FieldDefinition, v: unknown): Coerced {
  if (isEmpty(v)) return { ok: true, value: undefined };
  const fail = (what: string): Coerced => ({ ok: false, reason: `${short(v)} isn't ${what}` });
  const { min, max, choices = [] } = field.options;
  switch (field.type) {
    case 'text':
    case 'longtext': {
      const t = asText(v);
      if (t === undefined) return fail('text');
      const limit = field.type === 'text' ? 500 : 20000;
      return t.length > limit ? { ok: true, value: t.slice(0, limit), note: 'shortened' } : { ok: true, value: t };
    }
    case 'url': {
      const t = asText(v);
      return t && /^https?:\/\/\S+$/i.test(t) ? { ok: true, value: t } : fail('a link');
    }
    case 'number':
    case 'money': {
      const n = asNumber(v);
      if (n === undefined) return fail('a number');
      if ((min !== undefined && n < min) || (max !== undefined && n > max))
        return fail(`between ${min ?? '…'} and ${max ?? '…'}`);
      return { ok: true, value: n };
    }
    case 'duration': {
      const n = asNumber(v);
      return n === undefined || n < 0 ? fail('a number of minutes') : { ok: true, value: Math.round(n) };
    }
    case 'rating': {
      const n = asNumber(v);
      const top = max ?? 5;
      if (n === undefined) return fail('a number');
      const r = Math.round(n);
      return r < 0 || r > top ? fail(`a rating from 0 to ${top}`) : { ok: true, value: r };
    }
    case 'date': {
      const d = asDate(v);
      return d ? { ok: true, value: d } : fail('a date');
    }
    case 'boolean': {
      if (typeof v === 'boolean') return { ok: true, value: v };
      const t = asText(v)?.toLowerCase();
      if (t && ['true', 'yes', '1', 'y'].includes(t)) return { ok: true, value: true };
      if (t && ['false', 'no', '0', 'n'].includes(t)) return { ok: true, value: false };
      return fail('yes or no');
    }
    case 'choice': {
      const t = asText(v);
      const hit = t === undefined ? undefined : choices.find((c) => c.toLowerCase() === t.toLowerCase());
      return hit ? { ok: true, value: hit } : fail(`one of the choices (${choices.join(', ')})`);
    }
    case 'multichoice': {
      const list = asList(v);
      if (!list) return fail('a list');
      const hits = [
        ...new Set(
          list.map((x) => choices.find((c) => c.toLowerCase() === x.toLowerCase())).filter((x): x is string => !!x),
        ),
      ];
      if (!hits.length) return fail(`any of the choices (${choices.join(', ')})`);
      return hits.length < list.length
        ? { ok: true, value: hits, note: `left out ${list.length - hits.length} that aren't choices` }
        : { ok: true, value: hits };
    }
    case 'tags': {
      const list = asList(v);
      if (!list) return fail('a list');
      const tags = [...new Set(list.map((x) => x.slice(0, 40)))].slice(0, 50);
      return { ok: true, value: tags };
    }
    case 'person':
      return { ok: false, reason: 'People fields can only be set by hand' };
  }
}

// ---------------------------------------------------------------- suggestions

const SYNONYMS: Record<string, string[]> = {
  $title: ['title', 'name'],
  $cover: ['image', 'cover', 'cover_url', 'coverurl', 'thumbnail', 'poster', 'artwork'],
};

const words = (s: string) =>
  normalizeTitle(s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '))
    .split(' ')
    .filter(Boolean);

/**
 * Suggests which output keys fill which fields, by name: `title` → title,
 * `image` → cover, `year` → "Release year". Only confident, one-to-one guesses.
 */
export function suggestFill(outputKeys: string[], fields: FieldDefinition[]): Fill {
  const fill: Fill = {};
  const used = new Set<string>();
  const skip = new Set(['id', 'results', 'subtitle']);
  const targets = fields.filter((f) => !f.hidden && f.type !== 'person');
  for (const key of outputKeys) {
    if (skip.has(key)) continue;
    const k = words(key).join(' ');
    let target: string | undefined;
    for (const [sys, names] of Object.entries(SYNONYMS)) {
      if (names.includes(k.replace(/ /g, '_')) || names.includes(k)) target = sys;
    }
    if (!target) {
      const exact = targets.filter((f) => words(f.id).join(' ') === k || words(f.label).join(' ') === k);
      if (exact.length === 1) target = exact[0]?.id;
    }
    if (!target && !k.includes(' ')) {
      const partial = targets.filter((f) => words(f.label).includes(k) || words(f.id).includes(k));
      if (partial.length === 1) target = partial[0]?.id;
    }
    if (target && !used.has(target)) {
      fill[target] = key;
      used.add(target);
    }
  }
  return fill;
}

// ---------------------------------------------------------------- pipeline results

export interface FillSource {
  /** The data source's name when the value was filled, e.g. "IGDB". */
  name: string;
  /** The provider or step that filled it. */
  step: string;
  /** For the cover: the address it was downloaded from, so a refresh can tell when it changes. */
  url?: string;
}

export interface MatchCandidate {
  id: string;
  title: string;
  subtitle?: string;
  year?: string | number;
  image?: string;
  score: number;
}

export interface PendingMatch {
  step: string;
  /** e.g. "HowLongToBeat" */
  label: string;
  query: string;
  candidates: MatchCandidate[];
}

export interface PipelineWarning {
  step?: string;
  target?: string;
  message: string;
}

export type StepStatus = 'ok' | 'pending' | 'skipped' | 'failed';

export interface StepReport {
  id: string;
  label: string;
  status: StepStatus;
  message?: string;
  /** The ref found or used, if any. */
  ref?: string;
  /** For a match picked automatically: its score. */
  score?: number;
}

export interface SignedUrl {
  url: string;
  /** Proves the server produced this URL, so only those can be downloaded. */
  token: string;
}

export interface FillResult {
  title?: string;
  cover?: SignedUrl;
  data: Record<string, unknown>;
  /** Target → where its value came from. */
  sources: Record<string, FillSource>;
  refs: Record<string, string>;
  pending: PendingMatch[];
  warnings: PipelineWarning[];
  steps: StepReport[];
}

export const choicesSchema = z.record(bindingSlugSchema, z.string().max(200).nullable()).default({});

export const lookupSearchSchema = z.object({
  provider: bindingSlugSchema,
  query: z.string().trim().min(1).max(200),
});
export type LookupSearchInput = z.infer<typeof lookupSearchSchema>;

/** A search result as the sheet shows it, plus a token proving the server produced it. */
export interface SourceHit {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  year?: string | number;
  token: string;
  [key: string]: unknown;
}

export interface LookupSearchResponse {
  results: SourceHit[];
  error?: string;
}

export const lookupFillSchema = z.object({
  provider: bindingSlugSchema,
  query: z.string().trim().max(200).default(''),
  /** The picked result, as the search returned it (token included). */
  result: z.record(z.string(), z.unknown()),
  choices: choicesSchema,
});
export type LookupFillInput = z.input<typeof lookupFillSchema>;

export const refreshInputSchema = z.object({ choices: choicesSchema });
export type RefreshInput = z.input<typeof refreshInputSchema>;

export interface RefreshChange {
  target: string;
  before: unknown;
  after: unknown;
  source: FillSource;
}

export interface RefreshResult {
  changes: RefreshChange[];
  /** Locked (hand-edited) fields the sources would have changed. */
  kept: { target: string; value: unknown; offered: unknown }[];
  cover?: SignedUrl & { source: FillSource };
  refs: Record<string, string>;
  pending: PendingMatch[];
  warnings: PipelineWarning[];
  steps: StepReport[];
}

export interface TryBindingsResult {
  results: LookupSearchResponse['results'];
  picked?: number;
  error?: string;
  fill?: FillResult;
}

export const remoteImageSchema = z.object({ url: z.string().url().max(4000), token: z.string().max(200) });
export type RemoteImageInput = z.infer<typeof remoteImageSchema>;
