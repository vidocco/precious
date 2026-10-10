import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHELF,
  describeShelf,
  fieldSchema,
  type Shelf,
  STARTER_TEMPLATES,
  shelfSchema,
  spineSize,
  templateInputSchema,
} from '../src/index.ts';

const starter = (name: string) => templateInputSchema.parse(STARTER_TEMPLATES.find((t) => t.name === name));

describe('spineSize', () => {
  it('measures books from pages and height, with fallbacks', () => {
    const books = starter('Books');
    expect(spineSize(books.shelf, { data: { pages: 304, height_cm: 17.8 } })).toEqual({
      thickness: 1.82,
      height: 17.8,
      lean: false,
    });
    expect(spineSize(books.shelf, { data: {} })).toEqual({ thickness: 2.5, height: 21, lean: false });
    expect(spineSize(books.shelf, { data: { status: 'reading' } }).lean).toBe(true);
  });

  it('sizes games by platform, and falls back for other platforms', () => {
    const games = starter('Video games');
    expect(spineSize(games.shelf, { data: { platform: 'Switch', status: 'Playing' } })).toEqual({
      thickness: 1.1,
      height: 17,
      lean: true,
    });
    expect(spineSize(games.shelf, { data: { platform: 'PS5' } })).toMatchObject({ thickness: 1.4, height: 17 });
    expect(spineSize(games.shelf, { data: { platform: 'Game Boy' } })).toMatchObject({ thickness: 1.4, height: 19 });
  });

  it('keeps sizes believable and handles lists and yes/no leans', () => {
    const s: Shelf = shelfSchema.parse({
      thickness: { field: 'pages', factor: 1, add: 0, fallback: 1 },
      height: { field: 'pages', fallback: 20 },
      lean: { field: 'played', equals: true },
    });
    expect(spineSize(s, { data: { pages: 4000, played: true } })).toEqual({ thickness: 15, height: 60, lean: true });
    expect(spineSize(s, { data: { pages: 0 } })).toMatchObject({ thickness: 0.2, lean: false });
    const rules = shelfSchema.parse({
      by: 'rules',
      rulesField: 'formats',
      rules: [{ values: ['LP'], thickness: 0.4, height: 31.4 }],
    });
    expect(spineSize(rules, { data: { formats: ['CD', 'lp'] } })).toMatchObject({ thickness: 0.4 });
  });

  it('sets one size by a field’s value and measures the other', () => {
    const s: Shelf = shelfSchema.parse({
      by: 'rules',
      rulesField: 'size',
      rules: [{ values: ['Large'], thickness: 9, height: 20 }],
      otherwise: { thickness: 9, height: 18 },
      thickness: { field: 'pages', factor: 0.005, add: 0.3, fallback: 2.5 },
      measured: ['thickness'],
    });
    expect(spineSize(s, { data: { size: 'large', pages: 300 } })).toMatchObject({ thickness: 1.8, height: 20 });
    expect(spineSize(s, { data: { size: 'Pocket', pages: 100 } })).toMatchObject({ thickness: 0.8, height: 18 });
    expect(spineSize(s, { data: {} })).toMatchObject({ thickness: 2.5, height: 18 });
    // And the other way round: the thickness by value, the height the same for every item.
    const other = shelfSchema.parse({ ...s, height: { field: null, fallback: 24 }, measured: ['height'] });
    expect(spineSize(other, { data: { size: 'Large', pages: 300 } })).toMatchObject({ thickness: 9, height: 24 });
  });
});

describe('shelf settings', () => {
  it('describes the rule in words', () => {
    const books = starter('Books');
    expect(describeShelf(books.shelf, books.fields)).toBe(
      'Thickness from Pages × 0.005 + 0.3 cm · height from Height · leans when Status is Reading',
    );
    expect(describeShelf(starter('Vinyl').shelf, [])).toBe('Every item 0.4 × 31.4 cm');
    expect(describeShelf(starter('Video games').shelf, starter('Video games').fields)).toMatch(
      /^Size by Platform: Switch\/Switch 2 1\.1 × 17 cm · .* · others 1\.4 × 19 cm · leans when Status is Playing$/,
    );
    const mixed = shelfSchema.parse({
      ...books.shelf,
      by: 'rules',
      rulesField: 'format',
      rules: [{ values: ['Hardcover'], thickness: 3, height: 24 }],
      otherwise: { thickness: 3, height: 18 },
      measured: ['thickness'],
      lean: null,
    });
    expect(
      describeShelf(mixed, [...books.fields, fieldSchema.parse({ id: 'format', label: 'Format', type: 'choice' })]),
    ).toBe('Height by Format: Hardcover 24 cm · others 18 cm · thickness from Pages × 0.005 + 0.3 cm');
  });

  it('checks field references and defaults to a fixed size', () => {
    expect(templateInputSchema.parse({ name: 'X' }).shelf).toEqual(DEFAULT_SHELF);
    const bad = templateInputSchema.safeParse({
      name: 'X',
      fields: [{ id: 'title_note', label: 'Note', type: 'text' }],
      shelf: { thickness: { field: 'title_note', fallback: 1 }, lean: { field: 'gone', equals: 'x' } },
    });
    expect(bad.error?.issues.map((i) => i.path.join('.'))).toEqual(['shelf.thickness.field', 'shelf.lean.field']);
  });

  it('checks the fields of measured sizes only, and leaves older shelves as they were', () => {
    const fields = [
      { id: 'format', label: 'Format', type: 'text' },
      { id: 'pages', label: 'Pages', type: 'number' },
    ];
    const shelf = (extra: object) => ({
      by: 'rules',
      rulesField: 'format',
      thickness: { field: 'format', fallback: 1 },
      height: { field: 'pages', fallback: 20 },
      ...extra,
    });
    const paths = (extra: object) =>
      templateInputSchema
        .safeParse({ name: 'X', fields, shelf: shelf(extra) })
        .error?.issues.map((i) => i.path.join('.'));
    // Both by the rules (as every shelf was before sizes could be measured on their own): no checks.
    expect(paths({})).toBeUndefined();
    expect(paths({ measured: ['height'] })).toBeUndefined();
    expect(paths({ measured: ['thickness'] })).toEqual(['shelf.thickness.field']);
    expect(shelfSchema.parse(shelf({})).measured).toBeUndefined();
    expect(shelfSchema.safeParse(shelf({ measured: ['width'] })).success).toBe(false);
  });
});
