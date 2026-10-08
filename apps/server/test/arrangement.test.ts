import type { CollectionDto, ItemListResponse, TemplateDto } from '@precious/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collections, templates } from '../src/db/schema.ts';
import { Client, setupHousehold, startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';

describe.runIf(TEST_DATABASE_URL)('shelf order', () => {
  let server: TestServer;
  let admin: Client;
  let template: TemplateDto;
  let collection: CollectionDto;

  const inputOf = (t: TemplateDto) => {
    const { id: _i, createdBy: _c, version: _v, createdAt: _ca, updatedAt: _u, usage: _us, canEdit: _ce, ...input } = t;
    return input;
  };
  const titles = async (query = '') =>
    (
      await admin.get<ItemListResponse>(`/api/collections/${collection.id}/items?sort=$arranged${query}`)
    ).body.items.map((i) => i.title);

  beforeAll(async () => {
    server = await startTestServer();
    ({ admin } = await setupHousehold(server.app));
    template = (
      await admin.post<TemplateDto>('/api/templates', {
        name: 'Library',
        accessionPrefix: 'LB',
        fields: [
          { id: 'genre', label: 'Genre', type: 'tags' },
          { id: 'author', label: 'Author', type: 'text' },
          { id: 'series', label: 'Series', type: 'text' },
          { id: 'series_no', label: 'Series number', type: 'number' },
          { id: 'notes', label: 'Notes', type: 'longtext' },
        ],
      })
    ).body;
    collection = (await admin.post<CollectionDto>('/api/collections', { templateId: template.id, name: 'Library' }))
      .body;
    for (const [title, data] of [
      ['Dune Messiah', { genre: ['Science fiction'], author: 'Herbert', series: 'Dune', series_no: 2 }],
      ['Untitled notebook', { author: 'Zamora' }],
      ['Dune', { genre: ['Science fiction'], author: 'Herbert', series: 'Dune', series_no: 1 }],
      [
        'The Tombs of Atuan',
        { genre: ['fantasy', 'Young adult'], author: 'Le Guin', series: 'Earthsea', series_no: 2 },
      ],
      ['Ficciones', { genre: ['Fantasy'], author: 'Borges' }],
      ['A Wizard of Earthsea', { genre: ['Fantasy'], author: 'Le Guin', series: 'Earthsea', series_no: 1 }],
      ['Kindred', { genre: ['Science fiction'], author: 'Butler' }],
      ['Historia de la eternidad', { genre: ['Fantasy'], author: 'Álvarez' }],
    ] as const) {
      await admin.post(`/api/collections/${collection.id}/items`, { title, data });
    }
  });
  afterAll(async () => {
    await server?.close();
  });

  it('is newest first while the template has no shelf order', async () => {
    expect(template.shelf.arrange).toEqual([]);
    expect((await titles())[0]).toBe('Historia de la eternidad');
  });

  it('orders by each level in turn, accents where readers expect them, empty values last', async () => {
    const res = await admin.put<TemplateDto>(`/api/templates/${template.id}`, {
      ...inputOf(template),
      shelf: {
        ...template.shelf,
        arrange: [
          { ref: 'genre', marker: true, newBoard: true },
          { ref: 'author', marker: true },
          { ref: 'series' },
          { ref: 'series_no' },
          { ref: '$title' },
        ],
      },
    });
    expect(res.status).toBe(200);
    template = res.body;
    expect(await titles()).toEqual([
      // Fantasy (the first of several genres; case doesn't split groups), Álvarez before Borges.
      'Historia de la eternidad',
      'Ficciones',
      'A Wizard of Earthsea',
      'The Tombs of Atuan',
      'Kindred',
      'Dune',
      'Dune Messiah',
      // No genre.
      'Untitled notebook',
    ]);
  });

  it('keeps the order across pages', async () => {
    const all = await titles();
    const pages = [
      ...(await titles('&limit=3')),
      ...(await titles('&limit=3&offset=3')),
      ...(await titles('&limit=3&offset=6')),
    ];
    expect(pages).toEqual(all);
  });

  it('follows each level’s direction', async () => {
    const res = await admin.patch<CollectionDto>(`/api/collections/${collection.id}`, {
      arrangement: [{ ref: 'series_no', dir: 'desc' }, { ref: '$title' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.arrangement).toEqual([
      { ref: 'series_no', dir: 'desc', marker: false, newBoard: false },
      { ref: '$title', dir: 'asc', marker: false, newBoard: false },
    ]);
    // A collection's own order wins; numbers high to low, those without one last, by title.
    expect(await titles()).toEqual([
      'Dune Messiah',
      'The Tombs of Atuan',
      'A Wizard of Earthsea',
      'Dune',
      'Ficciones',
      'Historia de la eternidad',
      'Kindred',
      'Untitled notebook',
    ]);
  });

  it('goes back to the template’s order when the collection’s is cleared', async () => {
    const res = await admin.patch<CollectionDto>(`/api/collections/${collection.id}`, { arrangement: null });
    expect(res.body.arrangement).toBeNull();
    expect((await titles())[0]).toBe('Historia de la eternidad');
  });

  it('refuses orders by fields the collection doesn’t have, or can’t be ordered by', async () => {
    const bad = await admin.patch<{ issues: { path: string }[] }>(`/api/collections/${collection.id}`, {
      arrangement: [{ ref: 'nope' }, { ref: 'notes' }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.issues.map((i) => i.path)).toEqual(['arrangement.0.ref', 'arrangement.1.ref']);
    const noMarker = await admin.patch(`/api/collections/${collection.id}`, {
      arrangement: [{ ref: 'genre', newBoard: true }],
    });
    expect(noMarker.status).toBe(400);
  });

  it('still serves data saved before shelf orders existed', async () => {
    const { db } = server.database;
    // As 1.0.0 left them: a shelf without `arrange`, a collection with no arrangement.
    const { arrange: _a, ...oldShelf } = template.shelf;
    await db
      .update(templates)
      .set({ shelf: oldShelf as TemplateDto['shelf'] })
      .where(eq(templates.id, template.id));
    await db.update(collections).set({ arrangement: null }).where(eq(collections.id, collection.id));
    expect((await admin.get<CollectionDto>(`/api/collections/${collection.id}`)).body.arrangement).toBeNull();
    // Shelf order asked for, but there is none: newest first.
    expect((await titles())[0]).toBe('Historia de la eternidad');
    const stored = (await admin.get<TemplateDto>(`/api/templates/${template.id}`)).body;
    expect((await admin.put(`/api/templates/${template.id}`, inputOf(stored))).status).toBe(200);
  });
});

describe.runIf(TEST_DATABASE_URL)('a deep shelf order', () => {
  let server: TestServer;
  let admin: Client;

  beforeAll(async () => {
    server = await startTestServer();
    ({ admin } = await setupHousehold(server.app));
  });
  afterAll(async () => {
    await server?.close();
  });

  it('orders by up to 10 levels, down to the last one', async () => {
    const fields = [
      { id: 'genre', label: 'Genre', type: 'tags' },
      { id: 'author', label: 'Author', type: 'text' },
      { id: 'saga', label: 'Saga', type: 'text' },
      { id: 'saga_no', label: 'Saga #', type: 'number' },
      { id: 'coll', label: 'Collection', type: 'text' },
      { id: 'coll_no', label: 'Collection #', type: 'number' },
      { id: 'subtitle', label: 'Subtitle', type: 'text' },
    ];
    const levels = [
      { ref: 'genre', marker: true },
      { ref: 'author', marker: true },
      { ref: 'saga' },
      { ref: 'saga_no' },
      { ref: 'coll' },
      { ref: 'coll_no' },
      { ref: '$title' },
      { ref: 'subtitle' },
    ];
    const template = await admin.post<TemplateDto>('/api/templates', {
      name: 'Deep',
      accessionPrefix: 'DP',
      fields,
      shelf: { arrange: levels },
    });
    expect(template.status).toBe(201);
    expect(template.body.shelf.arrange).toHaveLength(8);

    const collection = (
      await admin.post<CollectionDto>('/api/collections', { templateId: template.body.id, name: 'Deep' })
    ).body;
    const fantasy = { genre: ['Fantasy'], author: 'Tolkien', saga: 'Middle-earth' };
    for (const [title, data] of [
      // Same everything down to the title: only the subtitle (level 8) tells these apart.
      ['The Lord of the Rings', { ...fantasy, saga_no: 2, coll: 'Minotauro', coll_no: 1, subtitle: 'Part two' }],
      ['The Lord of the Rings', { ...fantasy, saga_no: 2, coll: 'Minotauro', coll_no: 1, subtitle: 'Part one' }],
      // Same saga number, different collections (level 5), then collection numbers (level 6).
      ['The Hobbit', { ...fantasy, saga_no: 1, coll: 'Minotauro', coll_no: 2 }],
      ['The Hobbit', { ...fantasy, saga_no: 1, coll: 'Booket', coll_no: 9 }],
      ['The Hobbit (annotated)', { ...fantasy, saga_no: 1, coll: 'Minotauro', coll_no: 1 }],
      ['Kindred', { genre: ['Science fiction'], author: 'Butler' }],
    ] as const) {
      await admin.post(`/api/collections/${collection.id}/items`, { title, data });
    }
    const res = await admin.get<ItemListResponse>(`/api/collections/${collection.id}/items?sort=$arranged`);
    expect(res.body.items.map((i) => [i.title, i.data.coll ?? null, i.data.subtitle ?? null])).toEqual([
      ['The Hobbit', 'Booket', null],
      ['The Hobbit (annotated)', 'Minotauro', null],
      ['The Hobbit', 'Minotauro', null],
      ['The Lord of the Rings', 'Minotauro', 'Part one'],
      ['The Lord of the Rings', 'Minotauro', 'Part two'],
      ['Kindred', null, null],
    ]);

    // A collection can have as many levels of its own; 11 is too many.
    const own = await admin.patch<CollectionDto>(`/api/collections/${collection.id}`, { arrangement: levels });
    expect(own.status).toBe(200);
    const tooMany = await admin.patch<{ issues: { message: string }[] }>(`/api/collections/${collection.id}`, {
      arrangement: Array.from({ length: 11 }, () => ({ ref: '$title' })),
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.issues.map((i) => i.message)).toContain('Use at most 10 levels');

    // A newer version might allow more levels; after going back to this one, shared pages still open.
    const { db } = server.database;
    await db
      .update(templates)
      .set({
        shelf: { ...template.body.shelf, arrange: Array.from({ length: 12 }, () => ({ ...levels[0] })) } as never,
      })
      .where(eq(templates.id, template.body.id));
    const shared = await admin.patch<CollectionDto>(`/api/collections/${collection.id}`, { visibility: 'public' });
    const page = await new Client(server.app).get<{ items: unknown[] }>(`/api/public/${shared.body.publicSlug}`);
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(6);
  });
});
