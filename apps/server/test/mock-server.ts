import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

export interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

type Handler = (req: Recorded, res: ServerResponse) => void;

/** A tiny stand-in for remote APIs and websites, recording every request it gets. */
export async function startMockServer(routes: Record<string, Handler> = {}) {
  const requests: Recorded[] = [];
  const counters = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const rec = { method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, body };
      requests.push(rec);
      const path = (req.url ?? '/').split('?')[0] as string;
      counters.set(path, (counters.get(path) ?? 0) + 1);
      const handler = routes[`${req.method} ${path}`] ?? routes[path] ?? defaultRoutes[path];
      if (handler) handler(rec, res);
      else {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    hits: (path: string) => counters.get(path) ?? 0,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export const json = (res: ServerResponse, data: unknown, status = 200) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
};

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const defaultRoutes: Record<string, Handler> = {
  '/search.json': (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams.get('q') ?? '';
    json(res, {
      numFound: 2,
      docs: [
        { key: '/works/OL1W', title: `${q} first`, author_name: ['Ana', 'Bea'], first_publish_year: 1999, cover_i: 42 },
        { key: '/works/OL2W', title: `${q} second`, author_name: ['Carla'] },
      ],
    });
  },
  '/release/88141': (_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(fixture('release.html'));
  },
  '/catalogue.xml': (_req, res) => {
    res.setHeader('content-type', 'application/xml');
    res.end(
      '<items total="2"><item id="7"><name>Catan</name><year>1995</year></item><item id="8"><name>Azul</name><year>2017</year></item></items>',
    );
  },
};
