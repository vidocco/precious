import { expect, type Page, test } from '@playwright/test';
import { signInAsAdmin } from './helpers.ts';

/** What the shelf shows, in order: hanging labels as "# Label", dividers as "| Label", spines as their title. */
const shelfOrder = (page: Page) =>
  page
    .locator('section[aria-label="Shelf"]')
    .locator('h2, h3, h4, [role="separator"], a')
    .evaluateAll((els) =>
      els.map((e) =>
        /^H\d$/.test(e.tagName)
          ? `# ${e.textContent}`
          : e.getAttribute('role') === 'separator'
            ? `| ${e.getAttribute('aria-label')}`
            : e.getAttribute('aria-label'),
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
  // Genres hang a 6 × 2.5 cm green label from their board.
  await page.getByLabel('Level 1 marker width').fill('6');
  await page.getByLabel('Level 1 marker height').fill('2.5');
  await page.getByLabel('Level 1 marker colour').fill('#2e5e4e');
  await page.getByRole('button', { name: 'Add a level' }).click();
  await page.getByRole('combobox', { name: 'Level 2', exact: true }).selectOption({ label: 'Author' });
  await page.getByRole('checkbox', { name: 'Section marker' }).nth(1).check();
  await page.getByRole('button', { name: 'Add a level' }).click();
  await page.getByRole('combobox', { name: 'Level 3', exact: true }).selectOption({ label: 'Series number' });
  await expect(page.getByText('Genre (marked, new board) → Author (marked) → Series number').first()).toBeVisible();
  // The preview shows the labels and dividers.
  await expect(page.locator('aside').getByRole('heading').first()).toBeVisible();
  await expect(page.locator('aside').getByRole('separator').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  // The shelf opens in shelf order: each genre on its own board with its label hanging from it,
  // and a divider where each author starts.
  await page.goto(`/c/${c.id}?view=shelf`);
  const fantasyLabel = page.getByRole('heading', { name: 'Fantasy' });
  await expect(fantasyLabel).toBeVisible();
  expect(await shelfOrder(page)).toEqual([
    '# Fantasy',
    '| Borges',
    'Ficciones',
    '| Le Guin',
    'A Wizard of Earthsea',
    'The Tombs of Atuan',
    '# Science fiction',
    '| Butler',
    'Kindred',
    '| Herbert',
    'Dune',
  ]);
  await expect(page.getByRole('separator', { name: 'Fantasy' })).toHaveCount(0);
  // The label hangs below the board, at its left end, in the size and colour set (8 px a cm).
  const label = await fantasyLabel.boundingBox();
  const firstDivider = await page.getByRole('separator', { name: 'Borges' }).boundingBox();
  expect(label?.y ?? 0).toBeGreaterThan((firstDivider?.y ?? 0) + (firstDivider?.height ?? 0));
  expect(Math.abs((label?.x ?? 0) - (firstDivider?.x ?? 0))).toBeLessThan(2);
  expect(Math.round(label?.width ?? 0)).toBe(48);
  expect(Math.round(label?.height ?? 0)).toBe(20);
  await expect(fantasyLabel).toHaveCSS('background-color', 'rgb(46, 94, 78)');
  // Each genre on its own board.
  const scifi = await page.getByRole('heading', { name: 'Science fiction' }).boundingBox();
  expect(scifi?.y ?? 0).toBeGreaterThan((label?.y ?? 0) + (label?.height ?? 0));

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
