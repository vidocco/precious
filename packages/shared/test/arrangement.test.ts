import { describe, expect, it } from 'vitest';
import {
  type Arrangement,
  arrangeItems,
  arrangementSchema,
  describeArrangement,
  effectiveArrangement,
  type FieldDefinition,
  fieldSchema,
  groupKey,
  sectionBreaks,
  shelfSchema,
  templateInputSchema,
} from '../src/index.ts';

const fields: FieldDefinition[] = [
  fieldSchema.parse({ id: 'genre', label: 'Genre', type: 'tags' }),
  fieldSchema.parse({ id: 'author', label: 'Author', type: 'text' }),
  fieldSchema.parse({ id: 'series', label: 'Series', type: 'text' }),
  fieldSchema.parse({ id: 'series_no', label: 'Series number', type: 'number' }),
  fieldSchema.parse({ id: 'notes', label: 'Notes', type: 'longtext' }),
];

let n = 0;
const book = (title: string, data: Record<string, unknown>) => ({
  title,
  accession: `BK·${String(++n).padStart(4, '0')}`,
  createdAt: '2026-10-08T10:00:00.000Z',
  data,
});

// Already in shelf order, as the server returns them.
const books = [
  book('A Wizard of Earthsea', { genre: ['Fantasy'], author: 'Le Guin', series: 'Earthsea', series_no: 1 }),
  book('The Tombs of Atuan', {
    genre: ['Fantasy', 'Young adult'],
    author: 'le guin ',
    series: 'Earthsea',
    series_no: 2,
  }),
  book('The Hobbit', { genre: ['Fantasy'], author: 'Tolkien' }),
  book('Kindred', { genre: ['Science fiction'], author: 'Butler' }),
  book('Dune', { genre: ['Science fiction'], author: 'Herbert', series: 'Dune', series_no: 1 }),
  book('Untitled notebook', { author: 'Me' }),
];

const levels = (spec: [string, boolean?, boolean?][]): Arrangement =>
  arrangementSchema.parse(spec.map(([ref, marker = false, newBoard = false]) => ({ ref, marker, newBoard })));

const labels = (breaks: { label: string; depth: number }[][]) =>
  breaks.map((b) => b.map((x) => `${'  '.repeat(x.depth)}${x.label}`));

describe('arrangement schema', () => {
  it('defaults each level to ascending, unmarked', () => {
    expect(arrangementSchema.parse([{ ref: 'genre' }])).toEqual([
      { ref: 'genre', dir: 'asc', marker: false, newBoard: false },
    ]);
    expect(shelfSchema.parse({}).arrange).toEqual([]);
  });

  it('takes up to 10 levels', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ref: `field_${i}` }));
    expect(arrangementSchema.safeParse(many(10)).success).toBe(true);
    expect(arrangementSchema.safeParse(many(11)).error?.issues[0]?.message).toBe('Use at most 10 levels');
  });

  it('only starts a new board for a marked level', () => {
    expect(arrangementSchema.safeParse([{ ref: 'genre', newBoard: true }]).success).toBe(false);
    expect(arrangementSchema.safeParse([{ ref: 'genre', marker: true, newBoard: true }]).success).toBe(true);
  });

  it('rejects unknown fields, long text and repeated levels in a template', () => {
    const t = (arrange: unknown) => templateInputSchema.safeParse({ name: 'T', fields, shelf: { arrange } });
    expect(t([{ ref: 'genre' }, { ref: '$title' }]).success).toBe(true);
    const issues = (arrange: unknown) => t(arrange).error?.issues.map((i) => i.path.join('.'));
    expect(issues([{ ref: 'nope' }])).toEqual(['shelf.arrange.0.ref']);
    expect(issues([{ ref: 'notes' }])).toEqual(['shelf.arrange.0.ref']);
    expect(issues([{ ref: 'author' }, { ref: 'author' }])).toEqual(['shelf.arrange.1.ref']);
  });

  it('uses a collection’s own order over its template’s, and none when neither has one', () => {
    const own = levels([['author']]);
    const tpl = levels([['genre']]);
    expect(effectiveArrangement({ arrangement: own }, { shelf: { arrange: tpl } })).toBe(own);
    expect(effectiveArrangement({ arrangement: null }, { shelf: { arrange: tpl } })).toBe(tpl);
    // Saved before shelf orders existed.
    expect(effectiveArrangement({}, { shelf: {} })).toEqual([]);
    expect(effectiveArrangement({ arrangement: null }, { shelf: null })).toEqual([]);
  });
});

describe('section markers', () => {
  it('shows none when nothing arranges the shelf', () => {
    expect(sectionBreaks([], books, fields).flat()).toEqual([]);
  });

  it('shows none when no level is marked, however many levels group the items', () => {
    const l = levels([['genre'], ['author'], ['series'], ['series_no'], ['$title']]);
    expect(sectionBreaks(l, books, fields).flat()).toEqual([]);
  });

  it('marks only the levels that ask for it', () => {
    const l = levels([['genre', true], ['author'], ['series'], ['$title']]);
    expect(labels(sectionBreaks(l, books, fields))).toEqual([
      ['Fantasy'],
      [],
      [],
      ['Science fiction'],
      [],
      // No genre at a marked level: one closing marker, so it isn't read as more science fiction.
      ['No genre'],
    ]);
  });

  it('restarts inner markers in each outer group, and ignores case and spaces in values', () => {
    const l = levels([['genre', true, true], ['author', true], ['$title']]);
    const b = sectionBreaks(l, books, fields);
    expect(labels(b)).toEqual([
      ['Fantasy', '  Le Guin'],
      // "le guin " is the same author.
      [],
      ['  Tolkien'],
      ['Science fiction', '  Butler'],
      ['  Herbert'],
      ['No genre', '  Me'],
    ]);
    expect(b[3]?.[0]?.newBoard).toBe(true);
    expect(b[3]?.[1]?.newBoard).toBe(false);
  });

  it('marks an inner level alone, without a marker for the outer one', () => {
    const l = levels([['genre'], ['author', true]]);
    expect(labels(sectionBreaks(l, books, fields))).toEqual([
      ['Le Guin'],
      [],
      ['Tolkien'],
      ['Butler'],
      ['Herbert'],
      ['Me'],
    ]);
  });

  it('gives no closing marker for empty values at an unmarked level', () => {
    const l = levels([['genre', true], ['series']]);
    expect(labels(sectionBreaks(l, books, fields)).flat()).toEqual(['Fantasy', 'Science fiction', 'No genre']);
  });
});

describe('"No section" markers', () => {
  const shelfFields: FieldDefinition[] = [
    fieldSchema.parse({ id: 'genre', label: 'Genre', type: 'text' }),
    fieldSchema.parse({ id: 'saga', label: 'Saga', type: 'text' }),
    fieldSchema.parse({ id: 'coll', label: 'Collection', type: 'text' }),
  ];
  const b = (title: string, genre?: string, saga?: string, coll?: string) =>
    book(title, { ...(genre && { genre }), ...(saga && { saga }), ...(coll && { coll }) });
  const l = levels([['genre', true], ['saga', true], ['coll', true], ['$title']]);

  it('only show where other groups share the place, as in the Genre / Saga / Collection example', () => {
    // In shelf order: empty values last at each level.
    const shelf = [
      b('Book A', 'Genre A', 'Saga A', 'Collection A'),
      b('Book B', 'Genre A', 'Saga A', 'Collection B'),
      b('Book C', 'Genre A'),
      b('Book A', 'Genre B', undefined, 'Collection A'),
      b('Book B', 'Genre B', undefined, 'Collection B'),
      b('Book C', 'Genre B'),
      b('Book A', 'Genre C'),
      b('Book B', 'Genre C'),
      b('Book C', 'Genre C'),
      b('Book D'),
    ];
    expect(labels(sectionBreaks(l, shelf, shelfFields))).toEqual([
      ['Genre A', '  Saga A', '    Collection A'],
      ['    Collection B'],
      // Saga A came before it in Genre A; no collection in Genre A without a saga.
      ['  No saga'],
      // No saga anywhere in Genre B, so no saga marker at all.
      ['Genre B', '    Collection A'],
      ['    Collection B'],
      ['    No collection'],
      // Neither sagas nor collections in Genre C.
      ['Genre C'],
      [],
      [],
      // Other genres exist; nothing to tell apart below it.
      ['No genre'],
    ]);
  });

  it('show none when nothing at all has a value at a level', () => {
    const shelf = [b('One'), b('Two')];
    expect(sectionBreaks(l, shelf, shelfFields).flat()).toEqual([]);
  });

  it('carry each level’s marker style', () => {
    const styled = arrangementSchema.parse([
      { ref: 'genre', marker: true, newBoard: true, markerStyle: { width: 6, height: 2.5, color: '#2e5e4e' } },
      { ref: 'saga', marker: true },
    ]);
    const [first] = sectionBreaks(styled, [b('Book A', 'Genre A', 'Saga A')], shelfFields);
    expect(first).toEqual([
      { depth: 0, label: 'Genre A', newBoard: true, style: { width: 6, height: 2.5, color: '#2e5e4e' } },
      { depth: 1, label: 'Saga A', newBoard: false },
    ]);
  });

  it('check marker sizes and colours', () => {
    const style = (markerStyle: unknown) =>
      arrangementSchema.safeParse([{ ref: 'genre', marker: true, markerStyle }]).success;
    expect(style({})).toBe(true);
    expect(style({ width: 0.8, height: 25, color: '#C8462B' })).toBe(true);
    expect(style({ width: 0 })).toBe(false);
    expect(style({ height: 100 })).toBe(false);
    expect(style({ color: 'red' })).toBe(false);
  });
});

describe('group keys and order', () => {
  it('groups by the first of several values, and treats blanks as empty', () => {
    expect(groupKey('genre', books[1] as (typeof books)[number])).toBe('fantasy');
    expect(groupKey('series', book('x', { series: '  ' }))).toBeNull();
    expect(groupKey('genre', book('x', { genre: [] }))).toBeNull();
    expect(groupKey('series_no', book('x', { series_no: 2 }))).toBe('2');
  });

  it('orders a preview like the server: levels in turn, empty last, then title', () => {
    const shuffled = [...books].reverse();
    const l = levels([['genre'], ['series_no', false]]);
    expect(arrangeItems(l, shuffled).map((b) => b.title)).toEqual([
      'A Wizard of Earthsea',
      'The Tombs of Atuan',
      'The Hobbit',
      'Dune',
      'Kindred',
      'Untitled notebook',
    ]);
  });

  it('describes the order in words', () => {
    const l = arrangementSchema.parse([
      { ref: 'genre', marker: true, newBoard: true },
      { ref: 'author', marker: true },
      { ref: 'series_no', dir: 'desc' },
      { ref: '$title' },
    ]);
    expect(describeArrangement(l, fields)).toBe(
      'Genre (marked, new board) → Author (marked) → Series number (Z–A) → Title',
    );
  });
});
