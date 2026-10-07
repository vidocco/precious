import { describe, expect, it } from 'vitest';
import {
  buildItemSchema,
  type FieldDefinition,
  fieldSchema,
  formatAccession,
  formatMinutes,
  formatRef,
  formatValue,
  searchEntries,
} from '../src/index.ts';

const fields: FieldDefinition[] = [
  { id: 'platform', label: 'Platform', type: 'choice', required: true, options: { choices: ['Switch', 'PS5'] } },
  { id: 'year', label: 'Year', type: 'number', options: { min: 1950 } },
  { id: 'value', label: 'Value', type: 'money', options: { currency: 'EUR' } },
  { id: 'main', label: 'Main story', type: 'duration' },
  { id: 'acquired', label: 'Acquired', type: 'date' },
  { id: 'played', label: 'Played', type: 'boolean' },
  { id: 'genre', label: 'Genre', type: 'tags' },
  { id: 'site', label: 'Site', type: 'url' },
  { id: 'stars', label: 'Stars', type: 'rating', options: { max: 5 } },
  { id: 'old', label: 'Old', type: 'text', hidden: true },
].map((f) => fieldSchema.parse(f));

describe('buildItemSchema', () => {
  const schema = buildItemSchema(fields);

  it('accepts valid values and drops unknown keys', () => {
    const data = schema.parse({
      platform: 'Switch',
      year: 2019,
      value: 64.5,
      main: 1410,
      acquired: '2024-11-03',
      played: true,
      genre: ['Puzzle'],
      site: 'https://example.com',
      stars: 4,
      junk: 'x',
    });
    expect(data).not.toHaveProperty('junk');
    expect(data.platform).toBe('Switch');
  });

  it('treats empty form values as missing', () => {
    const data = schema.parse({ platform: 'PS5', year: '', genre: [] });
    expect(data).not.toHaveProperty('year');
    expect(data).not.toHaveProperty('genre');
  });

  it('enforces required fields, choices, ranges and formats', () => {
    const result = schema.safeParse({ year: 1900, acquired: '03/11/2024', site: 'example', stars: 9 });
    const paths = result.error?.issues.map((i) => i.path.join('.')).sort();
    expect(paths).toEqual(['acquired', 'platform', 'site', 'stars', 'year']);
    expect(schema.safeParse({ platform: 'Dreamcast' }).success).toBe(false);
  });

  it('skips hidden fields and makes everything optional when partial', () => {
    expect(buildItemSchema(fields, { partial: true }).parse({ old: 'kept elsewhere' })).toEqual({});
  });
});

describe('formatting', () => {
  const byId = (id: string) => fields.find((f) => f.id === id) as FieldDefinition;

  it('formats values by type', () => {
    expect(formatValue(byId('value'), 64.5)).toBe('€64.50');
    expect(formatValue(byId('main'), 1410)).toBe('23½ h');
    expect(formatValue(byId('acquired'), '2024-11-03')).toBe('3 Nov 2024');
    expect(formatValue(byId('played'), false)).toBe('No');
    expect(formatValue(byId('genre'), ['Puzzle', 'Adventure'])).toBe('Puzzle, Adventure');
    expect(formatValue(byId('stars'), 4)).toBe('4 / 5');
    expect(formatValue(byId('year'), undefined)).toBe('');
    expect(formatValue(byId('year'), 2019)).toBe('2019');
  });

  it('formats durations and accession numbers', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(135)).toBe('2 h 15 min');
    expect(formatAccession('VG', 142)).toBe('VG·0142');
  });

  it('resolves system fields and template fields', () => {
    const item = {
      title: 'Lanterns of Vell',
      accession: 'VG·0142',
      createdAt: '2026-10-08T10:00:00Z',
      data: { platform: 'Switch' },
    };
    expect(formatRef('$title', item, fields)).toBe('Lanterns of Vell');
    expect(formatRef('$accession', item, fields)).toBe('VG·0142');
    expect(formatRef('platform', item, fields)).toBe('Switch');
    expect(formatRef('missing', item, fields)).toBe('');
  });

  it('lists searchable text with labels, skipping hidden fields', () => {
    const entries = searchEntries(
      { title: 'Kilnheart', accession: 'VG·0137', createdAt: '', data: { genre: ['Lantern-lit'], old: 'secret' } },
      fields,
    );
    expect(entries.map((e) => e.label)).toEqual(['Title', 'Accession number', 'Genre']);
  });
});
