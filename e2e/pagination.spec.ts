import { expect, test } from '@playwright/test';
import { signInAsAdmin } from './helpers.ts';

test('"Show more" keeps loading past 200 items, a page at a time', async ({ page }) => {
  await signInAsAdmin(page);
  const api = page.request;
  const origin = { origin: new URL(page.url()).origin };
  const templates = await (await api.get('/api/templates')).json();
  const books = templates.find((t: { name: string }) => t.name === 'Books');
  const c = await (
    await api.post('/api/collections', { headers: origin, data: { templateId: books.id, name: 'Big library' } })
  ).json();
  const total = 250;
  for (let start = 0; start < total; start += 25) {
    await Promise.all(
      Array.from({ length: Math.min(25, total - start) }, (_, k) =>
        api.post(`/api/collections/${c.id}/items`, {
          headers: origin,
          data: { title: `Book ${String(start + k + 1).padStart(3, '0')}`, data: { author: 'Someone' } },
        }),
      ),
    );
  }

  // Every request for items asks for one page, however many are already shown.
  const limits: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (r.method() === 'GET' && url.pathname === `/api/collections/${c.id}/items`)
      limits.push(url.searchParams.get('limit') ?? '');
  });

  await page.goto(`/c/${c.id}?view=table`);
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(60);
  for (const [shown, left] of [
    [120, 190],
    [180, 130],
    [240, 70],
    [250, 10],
  ] as const) {
    await page.getByRole('button', { name: `Show more (${left} left)` }).click();
    await expect(rows).toHaveCount(shown);
  }
  await expect(page.getByRole('button', { name: /Show more/ })).toHaveCount(0);
  await expect(page.getByText('Some values are not valid')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Book 001', exact: true })).toBeVisible();
  expect(new Set(limits)).toEqual(new Set(['60']));
});
