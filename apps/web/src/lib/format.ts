import {
  type FieldDefinition,
  type FieldRef,
  type FigureValue,
  formatMinutes,
  formatRef,
  type ItemDto,
  SYSTEM_FIELDS,
} from '@precious/shared';

export const LOCALE = 'en-IE';

export function refValue(ref: FieldRef, item: ItemDto, fields: FieldDefinition[], collectionName?: string) {
  return formatRef(ref, { ...item, collectionName }, fields, { locale: LOCALE });
}

export function refLabel(ref: FieldRef, fields: FieldDefinition[]): string {
  if (ref in SYSTEM_FIELDS) return SYSTEM_FIELDS[ref as keyof typeof SYSTEM_FIELDS];
  return fields.find((f) => f.id === ref)?.label ?? ref;
}

export function formatFigure(f: FigureValue): string {
  if (f.value === null) return '–';
  switch (f.format) {
    case 'money':
      return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: f.currency ?? 'EUR' }).format(f.value);
    case 'duration':
      return formatMinutes(Math.round(f.value));
    case 'count':
      return new Intl.NumberFormat(LOCALE).format(f.value);
    default: {
      const n = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(f.value);
      return f.unit ? `${n} ${f.unit}` : n;
    }
  }
}

/** Turns a «matched» snippet from the API into text + highlighted parts. */
export function splitSnippet(snippet: string): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = [];
  const re = /«([^»]*)»/g;
  let last = 0;
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), mark: false });
    parts.push({ text: m[1] ?? '', mark: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), mark: false });
  return parts;
}
