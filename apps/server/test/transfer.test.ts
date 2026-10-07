import {
  type CollectionDto,
  coerceToField,
  guessColumns,
  type ImportResult,
  type ItemListResponse,
  parseCsv,
  type TemplateDto,
} from '@precious/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, setupHousehold, startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';

describe.runIf(TEST_DATABASE_URL)('import and export', () => {
  let server: TestServer;
  let admin: Client;
  let member: Client;
  let books: TemplateDto;
  let collection: CollectionDto;

  beforeAll(async () => {
    server = await startTestServer();
    ({ admin, member } = await setupHousehold(server.app));
    books = (await admin.get<TemplateDto[]>('/api/templates')).body.find((t) => t.name === 'Books') as TemplateDto;
    collection = (await admin.post<CollectionDto>('/api/collections', { templateId: books.id, name: 'Libros & más' }))
      .body;
    for (const [title, data] of [
      ['Rayuela', { author: 'Julio Cortázar', pages: 736, language: 'ES', status: 'Read' }],
      ['Kindred', { author: 'Octavia E. Butler', pages: 264, notes: 'Lent once; "great"\nRead twice' }],
    ] as const) {
      await admin.post(`/api/collections/${collection.id}/items`, { title, data });
    }
  });
  afterAll(async () => {
    await server?.close();
  });

  const exportCsv = async (c: Client, id: string) => {
    const res = await c.app.inject({
      method: 'GET',
      url: `/api/collections/${id}/export?format=csv`,
      headers: { cookie: c.cookie },
    });
    return res;
  };

  it('exports CSV that spreadsheets open, with field labels as headers', async () => {
    const res = await exportCsv(member, collection.id);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="libros-mas.csv"');
    expect(res.body.startsWith('﻿')).toBe(true);
    const parsed = parseCsv(res.body);
    expect(parsed.headers.slice(0, 4)).toEqual(['Accession number', 'Title', 'Subtitle', 'Author']);
    expect(parsed.rows[0]?.slice(0, 4)).toEqual(['BK·0001', 'Rayuela', '', 'Julio Cortázar']);
    const notes = parsed.headers.indexOf('Notes');
    expect(parsed.rows[1]?.[notes]).toBe('Lent once; "great"\nRead twice');
  });

  it('exports everything as JSON', async () => {
    const res = await member.get<{
      format: string;
      items: { title: string; data: Record<string, unknown> }[];
      template: TemplateDto;
    }>(`/api/collections/${collection.id}/export?format=json`);
    expect(res.body.format).toBe('precious-collection');
    expect(res.body.items.map((i) => i.title)).toEqual(['Rayuela', 'Kindred']);
    expect(res.body.template.fields.length).toBe(books.fields.length);
  });

  it('imports rows all at once, numbering on from the last item', async () => {
    expect(
      (await member.post(`/api/collections/${collection.id}/import`, { rows: [{ line: 2, title: 'X' }] })).status,
    ).toBe(403);
    const res = await admin.post<ImportResult>(`/api/collections/${collection.id}/import`, {
      rows: [
        { line: 2, title: 'Dune', data: { author: 'Frank Herbert', pages: 896, status: 'Unread' } },
        { line: 3, title: 'Solaris', data: { author: 'Stanisław Lem' } },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ created: 2, firstAccession: 'BK·0003', lastAccession: 'BK·0004' });
    const list = await admin.get<ItemListResponse>(`/api/collections/${collection.id}/items?sort=$accession&dir=asc`);
    expect(list.body.items.map((i) => i.title)).toEqual(['Rayuela', 'Kindred', 'Dune', 'Solaris']);
    expect(list.body.items[2]?.fieldMeta.pages).toMatchObject({ source: 'CSV import' });
    // Imported items can be found.
    const found = await admin.get<ItemListResponse>(`/api/collections/${collection.id}/items?q=herbert`);
    expect(found.body.items.map((i) => i.title)).toEqual(['Dune']);
  });

  it('saves nothing when a row is wrong, and says which line', async () => {
    const res = await admin.post<{ message: string; issues: { message: string }[] }>(
      `/api/collections/${collection.id}/import`,
      {
        rows: [
          { line: 2, title: 'Fine', data: { author: 'A' } },
          { line: 3, title: 'Broken', data: { author: 'B', pages: -4 } },
        ],
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Nothing was saved/);
    expect(res.body.issues[0]?.message).toMatch(/^Line 3, Pages:/);
    expect((await admin.get<ItemListResponse>(`/api/collections/${collection.id}/items`)).body.total).toBe(4);
    const tooMany = await admin.post(`/api/collections/${collection.id}/import`, {
      rows: Array.from({ length: 5001 }, (_, i) => ({ line: i + 2, title: `T${i}` })),
    });
    expect(tooMany.status).toBe(400);
  });

  it('round-trips: an export imports into another collection unchanged', async () => {
    const copy = (await admin.post<CollectionDto>('/api/collections', { templateId: books.id, name: 'Copy' })).body;
    const parsed = parseCsv((await exportCsv(admin, collection.id)).body);
    const targets = guessColumns(parsed.headers, books.fields);
    const rows = parsed.rows.map((r, i) => {
      const data: Record<string, unknown> = {};
      let title = '';
      targets.forEach((t, c) => {
        if (t === '$title') title = r[c] ?? '';
        const field = books.fields.find((f) => f.id === t);
        if (!field) return;
        const v = coerceToField(field, r[c]);
        if (v.ok && v.value !== undefined) data[field.id] = v.value;
      });
      return { line: i + 2, title, data };
    });
    expect((await admin.post(`/api/collections/${copy.id}/import`, { rows })).status).toBe(201);
    const again = parseCsv((await exportCsv(admin, copy.id)).body);
    expect(again.rows.map((r) => r.slice(1))).toEqual(parsed.rows.map((r) => r.slice(1)));
  });
});
