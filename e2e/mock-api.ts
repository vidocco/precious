/**
 * Stand-in for remote APIs and websites during end-to-end tests:
 * a JSON search that needs an API key, and an HTML release page.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const port = Number(process.env.MOCK_PORT ?? 3401);
const page = readFileSync(join(import.meta.dirname, '../apps/server/test/fixtures/release.html'), 'utf8');

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
  if (url.pathname.startsWith('/release/')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(page);
  }
  res.statusCode = 404;
  res.end('not found');
}).listen(port);
