import { healthResponseSchema } from '@precious/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';

describe.runIf(TEST_DATABASE_URL)('GET /api/health', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server?.close();
  });

  it('reports ok when the database answers', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('reports degraded with 503 when the database is down', async () => {
    const ping = server.database.ping;
    server.database.ping = async () => false;
    try {
      const res = await server.app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: 'degraded', database: 'down' });
    } finally {
      server.database.ping = ping;
    }
  });
});
