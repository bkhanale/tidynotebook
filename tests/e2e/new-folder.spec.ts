import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import { signIn } from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/**
 * Opens the navigation drawer on a narrow viewport.
 *
 * A wide viewport shows no drawer, so this does nothing there. Never call it
 * while a dialog is open, because the dialog covers the drawer toggle.
 */
async function openNavigation(page: Page): Promise<void> {
  const drawer = page.getByRole('button', { name: 'Open navigation' });
  try {
    await drawer.waitFor({ state: 'visible', timeout: 2_000 });
    const expanded = await drawer.getAttribute('aria-expanded');
    if (expanded !== 'true') await drawer.click();
  } catch {
    // No drawer on this viewport. The sidebar is already placed.
  }
}

test('Enter in the folder name field makes the folder', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openNavigation(page);
  await page
    .getByRole('button', { name: 'New folder', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Folder name').fill('Enter folder');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Enter folder', exact: true }),
  ).toBeVisible();
});

test('Escape in the folder name field closes the dialog', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openNavigation(page);
  await page
    .getByRole('button', { name: 'New folder', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Folder name').fill('Escape folder');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Escape folder', exact: true }),
  ).toBeHidden();
});
