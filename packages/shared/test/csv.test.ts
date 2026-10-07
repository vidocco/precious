import { describe, expect, it } from 'vitest';
import { csvValue, detectDelimiter, fieldSchema, guessColumns, parseCsv, toCsv } from '../src/index.ts';

const f = (x: Record<string, unknown>) => fieldSchema.parse({ label: x.id, ...x });

describe('parseCsv', () => {
  it('reads quotes, doubled quotes and line breaks inside quotes', () => {
    const csv = 'Title,Notes\r\n"Dune","He said ""spice""\nand left"\r\nKindred,plain\r\n';
    expect(parseCsv(csv)).toEqual({
      headers: ['Title', 'Notes'],
      rows: [
        ['Dune', 'He said "spice"\nand left'],
        ['Kindred', 'plain'],
      ],
      delimiter: ',',
    });
  });

  it('works out the separator, drops a BOM and blank lines, and pads short rows', () => {
    expect(detectDelimiter('Título;Autor;"Año, primera"\n')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    const parsed = parseCsv('﻿Título;Autor;Año\n\nRayuela;Cortázar\n;;\n');
    expect(parsed.headers).toEqual(['Título', 'Autor', 'Año']);
    expect(parsed.rows).toEqual([['Rayuela', 'Cortázar', '']]);
  });

  it('writes what it reads', () => {
    const rows = [
      ['Title', 'Notes'],
      ['A; B', 'quote " here'],
      ['multi\nline', ' padded'],
    ];
    expect(parseCsv(toCsv(rows)).rows).toEqual(rows.slice(1));
  });
});

describe('csvValue and guessColumns', () => {
  it('writes values plainly', () => {
    expect(csvValue(f({ id: 'g', type: 'tags' }), ['RPG', 'Indie'])).toBe('RPG; Indie');
    expect(csvValue(f({ id: 'b', type: 'boolean' }), true)).toBe('yes');
    expect(csvValue(f({ id: 'p', type: 'money' }), 1299.9)).toBe('1299.9');
    expect(csvValue(f({ id: 'u', type: 'person' }), 'u1', () => 'Marta')).toBe('Marta');
    expect(csvValue(f({ id: 't', type: 'text' }), undefined)).toBe('');
  });

  it('matches columns to fields by label or id, title by common names', () => {
    const fields = [
      f({ id: 'author', label: 'Author', type: 'text' }),
      f({ id: 'year_bought', label: 'Year bought', type: 'number' }),
      f({ id: 'old', label: 'Old', type: 'text', hidden: true }),
    ];
    expect(
      guessColumns(['Accession number', 'Título', 'AUTHOR', 'year_bought', 'Old', 'Author', 'Notes'], fields),
    ).toEqual([null, '$title', 'author', 'year_bought', null, null, null]);
  });
});
