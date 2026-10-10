import { expect, test } from '@playwright/test';
import { signInAsAdmin } from './helpers.ts';

test('the table unlocks to edit several items in place, and saves them all at once', async ({ page }) => {
  await signInAsAdmin(page);
  const api = page.request;
  const origin = { origin: new URL(page.url()).origin };
  const templates = await (await api.get('/api/templates')).json();
  const books = templates.find((t: { name: string }) => t.name === 'Books');
  const c = await (
    await api.post('/api/collections', { headers: origin, data: { templateId: books.id, name: 'Table books' } })
  ).json();
  const ids: Record<string, string> = {};
  for (const [title, author] of [
    ['Rayuela', 'Julio Cortázar'],
    ['Ficciones', 'Jorge Luis Borges'],
  ] as const) {
    const item = await (
      await api.post(`/api/collections/${c.id}/items`, { headers: origin, data: { title, data: { author } } })
    ).json();
    ids[title] = item.id;
  }

  await page.goto(`/c/${c.id}?view=table`);
  await expect(page.getByRole('cell', { name: 'Julio Cortázar' })).toBeVisible();
  // Locked: cells are text, and there is nothing to save.
  await expect(page.getByLabel('Author of Rayuela', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Unlock the table to edit it' }).click();
  await expect(page.getByRole('button', { name: 'Lock the table' })).toBeVisible();
  // Every field can be changed, not only the columns shown when locked.
  await expect(page.getByRole('columnheader', { name: /Synopsis/ })).toBeVisible();
  await page.getByLabel('Pages of Rayuela', { exact: true }).fill('736');
  await page.getByLabel('Synopsis of Rayuela', { exact: true }).fill('A hopscotch novel.');
  await page.getByLabel('Author of Rayuela', { exact: true }).fill('J. Cortázar');
  await page.getByLabel('Title of Ficciones', { exact: true }).fill('Ficciones (1944)');
  await page.getByLabel('Language of Rayuela', { exact: true }).selectOption('ES');
  // The author is required: an emptied one stops the save, and nothing is saved.
  await page.getByLabel('Author of Ficciones', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save changes to 2 items' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Required' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock the table' })).toBeVisible();
  expect((await (await api.get(`/api/items/${ids.Rayuela}`)).json()).data.author).toBe('Julio Cortázar');

  await page.getByLabel('Author of Ficciones', { exact: true }).fill('Borges');
  await page.getByRole('button', { name: 'Save changes to 2 items' }).click();
  // Saved and locked again.
  await expect(page.getByRole('button', { name: 'Unlock the table to edit it' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'J. Cortázar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ficciones (1944)' })).toBeVisible();
  const rayuela = await (await api.get(`/api/items/${ids.Rayuela}`)).json();
  expect(rayuela.data).toMatchObject({
    author: 'J. Cortázar',
    language: 'ES',
    pages: 736,
    synopsis: 'A hopscotch novel.',
  });
  // Locked again: back to the columns picked.
  await expect(page.getByRole('columnheader', { name: /Synopsis/ })).toHaveCount(0);
  const ficciones = await (await api.get(`/api/items/${ids.Ficciones}`)).json();
  expect([ficciones.title, ficciones.data.author]).toEqual(['Ficciones (1944)', 'Borges']);

  // Locking without saving asks first, then throws the changes away.
  await page.getByRole('button', { name: 'Unlock the table to edit it' }).click();
  await page.getByLabel('Author of Rayuela', { exact: true }).fill('Someone else');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Lock the table' }).click();
  await expect(page.getByRole('cell', { name: 'J. Cortázar' })).toBeVisible();
  expect((await (await api.get(`/api/items/${ids.Rayuela}`)).json()).data.author).toBe('J. Cortázar');
});
