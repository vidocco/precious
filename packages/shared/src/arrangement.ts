import { z } from 'zod';
import type { FieldDefinition } from './template.ts';
import { type FormatContext, formatValue } from './values.ts';

/**
 * How a collection is arranged, like a library: levels of grouping and order (Genre, then
 * Author, then Series, then Series number, then Title). Each level can show a section
 * marker where its groups start, and a marked level can start each group on a new board.
 * Levels without a marker only keep things together and in order.
 */

export const ARRANGE_SYSTEM_REFS = { $title: 'Title', $accession: 'Accession number', $added: 'Date added' } as const;

export const arrangeLevelSchema = z
  .object({
    /** A field id, or $title, $accession or $added. */
    ref: z.string().min(1).max(60),
    dir: z.enum(['asc', 'desc']).default('asc'),
    /** A divider (or heading) where each group of this level starts. */
    marker: z.boolean().default(false),
    /** Each group starts on a new board of the shelf. */
    newBoard: z.boolean().default(false),
  })
  .refine((l) => l.marker || !l.newBoard, {
    message: 'Starting each group on a new board needs a section marker',
    path: ['newBoard'],
  });
export type ArrangeLevel = z.output<typeof arrangeLevelSchema>;

/** Enough for Genre → Author → Saga → Saga # → Collection → Collection # → Title → Subtitle, and a little more. */
export const ARRANGE_MAX_LEVELS = 10;

export const arrangementSchema = z
  .array(arrangeLevelSchema)
  .max(ARRANGE_MAX_LEVELS, `Use at most ${ARRANGE_MAX_LEVELS} levels`);
export type Arrangement = ArrangeLevel[];

/** Long text and people don't make sensible groups or orders. */
export function canArrangeBy(field: FieldDefinition): boolean {
  return field.type !== 'longtext' && field.type !== 'person';
}

export function arrangementIssues(
  levels: Arrangement,
  fields: FieldDefinition[],
  path: (string | number)[],
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const seen = new Set<string>();
  for (const [i, l] of levels.entries()) {
    const at = [...path, i, 'ref'];
    if (seen.has(l.ref)) issues.push({ path: at, message: 'This is already a level above' });
    seen.add(l.ref);
    if (l.ref in ARRANGE_SYSTEM_REFS) continue;
    const f = fields.find((x) => x.id === l.ref);
    if (!f) issues.push({ path: at, message: `Unknown field "${l.ref}"` });
    else if (!canArrangeBy(f)) issues.push({ path: at, message: `"${f.label}" can't be used to arrange items` });
  }
  return issues;
}

export function arrangeLabel(ref: string, fields: FieldDefinition[]): string {
  return ARRANGE_SYSTEM_REFS[ref as keyof typeof ARRANGE_SYSTEM_REFS] ?? fields.find((f) => f.id === ref)?.label ?? ref;
}

// ---------------------------------------------------------------- groups

interface Arrangeable {
  title: string;
  accession: string;
  createdAt: string;
  data: Record<string, unknown>;
}

/** The value an item is grouped by at a level: the first one for fields holding several. */
function levelValue(ref: string, item: Arrangeable): unknown {
  if (ref === '$title') return item.title;
  if (ref === '$accession') return item.accession;
  if (ref === '$added') return item.createdAt.slice(0, 10);
  const v = item.data[ref];
  return Array.isArray(v) ? v[0] : v;
}

/** Items with the same key are in the same group; null means no value. Matches the server's order. */
export function groupKey(ref: string, item: Arrangeable): string | null {
  const v = levelValue(ref, item);
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim() ? v.trim().toLowerCase() : null;
  return String(v);
}

export function groupLabel(ref: string, item: Arrangeable, fields: FieldDefinition[], ctx: FormatContext = {}): string {
  const v = levelValue(ref, item);
  if (groupKey(ref, item) === null) return `No ${arrangeLabel(ref, fields).toLowerCase()}`;
  const field = fields.find((f) => f.id === ref);
  // Fields holding several values (tags) hold text; the first one is the group.
  if (!field || Array.isArray(item.data[ref])) return String(v);
  return formatValue(field, v, ctx) || String(v);
}

export interface SectionBreak {
  /** 0 for the outermost marked level, 1 for the next marked one, and so on. */
  depth: number;
  label: string;
  newBoard: boolean;
}

/**
 * The section markers to draw before each item (in the order given), from marked levels only:
 * where a level's value changes, or a level above it changes. No marked levels, no markers.
 */
export function sectionBreaks(
  levels: Arrangement,
  items: Arrangeable[],
  fields: FieldDefinition[],
  ctx: FormatContext = {},
): SectionBreak[][] {
  const marked = levels.flatMap((l, i) => (l.marker ? [i] : []));
  if (marked.length === 0) return items.map(() => []);
  let prev: (string | null)[] | null = null;
  return items.map((item) => {
    const keys = levels.map((l) => groupKey(l.ref, item));
    const changed = prev === null ? 0 : keys.findIndex((k, i) => k !== prev?.[i]);
    prev = keys;
    if (changed < 0) return [];
    return marked
      .filter((i) => i >= changed)
      .map((i) => ({
        depth: marked.indexOf(i),
        label: groupLabel(levels[i]?.ref ?? '', item, fields, ctx),
        newBoard: levels[i]?.newBoard ?? false,
      }));
  });
}

/** Items in shelf order, as the server orders them (for previews). */
export function arrangeItems<T extends Arrangeable>(levels: Arrangement, items: T[]): T[] {
  const compare = (a: T, b: T) => {
    for (const l of levels) {
      const ka = groupKey(l.ref, a);
      const kb = groupKey(l.ref, b);
      if (ka === kb) continue;
      // Empty values go last, whichever the direction.
      if (ka === null) return 1;
      if (kb === null) return -1;
      const na = Number(ka);
      const nb = Number(kb);
      const c = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : ka.localeCompare(kb);
      if (c) return l.dir === 'desc' ? -c : c;
    }
    return a.title.localeCompare(b.title);
  };
  return [...items].sort(compare);
}

/** A collection's own arrangement, or its template's. */
export function effectiveArrangement(
  collection: { arrangement?: Arrangement | null },
  template: { shelf?: { arrange?: Arrangement } | null },
): Arrangement {
  return collection.arrangement ?? template.shelf?.arrange ?? [];
}

/** The arrangement in words: "Genre (marked, new board) → Author → Title". */
export function describeArrangement(levels: Arrangement, fields: FieldDefinition[]): string {
  return levels
    .map((l) => {
      const notes = [
        l.dir === 'desc' ? (l.ref === '$added' ? 'newest first' : 'Z–A') : null,
        l.marker ? 'marked' : null,
        l.newBoard ? 'new board' : null,
      ].filter(Boolean);
      return `${arrangeLabel(l.ref, fields)}${notes.length ? ` (${notes.join(', ')})` : ''}`;
    })
    .join(' → ');
}
