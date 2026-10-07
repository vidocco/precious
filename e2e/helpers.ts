import { expect, type Page } from '@playwright/test';

/** Signs in as the admin, running first-time setup if no one has yet. */
export async function signInAsAdmin(page: Page) {
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
