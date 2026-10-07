/**
 * Stand-in for remote APIs and websites during end-to-end tests:
 * a JSON search that needs an API key, an HTML release page, and two
 * keyless databases (games and playtimes) for adding items.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const port = Number(process.env.MOCK_PORT ?? 3401);
const page = readFileSync(join(import.meta.dirname, '../apps/server/test/fixtures/release.html'), 'utf8');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
let game: Record<string, unknown> = { developer: 'Hollowpine Studio', genres: ['Adventure'] };

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/health') return res.end('ok');
  if (url.pathname === '/api/search') {
    if (req.headers['x-api-key'] !== 'e2e-key') {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ message: 'Missing or wrong API key' }));
    }
    const q = url.searchParams.get('q') ?? '';
    res.setHeader('content-type', 'application/json');
    return res.end(
      JSON.stringify({
        data: {
          items: [
            { id: 142, name: `Lanterns of Vell (${q})`, studio: { name: 'Hollowpine Studio' }, released: 2019 },
            { id: 143, name: 'Lanterns of Vell: Ember Tide', studio: { name: 'Hollowpine Studio' }, released: 2023 },
          ],
        },
      }),
    );
  }
  // A games database and a playtime database, for adding items from data sources.
  const json = (data: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(data));
  };
  if (url.pathname === '/games/search') {
    return json([
      { id: 7, name: 'Lanterns of Vell', year: 2019, cover: `http://127.0.0.1:${port}/cover.png` },
      { id: 8, name: 'Lanterns of Vell: Ember Tide', year: 2023 },
    ]);
  }
  if (url.pathname === '/games/7') return json(game);
  if (url.pathname === '/games/bump') {
    game = { developer: 'Hollowpine Games', genres: ['Adventure', 'Cozy'] };
    return json(game);
  }
  if (url.pathname === '/times/search') {
    return json([
      { id: 't1', title: 'Lanterns of Vell (Remastered)', year: 2021 },
      { id: 't2', title: 'Lanterns of Vell Deluxe', year: 2019 },
    ]);
  }
  if (url.pathname === '/times/t2') return json({ main: 1410 });
  if (url.pathname === '/cover.png') {
    res.setHeader('content-type', 'image/png');
    return res.end(PNG);
  }
  if (url.pathname.startsWith('/release/')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(page);
  }
  res.statusCode = 404;
  res.end('not found');
}).listen(port);
