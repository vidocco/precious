import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EndpointDto, PresetDto, RunResult, SourceDto } from '@precious/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, setupHousehold, startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';
import { json, startMockServer } from './mock-server.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe.runIf(TEST_DATABASE_URL)('data sources API', () => {
  let server: TestServer;
  let admin: Client;
  let member: Client;
  let mock: Awaited<ReturnType<typeof startMockServer>>;

  beforeAll(async () => {
    server = await startTestServer();
    ({ admin, member } = await setupHousehold(server.app));
    mock = await startMockServer({
      'POST /oauth2/token': (req, res) => {
        const form = new URLSearchParams(req.body);
        if (form.get('client_id') !== 'my-client' || form.get('client_secret') !== 'my-secret')
          return json(res, {}, 403);
        json(res, { access_token: 'tok', expires_in: 3600 });
      },
      'POST /games': (req, res) => {
        if (req.headers.authorization !== 'Bearer tok' || req.headers['client-id'] !== 'my-client')
          return json(res, {}, 401);
        res.setHeader('content-type', 'application/json');
        res.end(req.body.startsWith('search') ? fixture('igdb-search.json') : fixture('igdb-details.json'));
      },
      'POST /': (req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(req.body.includes('Page(') ? fixture('anilist-search.json') : fixture('anilist-details.json'));
      },
      '/search.json': (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(fixture('ol-search.json'));
      },
      '/works/OL59800W.json': (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(fixture('ol-work.json'));
      },
      '/works/OL59800W/ratings.json': (_req, res) =>
        json(res, { summary: { average: 4.486486486486487, count: 37 }, counts: { '5': 24 } }),
      '/w/index.php': (_req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(fixture('wiki-search.html'));
      },
      '/wiki/A_Wizard_of_Earthsea': (_req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(fixture('wiki-article.html'));
      },
      '/counted': (_req, res) => json(res, { items: [{ id: 1, name: 'Cached thing' }] }),
    });
  });
  afterAll(async () => {
    await mock?.close();
    await server?.close();
  });

  async function install(key: string) {
    const res = await admin.post<{ source: SourceDto; missingSecrets: string[] }>(
      `/api/recipes/presets/${key}/install`,
    );
    expect(res.status).toBe(201);
    // Point the preset at the local stand-in for the real service.
    const s = res.body.source;
    const {
      id: _i,
      secrets: _s,
      endpoints: _e,
      lastCall: _l,
      createdAt: _c,
      updatedAt: _u,
      canEdit: _ce,
      ...input
    } = s;
    const auth = s.auth.type === 'oauth2' ? { ...s.auth, tokenUrl: `${mock.url}/oauth2/token` } : s.auth;
    const updated = await admin.put<SourceDto>(`/api/sources/${s.id}`, {
      ...input,
      auth,
      baseUrl: mock.url,
      rateLimit: { requests: 100, perSeconds: 1 },
    });
    expect(updated.status).toBe(200);
    return { source: updated.body, missingSecrets: res.body.missingSecrets };
  }

  async function run(source: SourceDto, key: string, input: Record<string, unknown> = {}, useCache = false) {
    const endpoint = source.endpoints.find((e) => e.key === key) as EndpointDto;
    const { id: _i, sourceId: _s, updatedAt: _u, ...draft } = endpoint;
    const res = await admin.post<RunResult>(`/api/sources/${source.id}/run`, { endpoint: draft, input, useCache });
    expect(res.status).toBe(200);
    return res.body;
  }

  it('lists the bundled presets', async () => {
    const res = await member.get<PresetDto[]>('/api/recipes/presets');
    expect(res.body.map((p) => p.key)).toEqual(['anilist', 'igdb', 'open-library', 'wikipedia']);
    expect(res.body.find((p) => p.key === 'igdb')?.secretNames).toEqual(['clientId', 'clientSecret']);
  });

  it('keeps sources and runs for admins', async () => {
    expect((await member.post('/api/sources', { name: 'X', baseUrl: 'https://x.test' })).status).toBe(403);
    expect((await member.post('/api/recipes/presets/open-library/install')).status).toBe(403);
  });

  it('rejects non-http addresses', async () => {
    const res = await admin.post('/api/sources', { name: 'Bad', baseUrl: 'file:///etc/passwd' });
    expect(res.status).toBe(400);
  });

  it('runs the Open Library preset (REST)', async () => {
    const { source } = await install('open-library');
    const search = await run(source, 'search', { query: 'left hand' });
    expect(search.errors).toEqual([]);
    expect(search.output).toEqual([
      {
        id: '/works/OL59863W',
        title: 'The Left Hand of Darkness',
        subtitle: 'Ursula K. Le Guin',
        year: 1969,
        image: 'https://covers.openlibrary.org/b/id/8235432-L.jpg',
        pages: 304,
      },
      { id: '/works/OL1W', title: 'Left Hand', subtitle: 'Someone' },
    ]);
    const work = await run(source, 'work', { refs: { openlibrary: '/works/OL59800W' } });
    expect(work.output).toEqual({
      synopsis: 'A groundbreaking work of science fiction.',
      subjects: [
        'Science fiction',
        'Gender',
        'Winter',
        'Diplomacy',
        'Planets',
        'Hugo Award',
        'Nebula Award',
        'Classics',
      ],
      first_published: '1969',
    });
    const rating = await run(source, 'rating', { refs: { openlibrary: '/works/OL59800W' } });
    expect(rating.errors).toEqual([]);
    expect(rating.output).toBe(4.49);
  });

  it('runs the AniList preset (GraphQL)', async () => {
    const { source } = await install('anilist');
    const search = await run(source, 'search', { query: 'mushishi' });
    expect(search.errors).toEqual([]);
    expect(search.output).toMatchObject([
      { id: '457', title: 'Mushi-Shi', subtitle: 'TV · 26 episodes', year: 2005 },
      { id: '21939', title: 'Mushishi Zoku Shou', subtitle: 'TV', year: 2014 },
    ]);
    const details = await run(source, 'details', { refs: { anilist: '457' } });
    expect(details.output).toEqual({
      synopsis: 'Ginko travels the land studying mushi.',
      genres: ['Adventure', 'Mystery'],
      score: 87,
      episodes: 26,
      studio: 'Artland',
    });
  });

  it('runs the IGDB preset with OAuth and stored secrets that are never shown', async () => {
    const { source, missingSecrets } = await install('igdb');
    expect(missingSecrets).toEqual(['clientId', 'clientSecret']);
    const without = await run(source, 'search', { query: 'outer wilds' });
    expect(without.errors[0]).toMatchObject({ stage: 'auth' });

    const withSecrets = await admin.put<SourceDto>(`/api/sources/${source.id}/secrets`, {
      clientId: 'my-client',
      clientSecret: 'my-secret',
    });
    expect(withSecrets.body.secrets).toEqual([{ name: 'clientId' }, { name: 'clientSecret' }]);
    const listed = await member.get<SourceDto[]>('/api/sources');
    expect(JSON.stringify(listed.body)).not.toContain('my-secret');

    const search = await run(source, 'search', { query: 'outer wilds' });
    expect(search.errors).toEqual([]);
    expect(search.output).toEqual([
      {
        id: '11737',
        title: 'Outer Wilds',
        subtitle: 'PC (Microsoft Windows) · PlayStation 4',
        year: 2019,
        image: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co65ac.jpg',
      },
      { id: '2', title: 'Outer Wilds: Echoes of the Eye' },
    ]);
    expect(JSON.stringify(search.request)).not.toMatch(/my-secret|my-client|"tok"/);

    const details = await run(source, 'details', { refs: { igdb: '11737' } });
    expect(details.output).toEqual({
      summary: 'A space exploration game.',
      genre: ['Adventure', 'Puzzle'],
      developer: 'Mobius Digital',
      release_year: 2019,
    });

    const removed = await admin.put<SourceDto>(`/api/sources/${source.id}/secrets`, { clientSecret: null });
    expect(removed.body.secrets).toEqual([{ name: 'clientId' }]);
  });

  it('runs the Wikipedia preset (HTML search and article)', async () => {
    const { source } = await install('wikipedia');
    const search = await run(source, 'search', { query: 'earthsea' });
    expect(search.errors).toEqual([]);
    expect(search.output).toMatchObject([
      { id: 'A_Wizard_of_Earthsea', title: 'A Wizard of Earthsea' },
      { id: 'Tehanu', title: 'Tehanu' },
    ]);
    const article = await run(source, 'article', { refs: { wikipedia: 'A_Wizard_of_Earthsea' } });
    expect(article.errors).toEqual([]);
    expect(article.output).toEqual({
      title: 'A Wizard of Earthsea',
      image: 'https://upload.wikimedia.org/wikipedia/en/thumb/wizard.jpg/1200px-wizard.jpg',
      summary:
        'A Wizard of Earthsea is a fantasy novel written by American author Ursula K. Le Guin and first published in 1968.',
      details: [
        { label: 'Author', value: 'Ursula K. Le Guin' },
        { label: 'Publisher', value: 'Parnassus Press' },
        { label: 'Publication date', value: '1968' },
        { label: 'Pages', value: '205' },
      ],
    });
    expect(article.response?.preview).toContain('Parnassus Press');
  });

  it('caches responses and records the last call', async () => {
    const created = await admin.post<SourceDto>('/api/sources', {
      name: 'Counted',
      baseUrl: mock.url,
      rateLimit: { requests: 100, perSeconds: 1 },
    });
    const ep = await admin.post<EndpointDto>(`/api/sources/${created.body.id}/endpoints`, {
      key: 'list',
      name: 'List',
      path: '/counted',
      map: { results: 'items', id: 'id', title: 'name' },
    });
    expect(ep.status).toBe(201);
    const source = (await admin.get<SourceDto>(`/api/sources/${created.body.id}`)).body;
    const first = await run(source, 'list', {}, true);
    const second = await run(source, 'list', {}, true);
    expect(first.response?.cached).toBe(false);
    expect(second.response?.cached).toBe(true);
    expect(second.output).toEqual(first.output);
    expect(mock.hits('/counted')).toBe(1);
    const after = (await admin.get<SourceDto>(`/api/sources/${created.body.id}`)).body;
    expect(after.lastCall).toMatchObject({ ok: true, status: 200 });

    const dupe = await admin.post(`/api/sources/${created.body.id}/endpoints`, { key: 'list', name: 'Again' });
    expect(dupe.status).toBe(409);
  });

  it('exports recipes without secrets and imports them back', async () => {
    const sources = (await admin.get<SourceDto[]>('/api/sources')).body;
    const igdb = sources.find((s) => s.name === 'IGDB') as SourceDto;
    const exported = await admin.get<Record<string, unknown>>(`/api/sources/${igdb.id}/export`);
    expect(exported.raw.headers['content-disposition']).toContain('igdb.precious.json');
    const text = JSON.stringify(exported.body);
    expect(text).not.toContain('my-client');
    expect(exported.body).toMatchObject({
      format: 'precious-recipe',
      version: 1,
      secretNames: ['clientId', 'clientSecret'],
    });

    const imported = await admin.post<{ source: SourceDto; missingSecrets: string[] }>(
      '/api/sources/import',
      exported.body,
    );
    expect(imported.status).toBe(201);
    expect(imported.body.source.endpoints.map((e) => e.key).sort()).toEqual(['details', 'search']);
    expect(imported.body.source.secrets).toEqual([]);
    expect(imported.body.missingSecrets).toEqual(['clientId', 'clientSecret']);

    const broken = await admin.post('/api/sources/import', { format: 'something-else' });
    expect(broken.status).toBe(400);
  });

  it('deletes sources with their endpoints', async () => {
    const sources = (await admin.get<SourceDto[]>('/api/sources')).body;
    const target = sources.find((s) => s.name === 'Counted') as SourceDto;
    expect((await admin.del(`/api/sources/${target.id}`)).status).toBe(204);
    expect((await admin.get(`/api/sources/${target.id}`)).status).toBe(404);
  });
});
