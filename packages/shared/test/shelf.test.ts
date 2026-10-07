import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHELF,
  describeShelf,
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
});
