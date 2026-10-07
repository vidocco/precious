import { z } from 'zod';
import type { FieldDefinition, FieldRef } from './template.ts';

/**
 * Item values live in a JSON object keyed by field id. These helpers build the
 * validator for a template's fields and format values for display.
 *
 * Storage per type:
 * - text, longtext, url, choice, person: string
 * - number, money, rating: number
 * - duration: whole minutes
 * - date: "YYYY-MM-DD"
 * - boolean: boolean
 * - multichoice, tags: string[]
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2024-11-03');

function valueSchema(field: FieldDefinition): z.ZodType {
  const { min, max, choices } = field.options;
  switch (field.type) {
    case 'text':
      return z.string().trim().max(500);
    case 'longtext':
      return z.string().max(20000);
    case 'url':
      return z.string().trim().url('Enter a full link starting with http:// or https://');
    case 'person':
      return z.string().min(1).max(64);
    case 'choice':
      return z.enum(choices as [string, ...string[]], { message: `Pick one of: ${choices?.join(', ')}` });
    case 'multichoice':
      return z.array(z.enum(choices as [string, ...string[]])).max(choices?.length ?? 0);
    case 'tags':
      return z.array(z.string().trim().min(1).max(40)).max(50);
    case 'number':
    case 'money': {
      let s = z.number().finite();
      if (min !== undefined) s = s.min(min);
      if (max !== undefined) s = s.max(max);
      return s;
    }
    case 'rating':
      return z
        .number()
        .int()
        .min(0)
        .max(max ?? 5);
    case 'duration':
      return z.number().int().min(0).max(1_000_000);
    case 'date':
      return isoDate;
    case 'boolean':
      return z.boolean();
  }
}

/** Empty strings and empty lists from forms are stored as "no value". */
function emptyToUndefined(v: unknown) {
  if (v === '' || v === null) return undefined;
  if (Array.isArray(v) && v.length === 0) return undefined;
  return v;
}

/**
 * Builds the validator for an item's data. Hidden fields are skipped (their stored
 * values are kept by the server). With `partial`, every field is optional.
 */
export function buildItemSchema(fields: FieldDefinition[], { partial = false } = {}) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    if (field.hidden) continue;
    const base = valueSchema(field);
    const required = field.required && !partial;
    shape[field.id] = z.preprocess(emptyToUndefined, required ? base : base.optional());
  }
  return z
    .object(shape)
    .strip()
    .transform((obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)));
}

export const itemTitleSchema = z.string().trim().min(1, 'Give it a title').max(300);

// ---------------------------------------------------------------- formatting

export interface FormatContext {
  locale?: string;
  /** Resolves a person field's user id to a display name. */
  personName?: (id: string) => string | undefined;
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  if (m === 30) return `${h}½ h`;
  return `${h} h ${m} min`;
}

export function formatValue(field: FieldDefinition, value: unknown, ctx: FormatContext = {}): string {
  if (value === undefined || value === null || value === '') return '';
  const locale = ctx.locale ?? 'en-IE';
  switch (field.type) {
    case 'money':
      return typeof value === 'number'
        ? new Intl.NumberFormat(locale, { style: 'currency', currency: field.options.currency ?? 'EUR' }).format(value)
        : '';
    case 'number': {
      if (typeof value !== 'number') return '';
      // No thousands separator below 10 000, so years read as 2019 rather than 2,019.
      const n = new Intl.NumberFormat(locale, {
        maximumFractionDigits: 2,
        useGrouping: Math.abs(value) >= 10000,
      }).format(value);
      return field.options.unit ? `${n} ${field.options.unit}` : n;
    }
    case 'rating':
      return typeof value === 'number' ? `${value} / ${field.options.max ?? 5}` : '';
    case 'duration':
      return typeof value === 'number' ? formatMinutes(value) : '';
    case 'date': {
      if (typeof value !== 'string') return '';
      const d = new Date(`${value}T00:00:00Z`);
      return Number.isNaN(d.getTime())
        ? value
        : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
            d,
          );
    }
    case 'boolean':
      return value === true ? 'Yes' : value === false ? 'No' : '';
    case 'multichoice':
    case 'tags':
      return Array.isArray(value) ? value.join(', ') : '';
    case 'person':
      return typeof value === 'string' ? (ctx.personName?.(value) ?? value) : '';
    default:
      return String(value);
  }
}

/** The bits of an item needed to resolve system fields. */
export interface ItemLike {
  title: string;
  accession: string;
  createdAt: string;
  collectionName?: string;
  data: Record<string, unknown>;
}

export function formatAccession(prefix: string, no: number): string {
  return `${prefix}·${String(no).padStart(4, '0')}`;
}

/** Formats a field or system field for one item. Unknown or empty refs give "". */
export function formatRef(ref: FieldRef, item: ItemLike, fields: FieldDefinition[], ctx: FormatContext = {}): string {
  switch (ref) {
    case '$title':
      return item.title;
    case '$accession':
      return item.accession;
    case '$collection':
      return item.collectionName ?? '';
    case '$added':
      return new Intl.DateTimeFormat(ctx.locale ?? 'en-IE', { day: 'numeric', month: 'short', year: 'numeric' }).format(
        new Date(item.createdAt),
      );
  }
  const field = fields.find((f) => f.id === ref);
  return field ? formatValue(field, item.data[ref], ctx) : '';
}

/**
 * The text an item is searched by: title, accession number and every visible
 * text-like value, each tagged with its field label so a match can say where it hit.
 */
export function searchEntries(item: ItemLike, fields: FieldDefinition[]): { label: string; text: string }[] {
  const entries = [
    { label: 'Title', text: item.title },
    { label: 'Accession number', text: item.accession },
  ];
  for (const f of fields) {
    if (f.hidden || f.type === 'boolean' || f.type === 'person') continue;
    const text = formatValue(f, item.data[f.id]);
    if (text) entries.push({ label: f.label, text });
  }
  return entries;
}
