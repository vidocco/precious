import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const COVER = join(import.meta.dirname, 'fixtures', 'cover.png');

test.describe.configure({ mode: 'serial' });

test('a household sets up, collects, searches and shares', async ({ page, browser }) => {
  // First run: create the admin.
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Your name').fill('Marta Vidal');
  await page.getByLabel('Email').fill('marta@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page.getByText('Start your first collection')).toBeVisible();

  // A collection from the Video games template, kept private.
  await page.getByRole('link', { name: 'Create a collection' }).click();
  await page.getByLabel('Name').fill('Video games');
  await page.getByRole('radio', { name: 'Only me' }).first().click();
  await page.getByRole('button', { name: 'Create collection' }).click();
  // The form's preview also says "No items yet", so wait for the collection's own page.
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]+/);
  await expect(page.getByText('No items yet')).toBeVisible();
  const collectionUrl = page.url();

  // Add two items by hand, one with a cover.
  for (const [title, platform, value, cover] of [
    ['Lanterns of Vell', 'Switch', '64.5', true],
    ['Moth Protocol', 'PC', '12.9', false],
  ] as const) {
    await page.goto(collectionUrl);
    await page.getByRole('link', { name: 'Add item' }).click();
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Platform').selectOption(platform);
    await page.getByLabel('Value').fill(value);
    if (cover) {
      await page.locator('input[type=file]').setInputFiles(COVER);
      await expect(page.getByRole('button', { name: 'Replace', exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Add to Video games' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }

  // The wall shows both, with the template's labels and the header total.
  await page.goto(collectionUrl);
  await expect(page.getByText('VG·0001')).toBeVisible();
  await expect(page.getByText('€77.40')).toBeVisible();

  // Search inside the collection.
  await page.getByLabel('Search in Video games').fill('lantern');
  await expect(page.getByText('1 of 2')).toBeVisible();
  await expect(page.locator('mark', { hasText: 'Lantern' })).toBeVisible();

  // Search everywhere, then open the hit with the keyboard.
  await page.getByLabel('Search all collections').fill('moth');
  await expect(page.getByRole('option', { name: /Moth Protocol/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Moth Protocol' })).toBeVisible();

  // Edit a field, then delete the item with the in-page confirmation.
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Condition').selectOption('Good');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Good', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete item' }).click();
  await expect(page).toHaveURL(/\/c\//);
  await expect(page.getByText('Moth Protocol')).toHaveCount(0);

  // Add a household member; they can't see the private collection.
  await page.goto('/server');
  await page.getByLabel('Name').fill('Juan Pérez');
  await page.getByLabel('Email').fill('juan@example.com');
  await page.getByLabel('Password').fill('another-long-password');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByText('can now sign in')).toBeVisible();

  const juan = await (await browser.newContext()).newPage();
  await juan.goto('/login');
  await juan.getByLabel('Email').fill('juan@example.com');
  await juan.getByLabel('Password').fill('another-long-password');
  await juan.getByRole('button', { name: 'Sign in' }).click();
  await expect(juan.getByText('Start your first collection')).toBeVisible();
  await juan.goto(collectionUrl);
  await expect(juan.getByText('Collection not found.')).toBeVisible();

  // Share it with a public link; anyone can read it without signing in.
  await page.goto(`${collectionUrl.replace(/\?.*$/, '')}/edit`);
  await page.getByRole('radio', { name: 'Anyone with the link' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Anyone with the link')).toBeVisible();
  const slug = await page.evaluate(async (id) => {
    const res = await fetch(`/api/collections/${id}`);
    return (await res.json()).publicSlug as string;
  }, collectionUrl.split('/c/')[1]?.split('?')[0]);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/p/${slug}`);
  await expect(visitor.getByRole('heading', { name: /Video games/ })).toBeVisible();
  await visitor.getByText('Lanterns of Vell').click();
  await expect(visitor.getByRole('heading', { name: 'Lanterns of Vell' })).toBeVisible();
});

test('the template editor changes what cards show', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('marta@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/data/templates');
  await page.getByRole('link', { name: 'Video games' }).click();
  await page.getByRole('tab', { name: 'Card' }).click();
  await page.getByLabel('Cover b').selectOption('$title');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.goto('/collections');
  await page.getByRole('link', { name: /Video games/ }).click();
  // The title now also sits on the bottom band of the cover.
  await expect(page.getByText('Lanterns of Vell')).toHaveCount(2);
});
