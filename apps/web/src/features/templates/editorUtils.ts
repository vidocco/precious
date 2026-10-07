import {
  DEFAULT_SHELF,
  type FieldDefinition,
  type FieldRef,
  type FieldType,
  type ItemDto,
  isCompatibleTypeChange,
  SYSTEM_FIELDS,
  type TemplateData,
} from '@precious/shared';

export const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  longtext: 'Long text',
  number: 'Number',
  money: 'Money',
  duration: 'Duration',
  date: 'Date',
  boolean: 'Yes / no',
  url: 'Link',
  rating: 'Rating',
  choice: 'Choice',
  multichoice: 'Several choices',
  tags: 'Tags',
  person: 'Person',
};

export function move<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(index, 1);
  next.splice(to, 0, x as T);
  return next;
}

/** Types a field may switch to: anything for a new field, compatible ones for a saved field. */
export function allowedTypes(saved?: FieldDefinition): FieldType[] {
  const all = Object.keys(TYPE_LABELS) as FieldType[];
  return saved ? all.filter((t) => isCompatibleTypeChange(saved.type, t)) : all;
}

export function refOptions(fields: FieldDefinition[]): { value: FieldRef; label: string }[] {
  return [
    ...(Object.entries(SYSTEM_FIELDS) as [FieldRef, string][]).map(([value, label]) => ({ value, label })),
    ...fields.filter((f) => !f.hidden).map((f) => ({ value: f.id, label: f.label })),
  ];
}

function sampleValue(f: FieldDefinition): unknown {
  switch (f.type) {
    case 'text':
      return f.label;
    case 'longtext':
      return `Some notes for ${f.label.toLowerCase()} would go here.`;
    case 'number':
      return 2019;
    case 'money':
      return 64.5;
    case 'duration':
      return 1410;
    case 'date':
      return '2024-11-03';
    case 'boolean':
      return true;
    case 'url':
      return 'https://example.com';
    case 'rating':
      return Math.min(4, f.options.max ?? 5);
    case 'choice':
      return f.options.choices?.[0];
    case 'multichoice':
      return f.options.choices?.slice(0, 2);
    case 'tags':
      return ['First tag', 'Second'];
    case 'person':
      return undefined;
  }
}

/** A made-up item for previews, filled with plausible values for every field. */
export function sampleItem(t: TemplateData, title = 'Example item', n = 1): ItemDto {
  return {
    id: `sample-${n}`,
    collectionId: 'sample',
    accessionNo: n,
    accession: `${t.accessionPrefix}·${String(n).padStart(4, '0')}`,
    title,
    cover: null,
    data: Object.fromEntries(t.fields.filter((f) => !f.hidden).map((f) => [f.id, sampleValue(f)])),
    fieldMeta: {},
    externalRefs: {},
    createdBy: null,
    createdByName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export const EMPTY_TEMPLATE: TemplateData = {
  name: '',
  description: '',
  icon: 'grid',
  accessionPrefix: 'IT',
  fields: [],
  card: { slots: { tl: null, tr: '$accession', b: null }, lines: [{ fields: ['$title'], style: 'title' }] },
  itemLayout: { info: ['$added'], sections: [] },
  header: { figures: [{ id: 'count', kind: 'count', label: 'Items' }] },
  bindings: { search: [], steps: [], computed: [] },
  shelf: DEFAULT_SHELF,
};
