import { healthResponseSchema } from '@precious/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createDb } from '../src/db/client.ts';

describe('GET /api/health', () => {
  it('reports ok when the database answers', async () => {
    const app = buildApp({ pingDatabase: async () => true });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('reports degraded with 503 when the database is down', async () => {
    const app = buildApp({ pingDatabase: async () => false });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', database: 'down' });
  });
});

describe.runIf(process.env.DATABASE_URL)('database connectivity', () => {
  it('pings a real Postgres', async () => {
    const database = createDb(process.env.DATABASE_URL as string);
    try {
      expect(await database.ping()).toBe(true);
    } finally {
      await database.close();
    }
  });
});
