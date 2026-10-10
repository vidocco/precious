import type { TemplateDto } from '@precious/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { templates } from '../src/db/schema.ts';
import { fillStarterShelves } from '../src/db/seed.ts';
import { type Client, setupHousehold, startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';

describe.runIf(TEST_DATABASE_URL)('shelf settings', () => {
  let server: TestServer;
  let admin: Client;

  beforeAll(async () => {
    server = await startTestServer();
    ({ admin } = await setupHousehold(server.app));
  });
  afterAll(async () => {
    await server?.close();
  });

  const books = async () =>
    (await admin.get<TemplateDto[]>('/api/templates')).body.find((t) => t.name === 'Books') as TemplateDto;

  it('gives starter templates their shelves, and older ones get them filled in', async () => {
    const b = await books();
    expect(b.shelf.thickness).toMatchObject({ field: 'pages', factor: 0.005 });
    const { db } = server.database;
    await db.update(templates).set({ shelf: null }).where(eq(templates.id, b.id));
    expect((await books()).shelf.thickness.field).toBeNull();
    expect(await fillStarterShelves(db)).toBe(1);
    expect((await books()).shelf.thickness.field).toBe('pages');
  });

  it('rejects shelf rules that read a field that is not a number', async () => {
    const {
      id: _i,
      createdBy: _c,
      version: _v,
      createdAt: _ca,
      updatedAt: _u,
      usage: _us,
      canEdit: _ce,
      ...input
    } = await books();
    const res = await admin.put<{ issues: { path: string }[] }>(`/api/templates/${_i}`, {
      ...input,
      shelf: { ...input.shelf, thickness: { ...input.shelf.thickness, field: 'author' } },
    });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((i) => i.path)).toContain('shelf.thickness.field');
  });

  it('keeps a size measured while a field’s value sets the other', async () => {
    const {
      id,
      createdBy: _c,
      version: _v,
      createdAt: _ca,
      updatedAt: _u,
      usage: _us,
      canEdit: _ce,
      ...input
    } = await books();
    const shelf = {
      ...input.shelf,
      by: 'rules',
      rulesField: 'author',
      rules: [{ values: ['Borges'], thickness: 2, height: 18 }],
      measured: ['thickness'],
    };
    const res = await admin.put<TemplateDto>(`/api/templates/${id}`, { ...input, shelf });
    expect(res.status).toBe(200);
    expect(res.body.shelf).toMatchObject({ by: 'rules', measured: ['thickness'], thickness: { field: 'pages' } });
    // The measured size still has to read a number.
    const bad = await admin.put<{ issues: { path: string }[] }>(`/api/templates/${id}`, {
      ...input,
      shelf: { ...shelf, thickness: { ...shelf.thickness, field: 'author' } },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.issues.map((i) => i.path)).toEqual(['shelf.thickness.field']);
    // Back to both sizes by the rules: nothing extra is kept.
    const both = await admin.put<TemplateDto>(`/api/templates/${id}`, {
      ...input,
      shelf: { ...shelf, measured: undefined },
    });
    expect(both.body.shelf).not.toHaveProperty('measured');
  });
});
