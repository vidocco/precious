import type {
  CollectionDto,
  FigureValue,
  ItemDto,
  ItemListResponse,
  SearchResponse,
  TemplateDto,
  UserDto,
} from '@precious/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN,
  Client,
  MEMBER,
  setupHousehold,
  startTestServer,
  TEST_DATABASE_URL,
  type TestServer,
} from './harness.ts';

describe.runIf(TEST_DATABASE_URL)('Precious API', () => {
  let server: TestServer;
  let anon: Client;
  let admin: Client;
  let member: Client;
  let games: TemplateDto;
  let books: TemplateDto;

  beforeAll(async () => {
    server = await startTestServer();
    const setupBefore = await new Client(server.app).get<{ needsSetup: boolean }>('/api/setup');
    expect(setupBefore.body.needsSetup).toBe(true);
    ({ anon, admin, member } = await setupHousehold(server.app));
    const templates = await admin.get<TemplateDto[]>('/api/templates');
    games = templates.body.find((t) => t.name === 'Video games') as TemplateDto;
    books = templates.body.find((t) => t.name === 'Books') as TemplateDto;
  });
  afterAll(async () => {
    await server?.close();
  });

  describe('accounts', () => {
    it('only allows setup once', async () => {
      const again = await anon.post('/api/setup', {
        name: 'Eve',
        email: 'eve@example.com',
        password: 'longenoughpassword',
      });
      expect(again.status).toBe(409);
      expect((await anon.get<{ needsSetup: boolean }>('/api/setup')).body.needsSetup).toBe(false);
    });

    it('has no open sign-up', async () => {
      const res = await anon.post('/api/auth/sign-up/email', {
        name: 'Eve',
        email: 'eve@example.com',
        password: 'longenoughpassword',
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('identifies the signed-in person', async () => {
      expect((await anon.get('/api/me')).status).toBe(401);
      const me = await admin.get<UserDto>('/api/me');
      expect(me.body).toMatchObject({ email: ADMIN.email, role: 'admin' });
      expect((await member.get<UserDto>('/api/me')).body.role).toBe('member');
    });

    it('keeps user management for admins', async () => {
      expect(
        (await member.post('/api/users', { name: 'X', email: 'x@example.com', password: 'longenoughpassword' })).status,
      ).toBe(403);
      const dup = await admin.post('/api/users', { ...MEMBER });
      expect(dup.status).toBe(409);
      const me = await admin.get<UserDto>('/api/me');
      expect((await admin.del(`/api/users/${me.body.id}`)).status).toBe(400);
    });

    it('lets an admin reset a password', async () => {
      const created = await admin.post<UserDto>('/api/users', {
        name: 'Ana',
        email: 'ana@example.com',
        password: 'first-password-1',
      });
      expect(created.status).toBe(201);
      const reset = await admin.patch(`/api/users/${created.body.id}`, { password: 'second-password-2' });
      expect(reset.status).toBe(200);
      await expect(new Client(server.app).signIn('ana@example.com', 'first-password-1')).rejects.toThrow();
      await new Client(server.app).signIn('ana@example.com', 'second-password-2');
      expect((await admin.del(`/api/users/${created.body.id}`)).status).toBe(204);
    });
  });

  describe('templates', () => {
    it('comes with the starter templates', () => {
      expect(games.fields.map((f) => f.id)).toContain('platform');
      expect(books.card.slots).toEqual({ tl: 'language', tr: 'publisher', b: 'author' });
      expect(games.canEdit).toBe(true);
    });

    it('lets members create templates but not edit starter ones', async () => {
      const mine = await member.post<TemplateDto>('/api/templates', {
        name: 'Plants',
        accessionPrefix: 'PL',
        fields: [{ id: 'species', label: 'Species', type: 'text' }],
        card: {
          lines: [
            { fields: ['$title'], style: 'title' },
            { fields: ['species'], style: 'muted' },
          ],
        },
      });
      expect(mine.status).toBe(201);
      expect(mine.body.canEdit).toBe(true);
      const starterEdit = await member.put(`/api/templates/${games.id}`, { ...games, name: 'Mine now' });
      expect(starterEdit.status).toBe(403);
      expect((await member.del(`/api/templates/${mine.body.id}`)).status).toBe(204);
    });

    it('refuses to drop fields or change them to incompatible types', async () => {
      const without = {
        ...games,
        fields: games.fields.filter((f) => f.id !== 'developer'),
        itemLayout: { ...games.itemLayout, info: games.itemLayout.info.filter((r) => r !== 'developer') },
      };
      const res = await admin.put<{ message: string }>(`/api/templates/${games.id}`, without);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Hide it instead');
      const retyped = {
        ...games,
        fields: games.fields.map((f) => (f.id === 'acquired' ? { ...f, type: 'boolean' } : f)),
      };
      expect((await admin.put(`/api/templates/${games.id}`, retyped)).status).toBe(400);
    });

    it('validates layouts against fields', async () => {
      const res = await admin.post('/api/templates', { name: 'Broken', card: { lines: [{ fields: ['nope'] }] } });
      expect(res.status).toBe(400);
    });
  });

  describe('collections and items', () => {
    let col: CollectionDto;
    let lanterns: ItemDto;

    beforeAll(async () => {
      const res = await admin.post<CollectionDto>('/api/collections', {
        templateId: games.id,
        name: 'Video games',
        visibility: 'household',
      });
      expect(res.status).toBe(201);
      col = res.body;
    });

    it('creates a collection with the template prefix', () => {
      expect(col).toMatchObject({
        accessionPrefix: 'VG',
        itemCount: 0,
        canEdit: true,
        canDelete: true,
        publicSlug: null,
      });
    });

    it('validates item data against the template', async () => {
      const bad = await admin.post<{ issues: { path: string }[] }>(`/api/collections/${col.id}/items`, {
        title: 'Bad',
        data: { platform: 'Dreamcast 2', release_year: 'soon' },
      });
      expect(bad.status).toBe(400);
      expect(bad.body.issues.map((i) => i.path).sort()).toEqual(['data.platform', 'data.release_year']);
    });

    it('numbers items in order and stores clean data', async () => {
      const res = await admin.post<ItemDto>(`/api/collections/${col.id}/items`, {
        title: 'Lanterns of Vell',
        data: {
          platform: 'Switch',
          release_year: 2019,
          value: 64.5,
          status: 'Completed',
          edition: 'Lantern Box',
          junk: 1,
        },
      });
      expect(res.status).toBe(201);
      lanterns = res.body;
      expect(lanterns.accession).toBe('VG·0001');
      expect(lanterns.data).not.toHaveProperty('junk');
      expect(lanterns.fieldMeta.platform?.source).toBe('user');
    });

    it('never repeats accession numbers when items are added at once', async () => {
      const titles = ['Salt & Cinder', 'Moth Protocol', 'Kilnheart', 'Tidewright', 'Glasswing'];
      const results = await Promise.all(
        titles.map((title, i) =>
          admin.post<ItemDto>(`/api/collections/${col.id}/items`, {
            title,
            data: { platform: i % 2 ? 'PS5' : 'PC', value: 10 + i, status: 'Not started' },
          }),
        ),
      );
      const numbers = results.map((r) => r.body.accessionNo).sort((a, b) => a - b);
      expect(numbers).toEqual([2, 3, 4, 5, 6]);
    });

    it('lists recently added items across visible collections', async () => {
      const res = await member.get<(ItemDto & { collection: { name: string } })[]>('/api/items/recent?limit=3');
      expect(res.body).toHaveLength(3);
      expect(res.body[0]?.collection.name).toBe('Video games');
    });

    it('computes the template header figures', async () => {
      const res = await admin.get<FigureValue[]>(`/api/collections/${col.id}/figures`);
      const byId = Object.fromEntries(res.body.map((f) => [f.id, f]));
      expect(byId.count?.value).toBe(6);
      expect(byId.value).toMatchObject({ value: 64.5 + 10 + 11 + 12 + 13 + 14, format: 'money', currency: 'EUR' });
      expect(byId.backlog?.value).toBe(5);
    });

    it('sorts, filters and pages', async () => {
      const byValue = await admin.get<ItemListResponse>(`/api/collections/${col.id}/items?sort=value&dir=desc&limit=2`);
      expect(byValue.body.total).toBe(6);
      expect(byValue.body.items.map((i) => i.title)).toEqual(['Lanterns of Vell', 'Glasswing']);
      const ps5 = await admin.get<ItemListResponse>(`/api/collections/${col.id}/items?filter=platform:PS5`);
      expect(ps5.body.items.map((i) => i.title).sort()).toEqual(['Moth Protocol', 'Tidewright']);
      const byTitle = await admin.get<ItemListResponse>(`/api/collections/${col.id}/items?sort=$title&dir=asc`);
      expect(byTitle.body.items[0]?.title).toBe('Glasswing');
    });

    it('searches inside a collection and says where it matched', async () => {
      const res = await admin.get<ItemListResponse>(`/api/collections/${col.id}/items?q=lantern`);
      expect(res.body.items.map((i) => i.title)).toEqual(['Lanterns of Vell']);
      expect(res.body.items[0]?.match).toEqual({ label: 'Title', snippet: '«Lantern»s of Vell' });
      const edition = await admin.get<ItemListResponse>(`/api/collections/${col.id}/items?q=lantern box`);
      expect(edition.body.items[0]?.match?.label).toBe('Edition');
    });

    it('updates items, clears values and locks edited fields', async () => {
      const res = await admin.patch<ItemDto>(`/api/items/${lanterns.id}`, {
        title: 'Lanterns of Vell',
        data: { condition: 'Very good', edition: '' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.condition).toBe('Very good');
      expect(res.body.data).not.toHaveProperty('edition');
      expect(res.body.data.platform).toBe('Switch');
      expect(res.body.fieldMeta.condition?.locked).toBe(true);
      expect(res.body.fieldMeta.platform?.locked).toBeUndefined();
    });

    it('lets the household look but not edit when edit access is owner-only', async () => {
      expect((await member.get(`/api/collections/${col.id}`)).status).toBe(200);
      const edit = await member.patch(`/api/items/${lanterns.id}`, { title: 'Hacked' });
      expect(edit.status).toBe(403);
      expect((await member.del(`/api/collections/${col.id}`)).status).toBe(403);
      await admin.patch(`/api/collections/${col.id}`, { editAccess: 'household' });
      expect((await member.patch(`/api/items/${lanterns.id}`, { data: { status: 'Playing' } })).status).toBe(200);
    });

    it('hides private collections from everyone but the owner and admins', async () => {
      const priv = await member.post<CollectionDto>('/api/collections', {
        templateId: books.id,
        name: 'Diaries',
        visibility: 'private',
      });
      expect(priv.status).toBe(201);
      await member.post(`/api/collections/${priv.body.id}/items`, {
        title: 'Lantern diary 1994',
        data: { author: 'Juan' },
      });
      const other = await new Client(server.app).signIn(ADMIN.email, ADMIN.password);
      // Admins can see it; a second member could not (tested via the access rules).
      expect((await other.get(`/api/collections/${priv.body.id}`)).status).toBe(200);
      const anyone = await anon.get(`/api/collections/${priv.body.id}`);
      expect(anyone.status).toBe(401);
    });

    it('searches across collections, grouped, with fuzzy matches', async () => {
      const res = await member.get<SearchResponse>('/api/search?q=lantern');
      const names = res.body.groups.map((g) => g.collection.name).sort();
      expect(names).toEqual(['Diaries', 'Video games']);
      const fuzzy = await admin.get<SearchResponse>('/api/search?q=lantren');
      expect(fuzzy.body.total).toBeGreaterThan(0);
      expect(fuzzy.body.groups[0]?.hits[0]?.match.label).toContain('similar');
    });

    it('shares a read-only public link', async () => {
      const res = await admin.patch<CollectionDto>(`/api/collections/${col.id}`, { visibility: 'public' });
      const slug = res.body.publicSlug as string;
      expect(slug).toMatch(/^[\w-]{8,}$/);
      const pub = await anon.get<{ collection: { name: string }; items: ItemDto[] }>(`/api/public/${slug}`);
      expect(pub.status).toBe(200);
      expect(pub.body.collection.name).toBe('Video games');
      expect(pub.body.items).toHaveLength(6);
      expect(pub.body.items[0]?.createdBy).toBeNull();
      await admin.patch(`/api/collections/${col.id}`, { visibility: 'household' });
      expect((await anon.get(`/api/public/${slug}`)).status).toBe(404);
    });

    it('uploads covers in three sizes with a dominant colour', async () => {
      const png = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#d04020' } })
        .png()
        .toBuffer();
      const boundary = '----precious';
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const up = await server.app.inject({
        method: 'POST',
        url: '/api/images',
        headers: { cookie: admin.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      expect(up.statusCode).toBe(201);
      const img = up.json() as { id: string; width: number; height: number; color: string };
      expect(img).toMatchObject({ width: 900, height: 1200 });
      expect(img.color).toMatch(/^#[0-9a-f]{6}$/);
      const sm = await server.app.inject({ method: 'GET', url: `/media/${img.id}/sm` });
      expect(sm.statusCode).toBe(200);
      expect((await sharp(sm.rawPayload).metadata()).height).toBe(400);
      const withCover = await admin.patch<ItemDto>(`/api/items/${lanterns.id}`, { coverImageId: img.id });
      expect(withCover.body.cover).toMatchObject({ id: img.id, color: img.color });

      const notImage = await server.app.inject({
        method: 'POST',
        url: '/api/images',
        headers: { cookie: admin.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n`,
          ),
          Buffer.from('definitely not a png'),
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
      expect(notImage.statusCode).toBe(400);
    });

    it('deletes items and collections', async () => {
      expect((await admin.del(`/api/items/${lanterns.id}`)).status).toBe(204);
      expect((await admin.get(`/api/items/${lanterns.id}`)).status).toBe(404);
      const inUse = await admin.del(`/api/templates/${games.id}`);
      expect(inUse.status).toBe(409);
      expect((await admin.del(`/api/collections/${col.id}`)).status).toBe(204);
    });
  });
});
