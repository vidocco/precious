import { expect, type Page, test } from '@playwright/test';

const MOCK = 'http://127.0.0.1:3401';

const recipe = {
  format: 'precious-recipe',
  version: 1,
  source: {
    name: 'Mock shop',
    description: 'A local stand-in API',
    baseUrl: MOCK,
    auth: { type: 'apiKey', in: 'header', name: 'X-Api-Key', secret: 'apiKey' },
    rateLimit: { requests: 50, perSeconds: 1 },
    cacheSeconds: 0,
  },
  secretNames: ['apiKey'],
  endpoints: [
    {
      key: 'search',
      name: 'Search games',
      role: 'search',
      kind: 'rest',
      path: '/api/search',
      query: [{ name: 'q', value: '{{ query }}' }],
      map: { results: 'data.items', id: 'id', title: 'name', year: 'released' },
      sample: { query: 'lanterns' },
    },
    {
      key: 'release',
      name: 'Release page',
      role: 'lookup',
      kind: 'html',
      path: '/release/{{ refs.shop }}',
      extract: { title: { css: 'h1.release-title' } },
      map: { title: 'title' },
      sample: { refs: { shop: '88141' } },
    },
  ],
};

async function signInAsAdmin(page: Page) {
  await page.goto('/');
  // A new browser context is never signed in: the app redirects to setup or sign-in.
  await page.waitForURL(/\/(setup|login)/);
  if (page.url().endsWith('/setup')) {
    await page.getByLabel('Your name').fill('Marta Vidal');
    await page.getByLabel('Email').fill('marta@example.com');
    await page.getByLabel('Password').fill('correct-horse-battery');
    await page.getByRole('button', { name: 'Create admin account' }).click();
  } else if (page.url().includes('/login')) {
    await page.getByLabel('Email').fill('marta@example.com');
    await page.getByLabel('Password').fill('correct-horse-battery');
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page).toHaveURL(/\/$/);
}

test('an admin imports a source, sets its secret and builds endpoints in the console', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/data/sources');
  await page.getByRole('button', { name: /Preset or recipe/ }).click();
  await page.getByLabel('Paste a recipe').fill(JSON.stringify(recipe));
  await page.getByRole('button', { name: 'Import pasted recipe' }).click();

  // The recipe needs a secret it didn't include.
  await expect(page.getByRole('heading', { name: 'Mock shop' })).toBeVisible();
  await expect(page.getByText(/Set this secret before using the source/)).toBeVisible();

  // Running without it fails at the sign-in step.
  await page.getByRole('link', { name: /Search games/ }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('The secret "apiKey" isn\'t set')).toBeVisible();

  // Set it; it's never shown again.
  await page.getByRole('link', { name: 'Mock shop' }).click();
  await page.getByRole('button', { name: 'Set', exact: true }).click();
  await page.getByLabel('Value for apiKey').fill('e2e-key');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('••••••••')).toBeVisible();
  await expect(page.getByText('e2e-key')).toHaveCount(0);

  // The search runs, and clicking a key in the response fills the focused mapping row.
  await page.getByRole('link', { name: /Search games/ }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText(/2 results · valid/)).toBeVisible();
  await expect(page.getByText('Lanterns of Vell (lanterns)', { exact: true })).toBeVisible();
  await page.locator('#map-subtitle').click();
  await page.locator('button[title="Use data.items.studio.name"]').first().click();
  await expect(page.locator('#map-subtitle')).toHaveValue('studio.name');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText(/Hollowpine Studio · 2019/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  // The HTML endpoint shows the page; clicking an element adds a value to pick out.
  await page.getByRole('link', { name: 'Mock shop' }).click();
  await page.getByRole('link', { name: /Release page/ }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText(/· valid/)).toBeVisible();
  const preview = page.frameLocator('iframe[title="Page preview"]');
  await expect(preview.locator('h1.release-title')).toBeVisible();
  await page.getByRole('button', { name: 'Add a value' }).click();
  await preview.locator('.meta .year').click();
  await expect(page.getByLabel('Selector').last()).toHaveValue(/year/);
  await expect(page.getByText(/1 match$/)).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByRole('radio', { name: 'Extracted JSON' }).click();
  await expect(page.getByText('"Released 1998"')).toBeVisible();
});
