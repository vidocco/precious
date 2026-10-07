import { type EndpointData, endpointInputSchema, type RunInput, sourceInputSchema } from '@precious/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenCache } from '../src/connectors/auth.ts';
import { extract, loadHtml, previewHtml } from '../src/connectors/html.ts';
import { send } from '../src/connectors/http.ts';
import { RateLimiter } from '../src/connectors/limiter.ts';
import { evaluate, mapOutput } from '../src/connectors/map.ts';
import { graphqlData, parseBody } from '../src/connectors/parse.ts';
import { createRuntime, joinUrl, runEndpoint, type SourceForRun } from '../src/connectors/runner.ts';
import { decryptSecret, encryptSecret, maskHeader, maskSecrets } from '../src/connectors/secrets.ts';
import { render } from '../src/connectors/template.ts';
import type { Db } from '../src/db/client.ts';
import { json, startMockServer } from './mock-server.ts';

const APP_SECRET = 'unit-test-secret-unit-test-secret-000000';
const tctx = {
  query: 'Zelda "Ocarina"',
  refs: { igdb: '1022' },
  item: { title: 'Lanterns' },
  previous: {},
  secrets: { key: 's3cr3t' },
};

describe('templates', () => {
  it('renders context values and escapes for JSON and URLs', async () => {
    expect(await render('search "{{ query | json_escape }}";', tctx, 'body')).toBe('search "Zelda \\"Ocarina\\"";');
    expect(await render('/games/{{ refs.igdb }}?q={{ query | url_encode }}', tctx, 'path')).toBe(
      '/games/1022?q=Zelda+%22Ocarina%22',
    );
    expect(await render('{{ item.title | json }}', tctx, 'x')).toBe('"Lanterns"');
    expect(await render('{{ missing | default: "none" }}', tctx, 'x')).toBe('none');
  });

  it('reports bad templates as template errors', async () => {
    await expect(render('{{ query | nope }}', tctx, 'path')).rejects.toMatchObject({ stage: 'template' });
  });
});

describe('secrets', () => {
  it('encrypts with a fresh IV and decrypts back', () => {
    const a = encryptSecret(APP_SECRET, 'hunter2');
    const b = encryptSecret(APP_SECRET, 'hunter2');
    expect(a.ct).not.toBe(b.ct);
    expect(decryptSecret(APP_SECRET, a)).toBe('hunter2');
    expect(() => decryptSecret('another-secret-another-secret-0000000000', a)).toThrow();
  });

  it('masks secrets and credential headers', () => {
    expect(maskSecrets('https://x.test/?key=s3cr3t&q=1', ['s3cr3t'])).toBe('https://x.test/?key=••••••••&q=1');
    expect(maskHeader('Authorization', 'Bearer abc.def', [])).toBe('Bearer ••••••••');
    expect(maskHeader('X-Api-Key', 'whatever', [])).toBe('••••••••');
    expect(maskHeader('Client-ID', 'abc123', ['abc123'])).toBe('••••••••');
  });
});

describe('http', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>;
  let flaky = 0;
  beforeAll(async () => {
    server = await startMockServer({
      '/flaky': (_req, res) => {
        flaky++;
        if (flaky < 3) {
          res.statusCode = 503;
          res.setHeader('retry-after', '0');
          res.end('busy');
        } else json(res, { ok: true });
      },
      '/huge': (_req, res) => {
        res.end('x'.repeat(2048));
      },
    });
  });
  afterAll(() => server.close());

  it('retries 503 responses, honouring Retry-After', async () => {
    const res = await send({ method: 'GET', url: new URL(`${server.url}/flaky`), headers: new Headers() });
    expect(res.status).toBe(200);
    expect(server.hits('/flaky')).toBe(3);
  });

  it('refuses responses over the size cap', async () => {
    await expect(
      send({ method: 'GET', url: new URL(`${server.url}/huge`), headers: new Headers() }, { maxBytes: 1024 }),
    ).rejects.toMatchObject({ stage: 'http', message: expect.stringContaining('larger than') });
  });

  it('explains unreachable hosts', async () => {
    await expect(
      send({ method: 'GET', url: new URL('http://127.0.0.1:1/'), headers: new Headers() }, { retries: 0 }),
    ).rejects.toMatchObject({ stage: 'http', message: expect.stringContaining("Couldn't reach") });
  });
});

describe('rate limiter', () => {
  it('spaces requests out per source', async () => {
    const limiter = new RateLimiter();
    const started = Date.now();
    for (let i = 0; i < 3; i++) await limiter.wait('a', { requests: 10, perSeconds: 1 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
    const other = Date.now();
    await limiter.wait('b', { requests: 10, perSeconds: 1 });
    expect(Date.now() - other).toBeLessThan(50);
  });
});

describe('parsing', () => {
  it('parses JSON and XML and explains bad JSON', () => {
    expect(parseBody('json', '{"a":1}')).toEqual({ a: 1 });
    const x = parseBody('xml', '<items total="2"><item id="7"><name>Catan</name></item></items>') as {
      items: { '@total': number; item: { '@id': number; name: string } };
    };
    expect(x.items['@total']).toBe(2);
    expect(x.items.item.name).toBe('Catan');
    expect(() => parseBody('json', '<html>')).toThrow(/isn't valid JSON/);
  });

  it('treats GraphQL errors as failures unless partial results are allowed', () => {
    expect(() => graphqlData({ errors: [{ message: 'Bad query' }] }, false)).toThrow(/Bad query/);
    expect(() => graphqlData({ data: { a: 1 }, errors: [{ message: 'Partly' }] }, false)).toThrow(/Partly/);
    expect(graphqlData({ data: { a: 1 }, errors: [{ message: 'Partly' }] }, true)).toEqual({ a: 1 });
  });
});

describe('HTML extraction', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('./fixtures/release.html', import.meta.url), 'utf8');
  const doc = loadHtml(html, 'https://records.example.com/release/88141');

  it('extracts with CSS, XPath, attributes, regex and conversions', () => {
    const out = extract(
      doc,
      {
        title: { css: 'h1.release-title' },
        year: { css: '.meta .year', regex: '(\\d{4})', as: 'number' },
        price: { css: '.meta .price', as: 'number' },
        genres: { css: '.genres a', many: true },
        genreLinks: { css: '.genres a', value: 'attr:href', absoluteUrl: true, many: true },
        lead: { css: 'p.lead', value: 'html' },
        leadOwn: { css: 'p.lead', value: 'ownText' },
        tracks: {
          css: 'table.tracklist tr',
          many: true,
          fields: {
            position: { css: 'td:nth-child(1)' },
            name: { css: 'td:nth-child(2)' },
            length: { xpath: './td[3]/text()' },
          },
        },
        missing: { css: '.nope', default: 'n/a' },
        missingList: { css: '.nope', many: true },
      },
      'https://records.example.com/release/88141',
    );
    expect(out).toMatchObject({
      title: 'Low Tide Sermons',
      year: 1998,
      price: 1234.5,
      genres: ['Folk', 'Ambient'],
      genreLinks: ['https://records.example.com/g/folk', 'https://records.example.com/g/ambient'],
      lead: 'Recorded <b>live</b> in a harbour chapel.',
      leadOwn: 'Recorded in a harbour chapel.',
      missing: 'n/a',
      missingList: [],
    });
    expect(out.tracks).toEqual([
      { position: 'A1', name: 'Harbour Hymn', length: '4:12' },
      { position: 'A2', name: 'Brine Choir', length: '3:47' },
      { position: 'B1', name: 'The Long Ebb', length: '6:05' },
    ]);
  });

  it('reads JSON-LD, meta tags and embedded script JSON', () => {
    const out = extract(
      doc,
      {
        album: { jsonld: 'MusicAlbum' },
        all: { jsonld: true, many: true },
        image: { meta: 'og:image', absoluteUrl: true },
        card: { meta: 'twitter:card' },
        next: { scriptJson: 'script#__NEXT_DATA__' },
      },
      'https://records.example.com/release/88141',
    );
    expect((out.album as { name: string }).name).toBe('Low Tide Sermons');
    expect(out.all).toHaveLength(2);
    expect(out.image).toBe('https://records.example.com/img/88141-cover.jpg');
    expect(out.card).toBe('summary');
    expect((out.next as { props: { pageProps: { release: { weight: string } } } }).props.pageProps.release.weight).toBe(
      '180 g',
    );
  });

  it('reports invalid selectors with their path', () => {
    expect(() => extract(doc, { bad: { css: 'td:nth-child(' } }, 'https://x.test')).toThrow(
      /bad: .* not a valid CSS selector/,
    );
    expect(() => extract(doc, { bad: { xpath: '//td[' } }, 'https://x.test')).toThrow(/not a valid XPath/);
  });

  it('makes a preview without scripts, handlers or frames', () => {
    const preview = previewHtml(doc, 'https://records.example.com/release/88141');
    expect(preview).not.toMatch(/<script|onload=|onclick=|<iframe/i);
    expect(preview).toContain('<base href="https://records.example.com/release/88141">');
    expect(preview).toContain('Harbour Hymn');
  });
});

describe('mapping', () => {
  it('maps search results relative to each result', async () => {
    const out = await mapOutput(
      'search',
      { results: 'docs', id: 'key', title: 'title', subtitle: "$join(author_name, ', ')", year: 'first_publish_year' },
      {
        docs: [
          { key: 'a', title: 'One', author_name: ['X', 'Y'], first_publish_year: 2001 },
          { key: 'b', title: 'Two' },
        ],
      },
    );
    expect(out).toEqual([
      { id: 'a', title: 'One', subtitle: 'X, Y', year: 2001 },
      { id: 'b', title: 'Two' },
    ]);
  });

  it('maps lookups and computed values', async () => {
    expect(await mapOutput('lookup', { pages: 'number_of_pages', blank: '' }, { number_of_pages: 312 })).toEqual({
      pages: 312,
    });
    expect(await mapOutput('compute', { value: '$number(price.loose) / 100' }, { price: { loose: '6450' } })).toBe(
      64.5,
    );
  });

  it('stops runaway expressions and reports syntax errors', async () => {
    await expect(evaluate('($f := function($n) { $f($n + 1) }; $f(0))', {}, 'loop')).rejects.toMatchObject({
      stage: 'map',
    });
    await expect(evaluate('title +', {}, 'title')).rejects.toMatchObject({
      stage: 'map',
      message: expect.stringContaining('title:'),
    });
  });
});

describe('runner', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>;
  let tokenCalls = 0;
  let rejectNextGames = false;
  beforeAll(async () => {
    server = await startMockServer({
      'POST /oauth2/token': (req, res) => {
        tokenCalls++;
        const form = new URLSearchParams(req.body);
        if (form.get('client_secret') !== 'twitch-secret') return json(res, { message: 'invalid client' }, 403);
        json(res, { access_token: `token-${tokenCalls}`, expires_in: 5000000 });
      },
      'POST /v4/games': (req, res) => {
        if (rejectNextGames) {
          rejectNextGames = false;
          return json(res, { message: 'expired' }, 401);
        }
        if (req.headers.authorization !== `Bearer token-${tokenCalls}` || req.headers['client-id'] !== 'abc') {
          return json(res, { message: 'unauthorised' }, 401);
        }
        json(res, [{ id: 1022, name: req.body.match(/search "([^"]+)"/)?.[1] ?? '?', cover: { image_id: 'co1' } }]);
      },
      'POST /graphql': (req, res) => {
        const { query, variables } = JSON.parse(req.body);
        if (!query.includes('Page')) return json(res, { errors: [{ message: 'Cannot query field' }] });
        json(res, { data: { Page: { media: [{ id: 5, title: { english: variables.search } }] } } });
      },
    });
  });
  afterAll(() => server.close());

  const rt = createRuntime({} as Db, APP_SECRET);
  const source = (patch: Partial<SourceForRun> = {}): SourceForRun => ({
    ...sourceInputSchema.parse({ name: 'Mock', baseUrl: server.url, rateLimit: { requests: 100, perSeconds: 1 } }),
    id: `src-${Math.random()}`,
    secrets: {},
    ...patch,
  });
  const endpoint = (patch: Record<string, unknown>): EndpointData =>
    endpointInputSchema.parse({ key: 'e', name: 'E', ...patch });
  const run = (s: SourceForRun, e: EndpointData, input: RunInput = {}) =>
    runEndpoint(rt, s, e, input, { useCache: false, record: false });

  it('runs a REST search end to end', async () => {
    const res = await run(
      source({ headers: [{ name: 'X-Trace', value: 'q={{ query }}' }] }),
      endpoint({
        path: '/search.json',
        query: [{ name: 'q', value: '{{ query }}' }],
        map: {
          results: 'docs',
          id: 'key',
          title: 'title',
          image: "cover_i ? 'https://covers.test/' & cover_i & '.jpg'",
        },
      }),
      { query: 'dune' },
    );
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.output).toEqual([
      { id: '/works/OL1W', title: 'dune first', image: 'https://covers.test/42.jpg' },
      { id: '/works/OL2W', title: 'dune second' },
    ]);
    expect(res.request?.url).toBe(`${server.url}/search.json?q=dune`);
    expect(res.request?.headers).toContainEqual({ name: 'x-trace', value: 'q=dune' });
  });

  it('authenticates with OAuth2 client credentials and masks secrets', async () => {
    const s = source({
      auth: {
        type: 'oauth2',
        tokenUrl: `${server.url}/oauth2/token`,
        clientId: '{{ secrets.clientId }}',
        secret: 'clientSecret',
      },
      headers: [{ name: 'Client-ID', value: '{{ secrets.clientId }}' }],
      secrets: { clientId: encryptSecret(APP_SECRET, 'abc'), clientSecret: encryptSecret(APP_SECRET, 'twitch-secret') },
    });
    const e = endpoint({
      method: 'POST',
      path: '/v4/games',
      body: { type: 'raw', template: 'search "{{ query | json_escape }}"; fields name;' },
      map: { id: 'id', title: 'name' },
    });
    const first = await run(s, e, { query: 'Kilnheart' });
    expect(first.errors).toEqual([]);
    expect(first.output).toEqual([{ id: '1022', title: 'Kilnheart' }]);
    const shown = JSON.stringify(first.request);
    expect(shown).not.toContain('twitch-secret');
    expect(shown).not.toContain('"abc"');
    expect(shown).toContain('Bearer ••••••••');

    // The token is reused, and refreshed once when the API rejects it.
    const before = tokenCalls;
    await run(s, e, { query: 'Again' });
    expect(tokenCalls).toBe(before);
    rejectNextGames = true;
    const retried = await run(s, e, { query: 'Retry' });
    expect(retried.ok).toBe(true);
    expect(tokenCalls).toBe(before + 1);
  });

  it('says which secret is missing', async () => {
    const res = await run(source({ auth: { type: 'bearer', secret: 'token' } }), endpoint({ path: '/search.json' }));
    expect(res.errors).toEqual([
      { stage: 'auth', message: 'The secret "token" isn\'t set. Add it in the source\'s settings.' },
    ]);
  });

  it('sends GraphQL variables as variables and surfaces GraphQL errors', async () => {
    const e = endpoint({
      kind: 'graphql',
      path: '/graphql',
      graphql: {
        query: 'query ($search: String) { Page { media { id } } }',
        variables: '{ "search": {{ query | json }} }',
      },
      map: { results: 'Page.media', id: 'id', title: 'title.english' },
    });
    const res = await run(source(), e, { query: 'Say "hi"' });
    expect(res.output).toEqual([{ id: '5', title: 'Say "hi"' }]);
    const bad = await run(source(), { ...e, graphql: { ...e.graphql, query: '{ nope }' } });
    expect(bad.errors[0]).toMatchObject({ stage: 'parse', message: expect.stringContaining('Cannot query field') });
  });

  it('scrapes HTML pages into a lookup', async () => {
    const res = await run(
      source(),
      endpoint({
        kind: 'html',
        role: 'lookup',
        path: '/release/{{ refs.shop }}',
        extract: { title: { css: 'h1' }, tracks: { css: 'table.tracklist tr td:nth-child(2)', many: true } },
        map: { title: 'title', tracklist: "$join(tracks, '\\n')" },
      }),
      { refs: { shop: '88141' } },
    );
    expect(res.errors).toEqual([]);
    expect(res.output).toEqual({ title: 'Low Tide Sermons', tracklist: 'Harbour Hymn\nBrine Choir\nThe Long Ebb' });
    expect(res.response?.preview).toContain('Harbour Hymn');
  });

  it('reads XML responses', async () => {
    const res = await run(
      source(),
      endpoint({ path: '/catalogue.xml', map: { results: 'items.item', id: '`@id`', title: 'name', year: 'year' } }),
    );
    expect(res.output).toEqual([
      { id: '7', title: 'Catan', year: 1995 },
      { id: '8', title: 'Azul', year: 2017 },
    ]);
  });

  it('tags each failure with its stage', async () => {
    const notFound = await run(source(), endpoint({ path: '/nope' }));
    expect(notFound.errors[0]).toMatchObject({ stage: 'http', message: expect.stringContaining('404') });
    const invalid = await run(source(), endpoint({ path: '/search.json', map: { results: 'docs', id: 'key' } }));
    expect(invalid.errors[0]).toMatchObject({ stage: 'validate', path: 'results[0].title' });
    expect(invalid.ok).toBe(false);
  });

  it('joins base addresses and paths', () => {
    expect(joinUrl('https://api.test/v4/', '/games')).toBe('https://api.test/v4/games');
    expect(joinUrl('https://api.test/v4', 'games')).toBe('https://api.test/v4/games');
    expect(joinUrl('https://api.test', 'https://other.test/x')).toBe('https://other.test/x');
  });
});

describe('token cache', () => {
  it('reports token endpoint failures as auth errors', async () => {
    const tokens = new TokenCache(async () => new Response('nope', { status: 403 }));
    await expect(
      tokens.get('s', { type: 'oauth2', tokenUrl: 'https://id.test/token', clientId: 'a', secret: 'b' }, 'a', 'b'),
    ).rejects.toMatchObject({ stage: 'auth', message: expect.stringContaining('403') });
  });
});
