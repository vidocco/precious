import { z } from 'zod';

/**
 * A template describes one kind of collection: its fields and how items are
 * laid out on cards, on the item page and in the collection header.
 * Collections are linked to a template, so editing it updates all of them.
 */

export const FIELD_TYPES = [
  'text',
  'longtext',
  'number',
  'money',
  'duration',
  'date',
  'boolean',
  'url',
  'rating',
  'choice',
  'multichoice',
  'tags',
  'person',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Field ids are the keys inside an item's data, so they never change once created. */
export const fieldIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'Use lowercase letters, digits and _');

export const fieldSchema = z.object({
  id: fieldIdSchema,
  label: z.string().trim().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  /** Deleted fields are hidden rather than erased, so their values can come back. */
  hidden: z.boolean().default(false),
  help: z.string().max(200).optional(),
  options: z
    .object({
      choices: z.array(z.string().trim().min(1).max(60)).max(200).optional(),
      currency: z.string().length(3).optional(),
      unit: z.string().max(12).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .default({}),
});

export type FieldDefinition = z.infer<typeof fieldSchema>;
export type FieldDefinitionInput = z.input<typeof fieldSchema>;

/** Values that are not template fields but can be shown on cards and pages. */
export const SYSTEM_FIELDS = {
  $title: 'Title',
  $accession: 'Accession number',
  $added: 'Date added',
  $collection: 'Collection',
} as const;

export type SystemFieldRef = keyof typeof SYSTEM_FIELDS;

/** A reference to a template field id or a system field such as `$title`. */
export const fieldRefSchema = z.union([fieldIdSchema, z.enum(Object.keys(SYSTEM_FIELDS) as [SystemFieldRef])]);
export type FieldRef = z.infer<typeof fieldRefSchema>;

export const LINE_STYLES = ['title', 'normal', 'muted', 'value'] as const;

export const cardLayoutSchema = z.object({
  slots: z
    .object({
      tl: fieldRefSchema.nullable().default(null),
      tr: fieldRefSchema.nullable().default(null),
      b: fieldRefSchema.nullable().default(null),
    })
    .default({ tl: null, tr: null, b: null }),
  lines: z
    .array(
      z.object({
        fields: z.array(fieldRefSchema).min(1).max(4),
        style: z.enum(LINE_STYLES).default('normal'),
        prefix: z.string().max(30).optional(),
      }),
    )
    .max(4)
    .default([{ fields: ['$title'], style: 'title' }]),
});

export type CardLayout = z.infer<typeof cardLayoutSchema>;

export const SECTION_TYPES = ['fields', 'text'] as const;

export const itemLayoutSchema = z.object({
  /** Fields shown in the info box beside the cover. */
  info: z.array(fieldRefSchema).max(24).default([]),
  /** Sections shown below the cover and info box, in order. */
  sections: z
    .array(
      z.object({
        id: z.string().min(1).max(32),
        type: z.enum(SECTION_TYPES),
        title: z.string().trim().min(1).max(60),
        fields: z.array(fieldRefSchema).min(1).max(24),
        wide: z.boolean().default(false),
      }),
    )
    .max(12)
    .default([]),
});

export type ItemLayout = z.infer<typeof itemLayoutSchema>;

export const figureSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().min(1).max(32), kind: z.literal('count'), label: z.string().min(1).max(40) }),
  z.object({
    id: z.string().min(1).max(32),
    kind: z.enum(['sum', 'avg']),
    label: z.string().min(1).max(40),
    field: fieldIdSchema,
  }),
  z.object({
    id: z.string().min(1).max(32),
    kind: z.literal('countWhere'),
    label: z.string().min(1).max(40),
    field: fieldIdSchema,
    equals: z.union([z.string(), z.boolean()]),
  }),
]);

export type Figure = z.infer<typeof figureSchema>;

export const headerSchema = z.object({
  figures: z.array(figureSchema).max(6).default([]),
});

export type HeaderLayout = z.infer<typeof headerSchema>;

export const templateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(300).default(''),
    icon: z.string().max(32).default('grid'),
    accessionPrefix: z
      .string()
      .regex(/^[A-Z0-9]{1,4}$/, 'Up to 4 capital letters or digits')
      .default('IT'),
    fields: z.array(fieldSchema).max(80).default([]),
    card: cardLayoutSchema.default({ slots: { tl: null, tr: null, b: null }, lines: [] }),
    itemLayout: itemLayoutSchema.default({ info: [], sections: [] }),
    header: headerSchema.default({ figures: [] }),
  })
  .superRefine((t, ctx) => {
    const ids = new Set<string>();
    for (const [i, f] of t.fields.entries()) {
      if (ids.has(f.id))
        ctx.addIssue({ code: 'custom', path: ['fields', i, 'id'], message: `Duplicate field id "${f.id}"` });
      ids.add(f.id);
      if ((f.type === 'choice' || f.type === 'multichoice') && !f.options.choices?.length) {
        ctx.addIssue({ code: 'custom', path: ['fields', i, 'options', 'choices'], message: 'Add at least one choice' });
      }
    }
    const known = (ref: string) => ref.startsWith('$') || ids.has(ref);
    const check = (ref: string | null, path: (string | number)[]) => {
      if (ref && !known(ref)) ctx.addIssue({ code: 'custom', path, message: `Unknown field "${ref}"` });
    };
    for (const slot of ['tl', 'tr', 'b'] as const) check(t.card.slots[slot], ['card', 'slots', slot]);
    t.card.lines.forEach((l, i) => {
      l.fields.forEach((r, j) => check(r, ['card', 'lines', i, 'fields', j]));
    });
    t.itemLayout.info.forEach((r, i) => check(r, ['itemLayout', 'info', i]));
    t.itemLayout.sections.forEach((s, i) => {
      s.fields.forEach((r, j) => check(r, ['itemLayout', 'sections', i, 'fields', j]));
    });
    t.header.figures.forEach((f, i) => {
      if (f.kind === 'count') return;
      const field = t.fields.find((x) => x.id === f.field);
      if (!field) {
        ctx.addIssue({
          code: 'custom',
          path: ['header', 'figures', i, 'field'],
          message: `Unknown field "${f.field}"`,
        });
      } else if ((f.kind === 'sum' || f.kind === 'avg') && !isNumericType(field.type)) {
        ctx.addIssue({
          code: 'custom',
          path: ['header', 'figures', i, 'field'],
          message: `"${field.label}" is not a number, so it can't be summed`,
        });
      }
    });
  });

export type TemplateInput = z.input<typeof templateInputSchema>;
export type TemplateData = z.output<typeof templateInputSchema>;

export function isNumericType(type: FieldType): boolean {
  return type === 'number' || type === 'money' || type === 'duration' || type === 'rating';
}

/** Type changes that keep existing values valid. Anything else must be a new field. */
const COMPATIBLE: Partial<Record<FieldType, FieldType[]>> = {
  text: ['longtext', 'url', 'choice'],
  longtext: ['text'],
  url: ['text', 'longtext'],
  number: ['money', 'rating', 'duration'],
  money: ['number'],
  rating: ['number'],
  duration: ['number'],
  choice: ['text', 'multichoice'],
  multichoice: ['tags'],
  tags: ['multichoice'],
};

export function isCompatibleTypeChange(from: FieldType, to: FieldType): boolean {
  return from === to || (COMPATIBLE[from]?.includes(to) ?? false);
}

/**
 * Checks an edit of a template against its previous version. Field ids must be kept
 * (removing a field hides it), and type changes must keep stored values valid.
 */
export function diffTemplateFields(before: FieldDefinition[], after: FieldDefinition[]): string[] {
  const problems: string[] = [];
  const next = new Map(after.map((f) => [f.id, f]));
  for (const old of before) {
    const f = next.get(old.id);
    if (!f) {
      problems.push(`Field "${old.label}" was removed. Hide it instead so its values are kept.`);
    } else if (!isCompatibleTypeChange(old.type, f.type)) {
      problems.push(`"${old.label}" can't change from ${old.type} to ${f.type}. Add a new field instead.`);
    }
  }
  return problems;
}

/** Makes a field id from a label, avoiding ids already taken. */
export function makeFieldId(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+|_+$/g, '')
      .slice(0, 28) || 'field';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  return id;
}
