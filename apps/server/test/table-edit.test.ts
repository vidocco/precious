import type { CollectionDto, ItemDto, TemplateDto } from '@precious/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, setupHousehold, startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';

describe.runIf(TEST_DATABASE_URL)('editing several items at once', () => {
  let server: TestServer;
  let admin: Client;
  let member: Client;
  let collection: CollectionDto;
  let other: CollectionDto;
  let dune: ItemDto;
  let ficciones: ItemDto;
  let stranger: ItemDto;

  const url = () => `/api/collections/${collection.id}/items`;
  const get = async (id: string) => (await admin.get<ItemDto>(`/api/items/${id}`)).body;

  beforeAll(async () => {
    server = await startTestServer();
    ({ admin, member } = await setupHousehold(server.app));
    const template = (
      await admin.post<TemplateDto>('/api/templates', {
        name: 'Shelf',
        accessionPrefix: 'SH',
        fields: [
          { id: 'author', label: 'Author', type: 'text', required: true },
          { id: 'pages', label: 'Pages', type: 'number' },
          { id: 'status', label: 'Status', type: 'choice', options: { choices: ['To read', 'Read'] } },
          { id: 'tags', label: 'Tags', type: 'tags' },
        ],
      })
    ).body;
    collection = (await admin.post<CollectionDto>('/api/collections', { templateId: template.id, name: 'Shelf' })).body;
    other = (await admin.post<CollectionDto>('/api/collections', { templateId: template.id, name: 'Other' })).body;
    const add = async (c: CollectionDto, title: string, data: Record<string, unknown>) =>
      (await admin.post<ItemDto>(`/api/collections/${c.id}/items`, { title, data })).body;
    dune = await add(collection, 'Dune', { author: 'Herbert', pages: 600, status: 'To read', tags: ['sf'] });
    ficciones = await add(collection, 'Ficciones', { author: 'Borges', pages: 200 });
    stranger = await add(other, 'Kindred', { author: 'Butler' });
  });
  afterAll(async () => {
    await server?.close();
  });

  it('saves every change, as typed by hand', async () => {
    const res = await admin.patch<{ items: ItemDto[] }>(url(), {
      items: [
        { id: dune.id, title: 'Dune (1965)', data: { status: 'Read', pages: 612, tags: [] } },
        { id: ficciones.id, data: { status: 'Read' } },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.title).sort()).toEqual(['Dune (1965)', 'Ficciones']);
    const d = await get(dune.id);
    expect(d.title).toBe('Dune (1965)');
    // Emptied values are cleared; the rest is kept.
    expect(d.data).toEqual({ author: 'Herbert', pages: 612, status: 'Read' });
    expect(d.fieldMeta.status?.locked).toBe(true);
    expect((await get(ficciones.id)).data).toEqual({ author: 'Borges', pages: 200, status: 'Read' });
  });

  it('saves nothing when any change is not valid, and says which', async () => {
    const res = await admin.patch<{ issues: { path: string }[] }>(url(), {
      items: [
        { id: dune.id, data: { pages: 700 } },
        { id: ficciones.id, data: { status: 'Lost', pages: 'many' } },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((i) => i.path).sort()).toEqual(['items.1.data.pages', 'items.1.data.status']);
    expect((await get(dune.id)).data.pages).toBe(612);
    const title = await admin.patch<{ issues: { path: string }[] }>(url(), { items: [{ id: dune.id, title: ' ' }] });
    expect(title.status).toBe(400);
    expect(title.body.issues.map((i) => i.path)).toEqual(['items.0.title']);
  });

  it('only changes items of this collection, each once', async () => {
    const res = await admin.patch<{ issues: { path: string }[] }>(url(), {
      items: [
        { id: dune.id, data: { pages: 1 } },
        { id: stranger.id, data: { pages: 1 } },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((i) => i.path)).toEqual(['items.1.id']);
    expect((await get(stranger.id)).data).toEqual({ author: 'Butler' });
    expect((await get(dune.id)).data.pages).toBe(612);
    const twice = await admin.patch(url(), {
      items: [
        { id: dune.id, data: { pages: 1 } },
        { id: dune.id, data: { pages: 2 } },
      ],
    });
    expect(twice.status).toBe(400);
  });

  it('needs edit access to the collection', async () => {
    const res = await member.patch(url(), { items: [{ id: dune.id, title: 'Hacked' }] });
    expect(res.status).toBe(403);
    expect((await get(dune.id)).title).toBe('Dune (1965)');
  });
});
