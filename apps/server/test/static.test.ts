import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';

describe.runIf(TEST_DATABASE_URL)('serving the web app', () => {
  let server: TestServer;

  beforeAll(async () => {
    const dist = mkdtempSync(join(tmpdir(), 'precious-web-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Precious</title>');
    writeFileSync(join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    writeFileSync(join(dist, 'manifest.webmanifest'), '{"name":"Precious"}');
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    server = await startTestServer({ WEB_DIST_DIR: dist });
  });
  afterAll(async () => {
    await server?.close();
  });

  const get = (url: string) => server.app.inject({ method: 'GET', url });

  it('caches hashed assets for good, and always checks the shell, service worker and manifest', async () => {
    expect((await get('/assets/index-abc123.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    for (const url of ['/', '/sw.js', '/manifest.webmanifest', '/c/some-collection']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['cache-control'], url).toBe('no-cache');
    }
    expect((await get('/c/some-collection')).body).toContain('<title>Precious</title>');
  });
});
