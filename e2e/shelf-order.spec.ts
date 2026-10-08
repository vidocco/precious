import { expect, type Page, test } from '@playwright/test';
import { signInAsAdmin } from './helpers.ts';

/** What the shelf shows, in order: dividers as "| Label", spines as their title. */
const shelfOrder = (page: Page) =>
  page
    .locator('section[aria-label="Shelf"]')
    .locator('[role="separator"], a')
    .evaluateAll((els) =>
      els.map((e) =>
        e.getAttribute('role') === 'separator' ? `| ${e.getAttribute('aria-label')}` : e.getAttribute('aria-label'),
      ),
    );

test('the top bar sits below the status bar instead of covering the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsAdmin(page);
  const api = page.request;
  const origin = { origin: new URL(page.url()).origin };
  const templates = await (await api.get('/api/templates')).json();
  const blank = templates.find((t: { name: string }) => t.name === 'Blank');
  const c = await (
    await api.post('/api/collections', { headers: origin, data: { templateId: blank.id, name: 'Phone' } })
  ).json();
  const item = await (
    await api.post(`/api/collections/${c.id}/items`, { headers: origin, data: { title: 'Under the notch' } })
  ).json();

  await page.goto(`/i/${item.id}`);
  // An iPhone's status bar, as an installed app with a translucent status bar has it.
  await page.addStyleTag({ content: ':root { --safe-top: 47px; }' });
  const header = page.locator('header').first();
  await expect(header).toHaveCSS('padding-top', '47px');
  const bar = await header.boundingBox();
  const edit = await page.getByRole('button', { name: 'Edit' }).boundingBox();
  expect(bar?.y).toBe(0);
  expect(edit?.y ?? 0).toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0));
});

test('a template arranges the shelf like a library, and a collection can have its own order', async ({ page }) => {
  await signInAsAdmin(page);
  const api = page.request;
  const origin = { origin: new URL(page.url()).origin };
  const template = await (
    await api.post('/api/templates', {
      headers: origin,
      data: {
        name: 'Library',
        accessionPrefix: 'LB',
        fields: [
          { id: 'genre', label: 'Genre', type: 'tags' },
          { id: 'author', label: 'Author', type: 'text' },
          { id: 'series_no', label: 'Series number', type: 'number' },
        ],
      },
    })
  ).json();
  const c = await (
    await api.post('/api/collections', { headers: origin, data: { templateId: template.id, name: 'Library' } })
  ).json();
  for (const [title, data] of [
    ['The Tombs of Atuan', { genre: ['Fantasy'], author: 'Le Guin', series_no: 2 }],
    ['Kindred', { genre: ['Science fiction'], author: 'Butler' }],
    ['A Wizard of Earthsea', { genre: ['Fantasy'], author: 'Le Guin', series_no: 1 }],
    ['Dune', { genre: ['Science fiction'], author: 'Herbert' }],
    ['Ficciones', { genre: ['Fantasy'], author: 'Borges' }],
  ] as const) {
    await api.post(`/api/collections/${c.id}/items`, { headers: origin, data: { title, data } });
  }

  // Without a shelf order, nothing changes: newest first, no markers, no "Shelf order" option.
  await page.goto(`/c/${c.id}?view=shelf`);
  await expect(page.getByRole('link', { name: 'Ficciones' })).toBeVisible();
  expect((await shelfOrder(page))[0]).toBe('Ficciones');
  await expect(page.getByRole('separator')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Sort by' }).locator('option[value="$arranged"]')).toHaveCount(0);

  // Genre (marked, each on a new board) → Author (marked) → Series number.
  await page.goto(`/data/templates/${template.id}`);
  await page.getByRole('tab', { name: 'Shelf' }).click();
  await page.getByRole('button', { name: 'Arrange the shelf' }).click();
  await page.getByRole('combobox', { name: 'Level 1', exact: true }).selectOption({ label: 'Genre' });
  await page.getByRole('checkbox', { name: 'Section marker' }).check();
  await page.getByRole('checkbox', { name: 'Each on a new board' }).check();
  await page.getByRole('button', { name: 'Add a level' }).click();
  await page.getByRole('combobox', { name: 'Level 2', exact: true }).selectOption({ label: 'Author' });
  await page.getByRole('checkbox', { name: 'Section marker' }).nth(1).check();
  await page.getByRole('button', { name: 'Add a level' }).click();
  await page.getByRole('combobox', { name: 'Level 3', exact: true }).selectOption({ label: 'Series number' });
  await expect(page.getByText('Genre (marked, new board) → Author (marked) → Series number').first()).toBeVisible();
  // The preview shows the dividers.
  await expect(page.locator('aside').getByRole('separator').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  // The shelf opens in shelf order, with a divider where each genre and author starts.
  await page.goto(`/c/${c.id}?view=shelf`);
  await expect(page.getByRole('separator', { name: 'Fantasy' })).toBeVisible();
  expect(await shelfOrder(page)).toEqual([
    '| Fantasy',
    '| Borges',
    'Ficciones',
    '| Le Guin',
    'A Wizard of Earthsea',
    'The Tombs of Atuan',
    '| Science fiction',
    '| Butler',
    'Kindred',
    '| Herbert',
    'Dune',
  ]);
  // Each genre on its own board.
  const fantasy = await page.getByRole('separator', { name: 'Fantasy' }).boundingBox();
  const scifi = await page.getByRole('separator', { name: 'Science fiction' }).boundingBox();
  expect(scifi?.y ?? 0).toBeGreaterThan((fantasy?.y ?? 0) + (fantasy?.height ?? 0));

  // The wall and table in shelf order show the same sections.
  await page.goto(`/c/${c.id}?view=wall&sort=$arranged`);
  await expect(page.getByRole('heading', { level: 2, name: 'Fantasy' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Le Guin' })).toBeVisible();
  await page.goto(`/c/${c.id}?view=table&sort=$arranged`);
  await expect(page.getByRole('row', { name: 'Science fiction', exact: true })).toBeVisible();

  // This collection keeps authors together, with markers for authors only.
  await page.goto(`/c/${c.id}/edit`);
  await page.getByRole('radio', { name: 'Its own' }).click();
  await page.getByRole('button', { name: 'Remove level' }).first().click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${c.id}$`));
  await page.goto(`/c/${c.id}?view=shelf`);
  await expect(page.getByRole('separator', { name: 'Borges' })).toBeVisible();
  expect(await shelfOrder(page)).toEqual([
    '| Borges',
    'Ficciones',
    '| Butler',
    'Kindred',
    '| Herbert',
    'Dune',
    '| Le Guin',
    'A Wizard of Earthsea',
    'The Tombs of Atuan',
  ]);
});
