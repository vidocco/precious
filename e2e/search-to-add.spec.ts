import { expect, test } from '@playwright/test';
import { signInAsAdmin } from './helpers.ts';

const MOCK = 'http://127.0.0.1:3401';

const source = (name: string, endpoints: unknown[]) => ({
  format: 'precious-recipe',
  version: 1,
  source: { name, baseUrl: MOCK, rateLimit: { requests: 50, perSeconds: 1 }, cacheSeconds: 0 },
  endpoints,
});

const games = source('Games DB', [
  {
    key: 'search',
    name: 'Search',
    role: 'search',
    path: '/games/search',
    query: [{ name: 'q', value: '{{ query }}' }],
    map: { results: '$', id: 'id', title: 'name', year: 'year', image: 'cover' },
  },
  {
    key: 'game',
    name: 'Game',
    role: 'lookup',
    path: '/games/{{ refs.games }}',
    map: { developer: 'developer', genres: 'genres' },
  },
]);

const times = source('Times DB', [
  {
    key: 'search',
    name: 'Search',
    role: 'search',
    path: '/times/search',
    query: [{ name: 'q', value: '{{ query }}' }],
    map: { results: '$', id: 'id', title: 'title', year: 'year' },
  },
  { key: 'times', name: 'Times', role: 'lookup', path: '/times/{{ refs.times }}', map: { main: 'main' } },
]);

test('a template searches data sources, and items are added, checked and refreshed from them', async ({ page }) => {
  await signInAsAdmin(page);
  const api = page.request;
  const origin = { origin: new URL(page.url()).origin };
  for (const recipe of [games, times]) {
    expect((await api.post('/api/sources/import', { data: recipe, headers: origin })).status()).toBe(201);
  }
  const template = await (
    await api.post('/api/templates', {
      headers: origin,
      data: {
        name: 'Games',
        accessionPrefix: 'GM',
        fields: [
          { id: 'developer', label: 'Developer', type: 'text' },
          { id: 'genres', label: 'Genres', type: 'tags' },
          { id: 'release_year', label: 'Release year', type: 'number' },
          { id: 'playtime', label: 'Playtime', type: 'duration' },
        ],
        itemLayout: { info: ['developer', 'genres', 'release_year', 'playtime'], sections: [] },
      },
    })
  ).json();

  // Bind the sources in the template editor.
  await page.goto(`/data/templates/${template.id}`);
  await page.getByRole('tab', { name: 'Data sources' }).click();
  await page.getByRole('button', { name: 'Add a search' }).click();
  // Values are matched to fields by name.
  await expect(page.getByLabel('Field filled by year')).toHaveValue('release_year');
  await expect(page.getByLabel('Field filled by image')).toHaveValue('$cover');
  await page.getByRole('button', { name: 'Add a lookup' }).click();
  await page.getByRole('button', { name: 'Add a lookup' }).click();
  // A lookup from another source searches that source for its match.
  await expect(page.getByLabel('Lookup endpoint').nth(1)).toHaveValue(/.+/);
  await expect(page.getByRole('combobox', { name: 'Match search endpoint' })).toBeVisible();
  await page.getByLabel('Field filled by main').selectOption({ label: 'Playtime' });

  await page.getByLabel('Try a search').fill('lanterns');
  await page.getByRole('button', { name: 'Run' }).click();
  const tryPanel = page.locator('aside');
  await expect(tryPanel.getByText('Hollowpine Studio')).toBeVisible();
  await expect(tryPanel.getByText(/found 2 possible matches/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  // Add an item: search, pick, check the details.
  const collection = await (
    await api.post('/api/collections', { headers: origin, data: { templateId: template.id, name: 'Games' } })
  ).json();
  await page.goto(`/c/${collection.id}`);
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByRole('searchbox', { name: 'Search Games DB' }).fill('lanterns');
  await expect(page.getByText('2 results from Games DB')).toBeVisible();
  await page.getByRole('button', { name: /Lanterns of Vell 2019/ }).click();

  await expect(page).toHaveURL(/\/new\?draft=/);
  await expect(page.getByLabel('Title')).toHaveValue('Lanterns of Vell');
  await expect(page.getByLabel('Developer')).toHaveValue('Hollowpine Studio');
  await expect(page.getByTitle('Filled in from Games DB').first()).toBeVisible();
  // The playtime source found two close matches: pick one.
  await expect(page.getByText(/Times DB found 2 possible matches for “Lanterns of Vell”/)).toBeVisible();
  await page.getByRole('radio', { name: /Lanterns of Vell Deluxe/ }).check();
  await expect(page.getByLabel('Hours')).toHaveValue('23');
  await page.getByRole('button', { name: 'Add to Games' }).click();

  await expect(page).toHaveURL(/\/i\//);
  await expect(page.getByRole('heading', { name: 'Lanterns of Vell' })).toBeVisible();
  await expect(page.getByText('Times DB')).toBeVisible();

  // Edit the developer by hand: it gets locked.
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Developer').fill('Hollowpine (indie)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: /Unlock this value/ })).toBeVisible();

  // The source changes; refresh keeps the hand-edited value and offers the rest.
  await api.get(`${MOCK}/games/bump`);
  await page.getByRole('button', { name: 'Refresh' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Kept: edited by hand')).toBeVisible();
  await expect(sheet.getByText(/Developer stays Hollowpine \(indie\)/)).toBeVisible();
  await expect(sheet.getByText('Adventure, Cozy')).toBeVisible();
  await sheet.getByRole('button', { name: 'Apply 1 change' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText('Adventure, Cozy')).toBeVisible();
  await expect(page.getByText('Hollowpine (indie)')).toBeVisible();
});
