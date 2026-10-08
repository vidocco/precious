import { z } from 'zod';

/**
 * Data sources: an API or website plus its endpoints. Requests are templates
 * (Liquid), responses become JSON and are mapped with JSONata.
 */

export const nameValueSchema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(100),
  value: z.string().max(4000),
});
export const nameValueListSchema = z.array(nameValueSchema).max(50).default([]);
export type NameValue = z.infer<typeof nameValueSchema>;

/** Secret names are referenced as {{ secrets.name }} in templates. */
export const secretNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,40}$/, 'Use letters, digits and _ (no spaces)');

const httpUrl = z
  .string()
  .trim()
  .url('Enter a full address starting with http:// or https://')
  .refine((u) => /^https?:\/\//i.test(u), 'Only http:// and https:// addresses are allowed');

export const AUTH_TYPES = ['none', 'apiKey', 'bearer', 'basic', 'oauth2'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('apiKey'),
    in: z.enum(['header', 'query']).default('header'),
    name: z.string().trim().min(1).max(100),
    secret: secretNameSchema,
  }),
  z.object({ type: z.literal('bearer'), secret: secretNameSchema }),
  z.object({ type: z.literal('basic'), username: z.string().max(200), secret: secretNameSchema }),
  z.object({
    type: z.literal('oauth2'),
    tokenUrl: httpUrl,
    clientId: z.string().max(400),
    secret: secretNameSchema,
    scope: z.string().max(400).optional(),
    /**
     * How the client ID and secret reach the token address: in the form body (the default, and what
     * sources saved before this option had), or as a Basic Authorization header (eBay, among others).
     */
    clientAuth: z.enum(['body', 'header']).optional(),
  }),
]);
export type SourceAuth = z.infer<typeof authSchema>;

export const sourceInputSchema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(80),
  description: z.string().max(400).default(''),
  baseUrl: httpUrl,
  auth: authSchema.default({ type: 'none' }),
  headers: nameValueListSchema,
  rateLimit: z
    .object({ requests: z.number().int().min(1).max(1000), perSeconds: z.number().int().min(1).max(3600) })
    .default({ requests: 2, perSeconds: 1 }),
  /** How long responses are reused. 0 turns caching off. */
  cacheSeconds: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24 * 90)
    .default(60 * 60 * 24),
  userAgent: z.string().max(300).optional(),
});
export type SourceInput = z.input<typeof sourceInputSchema>;
export type SourceData = z.output<typeof sourceInputSchema>;

/** `{ name: value }` sets a secret, `{ name: null }` removes it; names left out stay as they are. */
export const secretsUpdateSchema = z.record(secretNameSchema, z.string().max(4000).nullable());
export type SecretsUpdate = z.infer<typeof secretsUpdateSchema>;

// ---------------------------------------------------------------- HTML extraction

export const EXTRACT_AS = ['string', 'number', 'date', 'boolean'] as const;

export interface ExtractNode {
  /** CSS selector, relative to the parent match (or the page). */
  css?: string;
  /** XPath expression, relative to the parent match (or the page). */
  xpath?: string;
  /** What to take from each match: text (default), ownText, html or attr:<name>. */
  value?: string;
  many?: boolean;
  /** Nested values, one object per match. */
  fields?: Record<string, ExtractNode>;
  /** A regular expression; its first capture group (or the whole match) is kept. */
  regex?: string;
  as?: (typeof EXTRACT_AS)[number];
  absoluteUrl?: boolean;
  trim?: boolean;
  default?: unknown;
  /** Structured data from <script type="application/ld+json">, optionally only this @type. */
  jsonld?: string | true;
  /** A <meta> tag by property or name, e.g. og:image. */
  meta?: string;
  /** Parses the JSON inside the script matched by this selector, e.g. script#__NEXT_DATA__. */
  scriptJson?: string;
}

export const extractNodeSchema: z.ZodType<ExtractNode> = z.lazy(() =>
  z
    .object({
      css: z.string().max(500).optional(),
      xpath: z.string().max(500).optional(),
      value: z
        .string()
        .regex(/^(text|ownText|html|attr:[\w:-]+)$/, 'Use text, ownText, html or attr:<name>')
        .optional(),
      many: z.boolean().optional(),
      fields: z.record(z.string().min(1).max(60), extractNodeSchema).optional(),
      regex: z.string().max(300).optional(),
      as: z.enum(EXTRACT_AS).optional(),
      absoluteUrl: z.boolean().optional(),
      trim: z.boolean().optional(),
      default: z.unknown().optional(),
      jsonld: z.union([z.literal(true), z.string().max(80)]).optional(),
      meta: z.string().max(120).optional(),
      scriptJson: z.string().max(300).optional(),
    })
    .refine(
      (n) => [n.css, n.xpath, n.jsonld, n.meta, n.scriptJson].filter((x) => x !== undefined && x !== '').length <= 1,
      'Use only one of css, xpath, jsonld, meta or scriptJson',
    ),
);

export const extractSchema = z.record(z.string().min(1).max(60), extractNodeSchema);
export type Extract = Record<string, ExtractNode>;

// ---------------------------------------------------------------- endpoints

export const ENDPOINT_ROLES = ['search', 'lookup', 'compute'] as const;
export type EndpointRole = (typeof ENDPOINT_ROLES)[number];
export const ENDPOINT_KINDS = ['rest', 'graphql', 'html'] as const;
export type EndpointKind = (typeof ENDPOINT_KINDS)[number];
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const BODY_TYPES = ['none', 'json', 'form', 'raw'] as const;
export const RESPONSE_FORMATS = ['auto', 'json', 'xml', 'html'] as const;

/** The output keys each role starts with in the mapping editor. */
export const ROLE_MAP_KEYS: Record<EndpointRole, string[]> = {
  search: ['results', 'id', 'title', 'subtitle', 'image', 'year'],
  lookup: [],
  compute: ['value'],
};

export const endpointInputSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, 'Use lowercase letters, digits, - and _'),
  name: z.string().trim().min(1).max(80),
  role: z.enum(ENDPOINT_ROLES).default('search'),
  kind: z.enum(ENDPOINT_KINDS).default('rest'),
  method: z.enum(HTTP_METHODS).default('GET'),
  path: z.string().max(2000).default(''),
  query: nameValueListSchema,
  headers: nameValueListSchema,
  body: z
    .object({ type: z.enum(BODY_TYPES).default('none'), template: z.string().max(20000).default('') })
    .default({ type: 'none', template: '' }),
  graphql: z
    .object({
      query: z.string().max(20000).default(''),
      /** A Liquid template producing a JSON object. */
      variables: z.string().max(20000).default('{}'),
      useGet: z.boolean().default(false),
      allowPartial: z.boolean().default(false),
    })
    .default({ query: '', variables: '{}', useGet: false, allowPartial: false }),
  format: z.enum(RESPONSE_FORMATS).default('auto'),
  extract: extractSchema.default({}),
  /** Output key → JSONata expression. */
  map: z.record(z.string().min(1).max(60), z.string().max(4000)).default({}),
  /** Overrides the source's cache time when set. */
  cacheSeconds: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24 * 90)
    .nullable()
    .default(null),
  sample: z
    .object({
      query: z.string().max(500).optional(),
      refs: z.record(z.string(), z.string()).optional(),
      item: z.record(z.string(), z.unknown()).optional(),
    })
    .default({}),
});
export type EndpointInput = z.input<typeof endpointInputSchema>;
export type EndpointData = z.output<typeof endpointInputSchema>;

/** What templates can use: {{ query }}, {{ refs.x }}, {{ item.title }}, {{ previous.x }}. */
export const runInputSchema = z.object({
  query: z.string().max(500).optional(),
  refs: z.record(z.string(), z.string()).optional(),
  item: z.record(z.string(), z.unknown()).optional(),
  previous: z.record(z.string(), z.unknown()).optional(),
});
export type RunInput = z.infer<typeof runInputSchema>;

export const runRequestSchema = z.object({
  endpoint: endpointInputSchema,
  input: runInputSchema.default({}),
  useCache: z.boolean().default(true),
});
export type RunRequest = z.input<typeof runRequestSchema>;

// ---------------------------------------------------------------- outputs per role

export const searchResultSchema = z
  .object({
    id: z.union([z.string().min(1), z.number()]).transform(String),
    title: z.string().min(1),
    subtitle: z.union([z.string(), z.number()]).transform(String).optional(),
    image: z.string().url().optional(),
    year: z.union([z.number(), z.string()]).optional(),
  })
  .catchall(z.unknown());
export type SearchResult = z.output<typeof searchResultSchema>;

export const RUN_STAGES = ['template', 'auth', 'http', 'parse', 'extract', 'map', 'validate'] as const;
export type RunStage = (typeof RUN_STAGES)[number];

export interface RunError {
  stage: RunStage;
  message: string;
  path?: string;
}

export interface RunResult {
  ok: boolean;
  request?: {
    method: string;
    url: string;
    headers: NameValue[];
    body?: string;
  };
  response?: {
    status: number;
    timeMs: number;
    cached: boolean;
    contentType: string;
    /** The parsed body: JSON, XML as JSON, or the HTML extract result. */
    body: unknown;
    /** For HTML: the page without scripts, for the selector picker. */
    preview?: string;
    truncated?: boolean;
  };
  output?: unknown;
  errors: RunError[];
}

// ---------------------------------------------------------------- DTOs and recipes

export interface LastCall {
  at: string;
  ok: boolean;
  status?: number;
  message?: string;
}

export interface EndpointDto extends EndpointData {
  id: string;
  sourceId: string;
  updatedAt: string;
}

export interface SourceDto extends SourceData {
  id: string;
  secrets: { name: string }[];
  endpoints: EndpointDto[];
  lastCall: LastCall | null;
  /** Templates whose data source settings use this source. */
  usedBy: { templateId: string; name: string }[];
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export const recipeSchema = z.object({
  format: z.literal('precious-recipe'),
  version: z.literal(1),
  source: sourceInputSchema,
  /** Secrets the recipe needs; their values are never exported. */
  secretNames: z.array(secretNameSchema).max(20).default([]),
  endpoints: z.array(endpointInputSchema).max(40).default([]),
});
export type Recipe = z.input<typeof recipeSchema>;

export interface PresetDto {
  key: string;
  name: string;
  description: string;
  kinds: EndpointKind[];
  secretNames: string[];
}
