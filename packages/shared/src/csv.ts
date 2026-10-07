import { z } from 'zod';
import { type FieldDefinition, SYSTEM_FIELDS } from './template.ts';
import { itemTitleSchema } from './values.ts';

/**
 * CSV for importing and exporting collections. The reader follows RFC 4180 (quotes,
 * doubled quotes, line breaks inside quotes) and works out whether the file uses
 * commas, semicolons (common in Spanish and other European spreadsheets) or tabs.
 */

export type Delimiter = ',' | ';' | '\t';

/** The separator used most on the first line, outside quotes. */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch as Delimiter]++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',') as Delimiter;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
}

export function parseCsv(input: string, delimiter?: Delimiter): ParsedCsv {
  const text = input.replace(/^﻿/, '');
  const sep = delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  const [headers = [], ...rows] = nonEmpty;
  const width = headers.length;
  return {
    headers: headers.map((h) => h.trim()),
    // Short rows are padded so every row lines up with the headers.
    rows: rows.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r)),
    delimiter: sep,
  };
}

const needsQuotes = /[",;\t\r\n]|^\s|\s$/;

export function toCsv(rows: string[][], delimiter: Delimiter = ','): string {
  return rows
    .map((r) => r.map((c) => (needsQuotes.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(delimiter))
    .join('\r\n');
}

/** A value as plain CSV text: lists joined with "; ", dates as YYYY-MM-DD, numbers without grouping. */
export function csvValue(
  field: FieldDefinition,
  value: unknown,
  personName?: (id: string) => string | undefined,
): string {
  if (value === undefined || value === null) return '';
  switch (field.type) {
    case 'tags':
    case 'multichoice':
      return Array.isArray(value) ? value.join('; ') : String(value);
    case 'boolean':
      return value === true ? 'yes' : value === false ? 'no' : '';
    case 'person':
      return typeof value === 'string' ? (personName?.(value) ?? value) : '';
    case 'number':
    case 'money':
    case 'rating':
    case 'duration':
    case 'date':
    case 'text':
    case 'longtext':
    case 'url':
    case 'choice':
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

// ---------------------------------------------------------------- import

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const TITLE_NAMES = new Set(['title', 'name', 'titulo', 'nombre', 'titre', 'titel']);
const SKIP_NAMES = new Set([norm(SYSTEM_FIELDS.$accession), 'accession', 'id']);

/**
 * Guesses what each column fills: '$title', a field id, or null (don't import). A file
 * exported from Precious maps back exactly, since its headers are the field labels.
 */
export function guessColumns(headers: string[], fields: FieldDefinition[]): (string | null)[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const n = norm(h);
    let target: string | null = null;
    if (TITLE_NAMES.has(n)) target = '$title';
    else if (!SKIP_NAMES.has(n)) {
      const f = fields.find((x) => !x.hidden && (norm(x.label) === n || norm(x.id) === n));
      target = f?.id ?? null;
    }
    if (target && used.has(target)) return null;
    if (target) used.add(target);
    return target;
  });
}

export const IMPORT_MAX_ROWS = 5000;

export const importInputSchema = z.object({
  rows: z
    .array(
      z.object({
        /** The row's line in the file, for error messages. */
        line: z.number().int().min(1),
        title: itemTitleSchema,
        data: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1, 'There are no rows to import')
    .max(IMPORT_MAX_ROWS, `Import at most ${IMPORT_MAX_ROWS} rows at a time`),
});
export type ImportInput = z.input<typeof importInputSchema>;

export interface ImportResult {
  created: number;
  firstAccession: string;
  lastAccession: string;
}
