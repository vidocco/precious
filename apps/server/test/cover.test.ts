import type { TemplateDto } from '@precious/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { templates } from '../src/db/schema.ts';
import { type Client, setupHousehold, startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';

describe.runIf(TEST_DATABASE_URL)('cover shapes', () => {
  let server: TestServer;
  let admin: Client;

  beforeAll(async () => {
    server = await startTestServer();
    ({ admin } = await setupHousehold(server.app));
  });
  afterAll(async () => {
    await server?.close();
  });

  const vinyl = async () =>
    (await admin.get<TemplateDto[]>('/api/templates')).body.find((t) => t.name === 'Vinyl') as TemplateDto;
  const inputOf = (t: TemplateDto) => {
    const { id: _i, createdBy: _c, version: _v, createdAt: _ca, updatedAt: _u, usage: _us, canEdit: _ce, ...input } = t;
    return input;
  };

  it('saves a template’s cover shape', async () => {
    const t = await vinyl();
    expect(t.card.cover).toEqual({ width: 1, height: 1, fit: 'crop' });
    const res = await admin.put(`/api/templates/${t.id}`, {
      ...inputOf(t),
      card: { ...t.card, cover: { width: 12, height: 12, fit: 'whole' } },
    });
    expect(res.status).toBe(200);
    expect((await vinyl()).card.cover).toEqual({ width: 12, height: 12, fit: 'whole' });
  });

  it('serves and saves templates stored before shapes existed', async () => {
    const t = await vinyl();
    // As 1.0.0 left it: a card without a cover.
    const { cover: _cover, ...oldCard } = t.card;
    const { db } = server.database;
    await db
      .update(templates)
      .set({ card: oldCard as TemplateDto['card'] })
      .where(eq(templates.id, t.id));
    const stored = await vinyl();
    expect(stored.card.cover).toBeUndefined();
    expect((await admin.get(`/api/collections`)).status).toBe(200);
    // Saving it as it is (an editor that never touched the shape) gives it the default.
    const res = await admin.put(`/api/templates/${t.id}`, inputOf(stored));
    expect(res.status).toBe(200);
    expect((await vinyl()).card.cover).toEqual({ width: 3, height: 4, fit: 'crop' });
  });
});
