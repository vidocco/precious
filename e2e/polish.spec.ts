import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signInAsAdmin } from './helpers.ts';

test('books sit on a shelf sized by their pages and height, and lift when hovered', async ({ page }) => {
  await signInAsAdmin(page);
  const api = page.request;
  const origin = { origin: new URL(page.url()).origin };
  const templates = await (await api.get('/api/templates')).json();
  const books = templates.find((t: { name: string }) => t.name === 'Books');
  const c = await (
    await api.post('/api/collections', { headers: origin, data: { templateId: books.id, name: 'Shelf books' } })
  ).json();
  for (const [title, pages, height_cm, status] of [
    ['Thin', 100, 18, 'Read'],
    ['Thick', 900, 24, 'Read'],
    ['Leaning', 300, 20, 'Reading'],
    ['Neighbour', 300, 20, 'Read'],
  ] as const) {
    await api.post(`/api/collections/${c.id}/items`, {
      headers: origin,
      data: { title, data: { author: 'Someone', pages, height_cm, status } },
    });
  }

  await page.goto(`/c/${c.id}`);
  await expect(page.getByRole('link', { name: /Neighbour/ })).toBeVisible();
  await page.getByRole('radio', { name: 'Shelf' }).click();
  await expect(page).toHaveURL(/view=shelf/);
  await expect(page.getByText('Thickness from Pages × 0.005 + 0.3 cm')).toBeVisible();
  const box = async (name: string) =>
    (await page.getByRole('link', { name, exact: true }).boundingBox()) ?? { width: 0, height: 0, x: 0, y: 0 };
  // 8 px a centimetre of height; thickness doubled.
  expect(Math.round((await box('Thick')).height)).toBe(192);
  expect(Math.round((await box('Thin')).height)).toBe(144);
  expect((await box('Thick')).width).toBeGreaterThan((await box('Thin')).width * 2.5);
  const leaning = page.getByRole('link', { name: 'Leaning' });
  await expect(leaning).toHaveAttribute('style', /rotate\(8deg\)/);

  // Hovering lifts it, straightens it and moves its neighbour aside (newest first, so it's on the left).
  await leaning.hover();
  await expect(leaning).toHaveAttribute('style', /translateY\(-16px\) rotate\(0deg\)/);
  await expect(page.getByRole('link', { name: 'Neighbour' })).toHaveAttribute('style', /translateX\(-10px\)/);
  await leaning.click();
  await expect(page.getByRole('heading', { name: 'Leaning' })).toBeVisible();

  // The template's Shelf tab previews changes.
  await page.goto(`/data/templates/${books.id}`);
  await page.getByRole('tab', { name: 'Shelf' }).click();
  await page.getByRole('radio', { name: 'Same for every item' }).click();
  await expect(page.getByText('Every item 2.5 × 21 cm')).toBeVisible();
});

test('a CSV file imports into a collection and exports back', async ({ page }) => {
  await signInAsAdmin(page);
  const api = page.request;
  const origin = { origin: new URL(page.url()).origin };
  const templates = await (await api.get('/api/templates')).json();
  const games = templates.find((t: { name: string }) => t.name === 'Video games');
  const c = await (
    await api.post('/api/collections', { headers: origin, data: { templateId: games.id, name: 'Imported games' } })
  ).json();

  await page.goto('/data/import');
  await page.getByLabel('Collection to import into').selectOption({ label: 'Imported games' });
  await page.getByLabel('CSV file').setInputFiles({
    name: 'games.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Title;Platform;Status;Notes\nCeleste;switch;Completed;"Strawberries; all"\nOkami;PS2;Playing;\n',
    ),
  });
  await expect(page.getByText('games.csv · 2 rows · semicolons')).toBeVisible();
  await expect(page.getByLabel('Column Platform fills')).toHaveValue('platform');
  await page.getByRole('button', { name: 'Import 2 items into Imported games' }).click();
  await expect(page.getByRole('status')).toContainText('Imported 2 items into Imported games (VG·0001–VG·0002)');

  const download = page.waitForEvent('download');
  await page.getByRole('listitem').filter({ hasText: 'Imported games' }).getByRole('link', { name: 'CSV' }).click();
  const file = await (await download).path();
  const csv = readFileSync(file, 'utf8');
  expect(csv).toContain('VG·0001,Celeste,Switch');
  expect(csv).toContain('"Strawberries; all"');
  expect(c.id).toBeTruthy();
});

test('the app can be installed and its service worker is served', async ({ page }) => {
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).icons).toHaveLength(3);
  const sw = await page.request.get('/sw.js');
  expect(sw.headers()['cache-control']).toBe('no-cache');
  await page.goto('/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
});

test('scanning a barcode fills the search', async ({ page }) => {
  // A stand-in for the browser's barcode reader; the camera is Chromium's fake one.
  await page.addInitScript(() => {
    class FakeDetector {
      static getSupportedFormats = async () => ['ean_13'];
      calls = 0;
      async detect() {
        this.calls++;
        return this.calls > 2 ? [{ rawValue: '9780441478125' }] : [];
      }
    }
    Object.assign(window, { BarcodeDetector: FakeDetector });
  });
  await signInAsAdmin(page);
  const api = page.request;
  const origin = { origin: new URL(page.url()).origin };
  const src = await (
    await api.post('/api/sources/import', {
      headers: origin,
      data: {
        format: 'precious-recipe',
        version: 1,
        source: { name: 'Scan source', baseUrl: 'http://127.0.0.1:3401', rateLimit: { requests: 50, perSeconds: 1 } },
        endpoints: [
          {
            key: 'search',
            name: 'Search',
            role: 'search',
            path: '/games/search',
            query: [{ name: 'q', value: '{{ query }}' }],
            map: { results: '$', id: 'id', title: 'name' },
          },
        ],
      },
    })
  ).json();
  const template = await (
    await api.post('/api/templates', {
      headers: origin,
      data: {
        name: 'Scannable',
        bindings: {
          search: [{ id: 'scan', endpointId: src.source.endpoints[0].id, ref: 'scan', fill: { $title: 'title' } }],
        },
      },
    })
  ).json();
  const c = await (
    await api.post('/api/collections', { headers: origin, data: { templateId: template.id, name: 'Scannable' } })
  ).json();
  await page.goto(`/c/${c.id}`);
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByRole('button', { name: 'Scan a barcode' }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('9780441478125', { timeout: 10_000 });
  await expect(page.getByText(/results? from Scan source/)).toBeVisible();
});
