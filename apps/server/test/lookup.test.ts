import { randomUUID } from 'node:crypto';
import type {
  CollectionDto,
  FillResult,
  ItemDto,
  LookupSearchResponse,
  RefreshResult,
  SourceDto,
  TemplateDto,
  TryBindingsResult,
} from '@precious/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { images } from '../src/db/schema.ts';
import { pruneImages } from '../src/services/remoteImages.ts';
import { type Client, setupHousehold, startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';
import { json, startMockServer } from './mock-server.ts';

describe.runIf(TEST_DATABASE_URL)('search-to-add', () => {
  let server: TestServer;
  let admin: Client;
  let member: Client;
  let anon: Client;
  let mock: Awaited<ReturnType<typeof startMockServer>>;
  let png: Buffer;
  // The games database's details, changed later to test refreshing.
  const details: Record<string, Record<string, unknown>> = {};

  const ids = {} as Record<'gSearch' | 'gLookup' | 'tSearch' | 'tLookup', string>;
  let template: TemplateDto;
  let collection: CollectionDto;

  beforeAll(async () => {
    server = await startTestServer();
    ({ admin, member, anon } = await setupHousehold(server.app));
    png = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#2040d0' } })
      .png()
      .toBuffer();
    mock = await startMockServer({
      '/games/search': (req, res) => {
        const q = new URL(req.url, 'http://x').searchParams.get('q') ?? '';
        if (q === 'zelda') return json(res, { results: [{ id: 3, name: 'Zelda', year: 1987 }] });
        json(res, {
          results: [
            { id: 1, name: 'Lanterns of Vell', year: 2019, cover: `${mock.url}/covers/1.png` },
            { id: 2, name: 'Lanterns of Vell: Ember Tide', year: 2023, cover: `${mock.url}/covers/text` },
          ],
        });
      },
      '/games/1': (_req, res) => json(res, details['1']),
      '/games/2': (_req, res) => json(res, { name: 'Lanterns of Vell: Ember Tide' }),
      '/games/3': (_req, res) => json(res, { error: 'gone' }, 404),
      '/times/search': (req, res) => {
        const q = new URL(req.url, 'http://x').searchParams.get('q') ?? '';
        if (q === 'Zelda')
          return json(res, [
            { id: 'z1', title: 'The Legend of Zelda II', year: 1987 },
            { id: 'z2', title: 'Legend of Zelda', year: 1987 },
          ]);
        json(res, [
          { id: 't1', title: 'Lanterns of Vell', year: 2019 },
          { id: 't2', title: 'Lantern Keep', year: 2015 },
        ]);
      },
      '/times/t1': (_req, res) => json(res, { main: 1410 }),
      '/times/z2': (_req, res) => json(res, { main: 300 }),
      '/covers/1.png': (_req, res) => {
        res.setHeader('content-type', 'image/png');
        res.end(png);
      },
      '/covers/text': (_req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end('<p>no</p>');
      },
    });
    details['1'] = {
      name: 'Lanterns of Vell',
      developer: 'Hollowpine',
      genres: ['Adventure', 'Puzzle'],
      rating: '4',
      released: '2019-05-02T00:00:00Z',
      platform: 'switch',
      score: 'n/a',
    };

    const source = async (name: string, eps: Record<string, unknown>[]) => {
      const s = await admin.post<SourceDto>('/api/sources', {
        name,
        baseUrl: mock.url,
        rateLimit: { requests: 100, perSeconds: 1 },
        cacheSeconds: 0,
      });
      const out: string[] = [];
      for (const e of eps) {
        const r = await admin.post<{ id: string }>(`/api/sources/${s.body.id}/endpoints`, e);
        expect(r.status).toBe(201);
        out.push(r.body.id);
      }
      return out;
    };
    [ids.gSearch, ids.gLookup] = (await source('Games DB', [
      {
        key: 'search',
        name: 'Search',
        role: 'search',
        path: '/games/search',
        query: [{ name: 'q', value: '{{ query }}' }],
        map: { results: 'results', id: 'id', title: 'name', year: 'year', image: 'cover' },
      },
      {
        key: 'game',
        name: 'Game',
        role: 'lookup',
        path: '/games/{{ refs.games }}',
        map: {
          developer: 'developer',
          genres: 'genres',
          rating: 'rating',
          released: 'released',
          platform: 'platform',
          score: 'score',
        },
      },
    ])) as [string, string];
    [ids.tSearch, ids.tLookup] = (await source('Times DB', [
      {
        key: 'search',
        name: 'Search',
        role: 'search',
        path: '/times/search',
        query: [{ name: 'q', value: '{{ query }}' }],
        map: { results: '$', id: 'id', title: 'title', year: 'year' },
      },
      { key: 'times', name: 'Times', role: 'lookup', path: '/times/{{ refs.times }}', map: { main: 'main' } },
    ])) as [string, string];
  });
  afterAll(async () => {
    await mock?.close();
    await server?.close();
  });

  const fields = [
    { id: 'developer', label: 'Developer', type: 'text' },
    { id: 'genres', label: 'Genres', type: 'tags' },
    { id: 'rating', label: 'Rating', type: 'rating', options: { max: 5 } },
    { id: 'released', label: 'Released', type: 'date' },
    { id: 'platform', label: 'Platform', type: 'choice', options: { choices: ['Switch', 'PS5'] } },
    { id: 'year', label: 'Year', type: 'number' },
    { id: 'playtime', label: 'Playtime', type: 'duration' },
    { id: 'metascore', label: 'Metascore', type: 'number' },
  ];
  const bindings = () => ({
    search: [
      { id: 'games', endpointId: ids.gSearch, ref: 'games', fill: { $title: 'title', $cover: 'image', year: 'year' } },
    ],
    steps: [
      {
        id: 'details',
        endpointId: ids.gLookup,
        ref: 'games',
        fill: {
          developer: 'developer',
          genres: 'genres',
          rating: 'rating',
          released: 'released',
          platform: 'platform',
          metascore: 'score',
        },
      },
      {
        id: 'times',
        endpointId: ids.tLookup,
        ref: 'times',
        match: { endpointId: ids.tSearch, query: '{{ item.title }}', yearField: 'year' },
        fill: { playtime: 'main' },
      },
    ],
  });

  it('checks the endpoints a template binds', async () => {
    const base = { name: 'Games', accessionPrefix: 'GM', fields };
    const missing = await admin.post('/api/templates', {
      ...base,
      bindings: { search: [{ id: 'g', endpointId: randomUUID(), ref: 'g' }] },
    });
    expect(missing.status).toBe(400);
    const wrongRole = await admin.post<{ issues: { path: string }[] }>('/api/templates', {
      ...base,
      bindings: { search: [{ id: 'g', endpointId: ids.gLookup, ref: 'g' }] },
    });
    expect(wrongRole.status).toBe(400);
    expect(wrongRole.body.issues[0]?.path).toBe('bindings.search.0.endpointId');

    const ok = await admin.post<TemplateDto>('/api/templates', { ...base, bindings: bindings() });
    expect(ok.status).toBe(201);
    template = ok.body;
    expect(template.bindings.steps[1]?.match?.threshold).toBe(0.85);
    const c = await admin.post<CollectionDto>('/api/collections', {
      templateId: template.id,
      name: 'Games',
      visibility: 'household',
    });
    collection = c.body;
  });

  it('shows which templates use a source', async () => {
    const res = await admin.get<SourceDto[]>('/api/sources');
    expect(res.body.find((s) => s.name === 'Games DB')?.usedBy).toEqual([{ templateId: template.id, name: 'Games' }]);
  });

  it('lets only people who can add items search', async () => {
    const url = `/api/collections/${collection.id}/lookup/search`;
    expect((await anon.post(url, { provider: 'games', query: 'lanterns' })).status).toBe(401);
    expect((await member.post(url, { provider: 'games', query: 'lanterns' })).status).toBe(403);
    // Changing one setting leaves the others as they were.
    const patched = await admin.patch<CollectionDto>(`/api/collections/${collection.id}`, { editAccess: 'household' });
    expect(patched.body).toMatchObject({ editAccess: 'household', visibility: 'household', quickAdd: false });
    expect((await member.post(url, { provider: 'games', query: 'lanterns' })).status).toBe(200);
  });

  let hits: LookupSearchResponse['results'];

  it('searches and signs each result', async () => {
    const res = await member.post<LookupSearchResponse>(`/api/collections/${collection.id}/lookup/search`, {
      provider: 'games',
      query: 'lanterns',
    });
    expect(res.body.error).toBeUndefined();
    hits = res.body.results;
    expect(hits.map((h) => [h.id, h.title, h.year])).toEqual([
      ['1', 'Lanterns of Vell', 2019],
      ['2', 'Lanterns of Vell: Ember Tide', 2023],
    ]);
    expect(hits[0]?.token).toMatch(/^[\w-]{32}$/);
  });

  let filled: FillResult;

  it('fills an item from the result, a lookup and a matched second source', async () => {
    const res = await member.post<FillResult>(`/api/collections/${collection.id}/lookup/fill`, {
      provider: 'games',
      query: 'lanterns',
      result: hits[0],
    });
    expect(res.status).toBe(200);
    filled = res.body;
    expect(filled.title).toBe('Lanterns of Vell');
    expect(filled.data).toEqual({
      year: 2019,
      developer: 'Hollowpine',
      genres: ['Adventure', 'Puzzle'],
      rating: 4,
      released: '2019-05-02',
      platform: 'Switch',
      playtime: 1410,
    });
    expect(filled.refs).toEqual({ games: '1', times: 't1' });
    expect(filled.sources.developer).toEqual({ name: 'Games DB', step: 'details' });
    expect(filled.sources.playtime).toEqual({ name: 'Times DB', step: 'times' });
    expect(filled.cover?.url).toBe(`${mock.url}/covers/1.png`);
    expect(filled.pending).toEqual([]);
    expect(filled.warnings).toEqual([
      { step: 'details', target: 'metascore', message: "Metascore: n/a isn't a number" },
    ]);
    expect(filled.steps.map((s) => [s.id, s.status])).toEqual([
      ['games', 'ok'],
      ['details', 'ok'],
      ['times', 'ok'],
    ]);
    expect(filled.steps[2]?.score).toBe(1);
  });

  it('refuses results the server did not return', async () => {
    const res = await member.post(`/api/collections/${collection.id}/lookup/fill`, {
      provider: 'games',
      result: { ...hits[0], image: 'http://169.254.169.254/latest' },
    });
    expect(res.status).toBe(400);
  });

  it('asks when the match is unclear, and takes the answer', async () => {
    const search = await member.post<LookupSearchResponse>(`/api/collections/${collection.id}/lookup/search`, {
      provider: 'games',
      query: 'zelda',
    });
    const zelda = search.body.results[0];
    const fill = (choices?: Record<string, string | null>) =>
      member.post<FillResult>(`/api/collections/${collection.id}/lookup/fill`, {
        provider: 'games',
        query: 'zelda',
        result: zelda,
        ...(choices && { choices }),
      });
    const first = (await fill()).body;
    // The details lookup fails (404) without stopping the rest.
    expect(first.warnings.map((w) => w.step)).toEqual(['details']);
    expect(first.title).toBe('Zelda');
    expect(first.pending).toHaveLength(1);
    expect(first.pending[0]).toMatchObject({ step: 'times', label: 'Times DB', query: 'Zelda' });
    expect(first.pending[0]?.candidates.map((c) => c.id)).toEqual(['z2', 'z1']);

    const chosen = (await fill({ times: 'z2' })).body;
    expect(chosen.pending).toEqual([]);
    expect(chosen.data.playtime).toBe(300);
    expect(chosen.refs.times).toBe('z2');

    const skipped = (await fill({ times: null })).body;
    expect(skipped.pending).toEqual([]);
    expect(skipped.data.playtime).toBeUndefined();
    expect(skipped.steps.find((s) => s.id === 'times')?.status).toBe('skipped');
  });

  let coverId: string;

  it('downloads only covers a data source found', async () => {
    const forged = await member.post('/api/images/remote', { url: `${mock.url}/covers/1.png`, token: 'x'.repeat(32) });
    expect(forged.status).toBe(403);
    const ok = await member.post<{ id: string; width: number }>('/api/images/remote', filled.cover);
    expect(ok.status).toBe(201);
    expect(ok.body.width).toBe(300);
    coverId = ok.body.id;
    // The same address again reuses the download.
    const again = await member.post<{ id: string }>('/api/images/remote', filled.cover);
    expect(again.body.id).toBe(coverId);

    const other = await member.post<FillResult>(`/api/collections/${collection.id}/lookup/fill`, {
      provider: 'games',
      result: hits[1],
    });
    const notImage = await member.post<{ message: string }>('/api/images/remote', other.body.cover);
    expect(notImage.status).toBe(400);
    expect(notImage.body.message).toBe('The cover address is not an image.');
  });

  let item: ItemDto;

  it('saves where each value came from and locks what was typed by hand', async () => {
    const { developer: _, ...sources } = filled.sources;
    const res = await member.post<ItemDto>(`/api/collections/${collection.id}/items`, {
      title: filled.title,
      coverImageId: coverId,
      data: { ...filled.data, developer: 'Hollowpine Studio' },
      externalRefs: filled.refs,
      sources,
    });
    expect(res.status).toBe(201);
    item = res.body;
    expect(item.externalRefs).toEqual({ games: '1', times: 't1' });
    expect(item.fieldMeta.genres).toMatchObject({ source: 'Games DB', step: 'details' });
    expect(item.fieldMeta.genres?.locked).toBeUndefined();
    expect(item.fieldMeta.developer).toMatchObject({ source: 'user', locked: true });
    expect(item.fieldMeta.$title).toMatchObject({ source: 'Games DB', step: 'games' });
    expect(item.fieldMeta.$cover).toMatchObject({ source: 'Games DB', url: `${mock.url}/covers/1.png` });
  });

  it('refreshes from the stored refs and keeps hand-edited values', async () => {
    details['1'] = { ...details['1'], developer: 'Hollowpine Games', genres: ['Adventure', 'Puzzle', 'Cozy'] };
    const res = await member.post<RefreshResult>(`/api/items/${item.id}/refresh`, {});
    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual([
      {
        target: 'genres',
        before: ['Adventure', 'Puzzle'],
        after: ['Adventure', 'Puzzle', 'Cozy'],
        source: { name: 'Games DB', step: 'details' },
      },
    ]);
    expect(res.body.kept).toEqual([{ target: 'developer', value: 'Hollowpine Studio', offered: 'Hollowpine Games' }]);
    expect(res.body.cover).toBeUndefined();
    expect(res.body.pending).toEqual([]);

    // Applying is a PATCH with sources; a sourced value can't replace a locked one.
    const applied = await member.patch<ItemDto>(`/api/items/${item.id}`, {
      data: { genres: ['Adventure', 'Puzzle', 'Cozy'], developer: 'Hollowpine Games' },
      sources: {
        genres: { name: 'Games DB', step: 'details' },
        developer: { name: 'Games DB', step: 'details' },
      },
    });
    expect(applied.body.data.genres).toEqual(['Adventure', 'Puzzle', 'Cozy']);
    expect(applied.body.data.developer).toBe('Hollowpine Studio');
    expect(applied.body.fieldMeta.genres).toMatchObject({ source: 'Games DB' });
    expect(applied.body.fieldMeta.developer?.locked).toBe(true);

    const unlocked = await member.patch<ItemDto>(`/api/items/${item.id}`, { unlock: ['developer'] });
    expect(unlocked.body.fieldMeta.developer?.locked).toBeUndefined();
    const again = await member.post<RefreshResult>(`/api/items/${item.id}/refresh`, {});
    expect(again.body.changes.map((c) => c.target)).toEqual(['developer']);
  });

  it('tries draft bindings from the template editor', async () => {
    const res = await member.post<TryBindingsResult>('/api/templates/try', {
      fields,
      bindings: bindings(),
      query: 'lanterns',
      resultIndex: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.picked).toBe(0);
    expect(res.body.fill?.data.playtime).toBe(1410);
    const bad = await member.post('/api/templates/try', {
      fields,
      bindings: { search: [{ id: 'g', endpointId: ids.gSearch, ref: 'g', fill: { nope: 'x' } }] },
      query: 'lanterns',
    });
    expect(bad.status).toBe(400);
  });

  it('removes old images no item uses', async () => {
    const { db } = server.database;
    const orphan = randomUUID();
    await db.insert(images).values({
      id: orphan,
      width: 1,
      height: 1,
      mime: 'image/webp',
      bytes: 1,
      createdAt: new Date(Date.now() - 48 * 3600_000),
    });
    const removed = await pruneImages(db, server.config.UPLOAD_DIR);
    expect(removed).toBe(1);
    const left = (await db.select({ id: images.id }).from(images)).map((r) => r.id);
    expect(left).not.toContain(orphan);
    expect(left).toContain(coverId);
  });
});
