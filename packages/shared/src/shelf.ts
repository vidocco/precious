import { z } from 'zod';
import { arrangementIssues, arrangementSchema } from './arrangement.ts';
import type { FieldDefinition } from './template.ts';

/**
 * How big each item is on the shelf. A template either measures every item the same
 * way (a fixed size, or read from a number field: pages × 0.005 cm + 0.3 cm), or
 * picks a size by the value of a field (Switch games are 1.1 × 17 cm). With a field's
 * value, either size can still be measured instead (Format sets the height, Pages the
 * thickness). All sizes are in centimetres.
 */

const cm = z.number().min(0).max(1000);

export const measureSchema = z.object({
  /** A number field to read; null means the fallback is used for every item (a fixed size). */
  field: z.string().nullable().default(null),
  factor: cm.default(1),
  add: cm.default(0),
  /** Used when the field has no value. */
  fallback: z.number().min(0.1).max(100),
});
export type Measure = z.output<typeof measureSchema>;

const sizeSchema = z.object({ thickness: z.number().min(0.1).max(100), height: z.number().min(0.1).max(100) });

export const SHELF_DIMENSIONS = ['thickness', 'height'] as const;
export type ShelfDimension = (typeof SHELF_DIMENSIONS)[number];

export const shelfSchema = z.object({
  by: z.enum(['measure', 'rules']).default('measure'),
  thickness: measureSchema.default({ field: null, factor: 1, add: 0, fallback: 2.5 }),
  height: measureSchema.default({ field: null, factor: 1, add: 0, fallback: 21 }),
  /** The field whose value picks the size (by: 'rules'). */
  rulesField: z.string().nullable().default(null),
  rules: z
    .array(sizeSchema.extend({ values: z.array(z.string().trim().min(1).max(60)).min(1).max(30) }))
    .max(30)
    .default([]),
  otherwise: sizeSchema.default({ thickness: 2.5, height: 21 }),
  /**
   * With by 'rules', the sizes measured as with by 'measure' instead of set by the rules (the rules
   * keep a number for them all the same). Saved only when used, so older data has none.
   */
  measured: z.array(z.enum(SHELF_DIMENSIONS)).max(2).optional(),
  /** Items lean when this field has this value (e.g. Status is Reading). */
  lean: z
    .object({ field: z.string(), equals: z.union([z.string(), z.boolean()]) })
    .nullable()
    .default(null),
  /** A field shown in small type under the title on the spine (author, platform). */
  subtitle: z.string().nullable().default(null),
  /** How items are grouped and ordered ("Shelf order"); empty for none. Collections can override it. */
  arrange: arrangementSchema.default([]),
});
export type Shelf = z.output<typeof shelfSchema>;
export type ShelfInput = z.input<typeof shelfSchema>;

export const DEFAULT_SHELF: Shelf = shelfSchema.parse({});

/** Whether a size is set by the rules (a field's value) rather than measured (fixed, or from a number field). */
export function sizedByRules(s: Pick<Shelf, 'by' | 'measured'>, dim: ShelfDimension): boolean {
  return s.by === 'rules' && !s.measured?.includes(dim);
}

/** Problems with field references, for templateInputSchema. */
export function shelfIssues(s: Shelf, fields: FieldDefinition[]): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const byId = new Map(fields.map((f) => [f.id, f]));
  const numeric = (id: string | null, path: (string | number)[]) => {
    if (id === null) return;
    const f = byId.get(id);
    if (!f) issues.push({ path, message: `Unknown field "${id}"` });
    else if (!['number', 'money', 'duration', 'rating'].includes(f.type))
      issues.push({ path, message: `"${f.label}" is not a number, so it can't give a size` });
  };
  for (const dim of SHELF_DIMENSIONS) if (!sizedByRules(s, dim)) numeric(s[dim].field, ['shelf', dim, 'field']);
  if (s.by === 'rules') {
    if (!s.rulesField) issues.push({ path: ['shelf', 'rulesField'], message: 'Pick the field that sets the size' });
    else if (!byId.has(s.rulesField))
      issues.push({ path: ['shelf', 'rulesField'], message: `Unknown field "${s.rulesField}"` });
  }
  if (s.lean && !byId.has(s.lean.field))
    issues.push({ path: ['shelf', 'lean', 'field'], message: `Unknown field "${s.lean.field}"` });
  if (s.subtitle && !s.subtitle.startsWith('$') && !byId.has(s.subtitle))
    issues.push({ path: ['shelf', 'subtitle'], message: `Unknown field "${s.subtitle}"` });
  issues.push(...arrangementIssues(s.arrange ?? [], fields, ['shelf', 'arrange']));
  return issues;
}

// ---------------------------------------------------------------- sizes

const LIMITS = { thickness: [0.2, 15], height: [5, 60] } as const;
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 100) / 100;

const asNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const asTexts = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)];
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function measure(m: Measure, data: Record<string, unknown>): number {
  const v = m.field ? asNumber(data[m.field]) : undefined;
  return v === undefined ? m.fallback : v * m.factor + m.add;
}

export interface SpineSize {
  /** cm */
  thickness: number;
  /** cm */
  height: number;
  lean: boolean;
}

/** An item's size on the shelf, kept within believable limits (2 mm–15 cm thick, 5–60 cm tall). */
export function spineSize(s: Shelf, item: { data: Record<string, unknown> }): SpineSize {
  const values = s.by === 'rules' && s.rulesField ? asTexts(item.data[s.rulesField]) : [];
  const rule = s.rules.find((r) => r.values.some((rv) => values.some((v) => sameText(v, rv)))) ?? s.otherwise;
  const size = (dim: ShelfDimension) => (sizedByRules(s, dim) ? rule[dim] : measure(s[dim], item.data));
  const thickness = size('thickness');
  const height = size('height');
  let lean = false;
  if (s.lean) {
    const v = item.data[s.lean.field];
    const want = s.lean.equals;
    lean = typeof want === 'boolean' ? (v === true) === want : asTexts(v).some((x) => sameText(x, want));
  }
  return {
    thickness: round(clamp(thickness, LIMITS.thickness)),
    height: round(clamp(height, LIMITS.height)),
    lean,
  };
}

// ---------------------------------------------------------------- description

const n = (v: number) => String(Math.round(v * 1000) / 1000);
const label = (fields: FieldDefinition[], id: string | null) => fields.find((f) => f.id === id)?.label ?? id ?? '';

function describeMeasure(m: Measure, fields: FieldDefinition[]): string {
  if (!m.field) return `${n(m.fallback)} cm`;
  return `from ${label(fields, m.field)}${m.factor === 1 ? '' : ` × ${n(m.factor)}`}${m.add ? ` + ${n(m.add)} cm` : ''}`;
}

/** The rule in words, as the shelf header shows it. */
export function describeShelf(s: Shelf, fields: FieldDefinition[]): string {
  const out: string[] = [];
  const byRules = SHELF_DIMENSIONS.filter((dim) => sizedByRules(s, dim));
  if (byRules.length) {
    const size = (r: { thickness: number; height: number }) => `${byRules.map((dim) => n(r[dim])).join(' × ')} cm`;
    const rules = s.rules.map((r) => `${r.values.join('/')} ${size(r)}`);
    const what = byRules.length === 2 ? 'Size' : byRules[0] === 'thickness' ? 'Thickness' : 'Height';
    out.push(`${what} by ${label(fields, s.rulesField)}: ${[...rules, `others ${size(s.otherwise)}`].join(' · ')}`);
    for (const dim of SHELF_DIMENSIONS)
      if (!byRules.includes(dim)) out.push(`${dim} ${describeMeasure(s[dim], fields)}`);
  } else if (!s.thickness.field && !s.height.field) {
    out.push(`Every item ${n(s.thickness.fallback)} × ${n(s.height.fallback)} cm`);
  } else {
    out.push(`Thickness ${describeMeasure(s.thickness, fields)}`, `height ${describeMeasure(s.height, fields)}`);
  }
  if (s.lean) {
    const v = s.lean.equals;
    out.push(`leans when ${label(fields, s.lean.field)} is ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : v}`);
  }
  return out.join(' · ');
}
