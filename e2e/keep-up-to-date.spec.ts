import { expect, test } from '@playwright/test';
import { signInAsAdmin } from './helpers.ts';

const MOCK = 'http://127.0.0.1:3401';

test('values are looked up on a schedule and calculated with formulas', async ({ page }) => {
  await signInAsAdmin(page);
  const api = page.request;
  const origin = { origin: new URL(page.url()).origin };
  const imported = await api.post('/api/sources/import', {
    headers: origin,
    data: {
      format: 'precious-recipe',
      version: 1,
      source: { name: 'Price list', baseUrl: MOCK, rateLimit: { requests: 50, perSeconds: 1 }, cacheSeconds: 0 },
      endpoints: [
        { key: 'price', name: 'Price', role: 'compute', path: '/price/{{ refs.shop }}', map: { value: 'price' } },
      ],
    },
  });
  expect(imported.status()).toBe(201);
  const template = await (
    await api.post('/api/templates', {
      headers: origin,
      data: {
        name: 'Shelf',
        accessionPrefix: 'SH',
        fields: [
          { id: 'price', label: 'Price', type: 'money', options: { currency: 'EUR' } },
          { id: 'hours', label: 'Hours', type: 'number' },
          { id: 'per_hour', label: 'Per hour', type: 'money', options: { currency: 'EUR' } },
        ],
        itemLayout: { info: ['price', 'hours', 'per_hour'], sections: [] },
      },
    })
  ).json();

  // Set both up in the template editor.
  await page.goto(`/data/templates/${template.id}`);
  await page.getByRole('tab', { name: 'Data sources' }).click();
  await page.getByRole('button', { name: 'Keep a field up to date' }).click();
  await expect(page.getByLabel('Field kept up to date')).toHaveValue('price');
  await expect(page.getByText(/Every day at 04:00 \(server time\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep a field up to date' }).click();
  await page.getByLabel('Field kept up to date').nth(1).selectOption({ label: 'Per hour' });
  await page.getByRole('radio', { name: 'Calculated' }).nth(1).check({ force: true });
  await page.getByLabel('Formula').fill('price / hours');
  await expect(page.getByText(/With example values it gives/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  // An item gets its price straight away, and the formula follows.
  const collection = await (
    await api.post('/api/collections', { headers: origin, data: { templateId: template.id, name: 'Shelf' } })
  ).json();
  const item = await (
    await api.post(`/api/collections/${collection.id}/items`, {
      headers: origin,
      data: { title: 'Lanterns of Vell', data: { hours: 10 }, externalRefs: { shop: 'x' } },
    })
  ).json();
  await expect
    .poll(async () => (await (await api.get(`/api/items/${item.id}`)).json()).data, { timeout: 15_000 })
    .toMatchObject({ price: 20, per_hour: 2 });
  await page.goto(`/i/${item.id}`);
  await expect(page.getByText('Price list')).toBeVisible();
  await expect(page.getByText('Formula')).toBeVisible();

  // The status shows on the template.
  await page.goto(`/data/templates/${template.id}`);
  await page.getByRole('tab', { name: 'Data sources' }).click();
  await expect(page.getByText(/1 item · last looked up/)).toBeVisible();

  // Update it now from the item page after the price changes.
  await api.get(`${MOCK}/price/bump`);
  await page.goto(`/i/${item.id}`);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByRole('button', { name: 'Update them now' }).click();
  await expect(page.getByRole('status')).toHaveText('Updated Price.');
  await page.getByRole('button', { name: 'Close' }).first().click();
  await expect(page.getByText('€2.40')).toBeVisible();
});
