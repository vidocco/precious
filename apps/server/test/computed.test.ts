import type {
  CollectionDto,
  ComputedStatus,
  FormulaTryResult,
  HistoryPoint,
  ItemDto,
  ItemHistoryPoint,
  SourceDto,
  TemplateDto,
} from '@precious/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computedState } from '../src/db/schema.ts';
import { dueNow, runDue } from '../src/services/computed.ts';
import { type Client, setupHousehold, startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';
import { json, startMockServer } from './mock-server.ts';

describe.runIf(TEST_DATABASE_URL)('values kept up to date', () => {
  let server: TestServer;
  let admin: Client;
  let member: Client;
  let mock: Awaited<ReturnType<typeof startMockServer>>;
  const prices: Record<string, number | null> = { a: 25, b: 8 };
  let endpointId: string;
  let lookupId: string;
  let template: TemplateDto;
  let collection: CollectionDto;
  let itemA: ItemDto;
  let itemB: ItemDto;

  const env = () => ({ db: server.database.db, rt: server.connectors });
  const state = async (itemId: string) =>
    server.database.db.select().from(computedState).where(eq(computedState.itemId, itemId));
  const get = async (id: string) => (await member.get<ItemDto>(`/api/items/${id}`)).body;

  beforeAll(async () => {
    server = await startTestServer();
    ({ admin, member } = await setupHousehold(server.app));
    mock = await startMockServer({
      '/price/a': (_req, res) =>
        prices.a === null ? json(res, { error: 'gone' }, 404) : json(res, { price: prices.a }),
      '/price/b': (_req, res) => json(res, { price: prices.b }),
    });
    const s = await admin.post<SourceDto>('/api/sources', {
      name: 'Prices',
      baseUrl: mock.url,
      rateLimit: { requests: 100, perSeconds: 1 },
      cacheSeconds: 0,
    });
    const e = await admin.post<{ id: string }>(`/api/sources/${s.body.id}/endpoints`, {
      key: 'price',
      name: 'Price',
      role: 'compute',
      path: '/price/{{ refs.shop }}',
      map: { value: 'price' },
    });
    endpointId = e.body.id;
    const l = await admin.post<{ id: string }>(`/api/sources/${s.body.id}/endpoints`, {
      key: 'lookup',
      name: 'Lookup',
      role: 'lookup',
      path: '/price/{{ refs.shop }}',
      map: { price: 'price' },
    });
    lookupId = l.body.id;
  });
  afterAll(async () => {
    await mock?.close();
    await server?.close();
  });

  const fields = [
    { id: 'price', label: 'Price', type: 'money', options: { currency: 'EUR' } },
    { id: 'hours', label: 'Hours', type: 'number' },
    { id: 'per_hour', label: 'Per hour', type: 'money', options: { currency: 'EUR' } },
  ];
  const bindings = (extra: Record<string, unknown> = {}) => ({
    computed: [
      { kind: 'source', field: 'price', endpointId, schedule: { every: 'day', at: '04:00' }, ...extra },
      { kind: 'formula', field: 'per_hour', formula: 'price / hours' },
    ],
  });

  it('checks scheduled endpoints and formulas', async () => {
    const base = { name: 'Games', accessionPrefix: 'GM', fields };
    const wrongRole = await admin.post<{ issues: { path: string }[] }>('/api/templates', {
      ...base,
      bindings: { computed: [{ kind: 'source', field: 'price', endpointId: lookupId }] },
    });
    expect(wrongRole.status).toBe(400);
    expect(wrongRole.body.issues[0]?.path).toBe('bindings.computed.0.endpointId');
    const badFormula = await admin.post<{ issues: { path: string }[] }>('/api/templates', {
      ...base,
      bindings: { computed: [{ kind: 'formula', field: 'per_hour', formula: 'price / (hours' }] },
    });
    expect(badFormula.status).toBe(400);
    expect(badFormula.body.issues[0]?.path).toBe('bindings.computed.0.formula');

    const ok = await admin.post<TemplateDto>('/api/templates', { ...base, bindings: bindings() });
    expect(ok.status).toBe(201);
    template = ok.body;
    collection = (
      await admin.post<CollectionDto>('/api/collections', {
        templateId: template.id,
        name: 'Games',
        editAccess: 'household',
      })
    ).body;
  });

  it('calculates formulas when an item is saved, and schedules lookups straight away', async () => {
    const before = Date.now();
    const res = await member.post<ItemDto>(`/api/collections/${collection.id}/items`, {
      title: 'A',
      data: { hours: 10, price: 20, per_hour: 999 },
      externalRefs: { shop: 'a' },
      sources: { price: { name: 'Prices', step: 'computed' } },
    });
    itemA = res.body;
    // The formula overrides whatever was sent for it.
    expect(itemA.data.per_hour).toBe(2);
    expect(itemA.fieldMeta.per_hour).toMatchObject({ source: 'Formula' });
    const [s] = await state(itemA.id);
    expect(s?.field).toBe('price');
    expect(s?.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(s?.nextRunAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

    itemB = (
      await member.post<ItemDto>(`/api/collections/${collection.id}/items`, {
        title: 'B',
        data: { hours: 4 },
        externalRefs: { shop: 'b' },
      })
    ).body;
    expect(itemB.data.per_hour).toBeUndefined();
  });

  it('looks due values up, recalculates and schedules the next run', async () => {
    const now = new Date();
    expect(await runDue(env(), { now })).toBe(2);
    const a = await get(itemA.id);
    expect(a.data.price).toBe(25);
    expect(a.data.per_hour).toBe(2.5);
    expect(a.fieldMeta.price).toMatchObject({ source: 'Prices', step: 'computed' });
    expect((await get(itemB.id)).data).toMatchObject({ price: 8, per_hour: 2 });
    const [s] = await state(itemA.id);
    const next = s?.nextRunAt ?? new Date(0);
    expect(next.getHours()).toBe(4);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(24 * 3600_000);
    // Nothing is due any more.
    expect(await runDue(env())).toBe(0);
  });

  it('keeps the last good value when a lookup fails, and says why', async () => {
    prices.a = null;
    await dueNow(server.database.db, { itemIds: [itemA.id] });
    const now = new Date();
    await runDue(env(), { now });
    const a = await get(itemA.id);
    expect(a.data.price).toBe(25);
    expect(a.fieldMeta.price?.error).toMatch(/404/);
    const [s] = await state(itemA.id);
    expect(s?.failures).toBe(1);
    // Tried again within the hour rather than tomorrow.
    expect((s?.nextRunAt.getTime() ?? 0) - now.getTime()).toBeLessThanOrEqual(3600_000);

    const status = await member.get<ComputedStatus[]>(`/api/templates/${template.id}/computed`);
    expect(status.body).toEqual([
      expect.objectContaining({
        field: 'price',
        items: 2,
        failing: 1,
        waiting: 0,
        lastError: expect.stringMatching(/404/),
      }),
    ]);

    prices.a = 30;
    await runDue(env(), { now: new Date(now.getTime() + 2 * 3600_000) });
    const fixed = await get(itemA.id);
    expect(fixed.data).toMatchObject({ price: 30, per_hour: 3 });
    expect(fixed.fieldMeta.price?.error).toBeUndefined();
    expect((await state(itemA.id))[0]?.failures).toBe(0);
  });

  it('keeps history for items and the whole collection', async () => {
    const h = await member.get<ItemHistoryPoint[]>(`/api/items/${itemA.id}/history?field=price`);
    expect(h.body.map((p) => p.value)).toEqual([25, 30]);
    const c = await member.get<HistoryPoint[]>(`/api/collections/${collection.id}/history?field=price&days=7`);
    expect(c.body).toHaveLength(7);
    expect(c.body.at(-1)).toMatchObject({ total: 38, items: 2 });
    expect(c.body[0]).toMatchObject({ total: 0, items: 0 });
  });

  it('leaves values edited by hand alone until unlocked', async () => {
    const edited = await member.patch<ItemDto>(`/api/items/${itemA.id}`, { data: { price: 50 } });
    expect(edited.body.data.per_hour).toBe(5);
    expect(edited.body.fieldMeta.price?.locked).toBe(true);
    await dueNow(server.database.db, { itemIds: [itemA.id] });
    await runDue(env());
    expect((await get(itemA.id)).data.price).toBe(50);

    await member.patch(`/api/items/${itemA.id}`, { unlock: ['price'] });
    prices.a = 31;
    const now = await member.post<{ item: ItemDto; updated: string[] }>(`/api/items/${itemA.id}/compute`);
    expect(now.body.updated).toEqual(['price']);
    expect(now.body.item.data).toMatchObject({ price: 31, per_hour: 3.1 });
  });

  it('follows template changes: formulas, schedules and removed fields', async () => {
    const {
      id: _i,
      createdBy: _c,
      version: _v,
      createdAt: _ca,
      updatedAt: _u,
      usage: _us,
      canEdit: _ce,
      ...input
    } = template;
    const weekly = {
      computed: [
        { kind: 'source', field: 'price', endpointId, schedule: { every: 'week', day: 1, at: '06:00' } },
        { kind: 'formula', field: 'per_hour', formula: '$round(price / hours * 60, 2)' },
      ],
    };
    const res = await admin.put<TemplateDto>(`/api/templates/${template.id}`, { ...input, bindings: weekly });
    expect(res.status).toBe(200);
    expect((await get(itemA.id)).data.per_hour).toBe(186);
    const [s] = await state(itemA.id);
    expect(s?.nextRunAt.getDay()).toBe(1);
    expect(s?.nextRunAt.getHours()).toBe(6);

    await admin.put(`/api/templates/${template.id}`, { ...input, bindings: { computed: [weekly.computed[1]] } });
    expect(await state(itemA.id)).toEqual([]);
  });

  it('previews formulas', async () => {
    const ok = await member.post<FormulaTryResult>('/api/formula/try', {
      formula: 'price / hours',
      data: { price: 30, hours: 12 },
    });
    expect(ok.body).toEqual({ value: 2.5 });
    const bad = await member.post<FormulaTryResult>('/api/formula/try', { formula: 'price /', data: {} });
    expect(bad.body.error).toBeTruthy();
  });
});
