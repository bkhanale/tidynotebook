import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  closeNavigation,
  createNewNote,
  folderDisclosure,
  replaceEditorText,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/**
 * Opens the navigation drawer on a narrow viewport.
 *
 * A wide viewport shows no drawer, so this does nothing there.
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

/** Makes a folder through the real dialog. */
async function createFolder(page: Page, folder: string): Promise<void> {
  await openNavigation(page);
  await page
    .getByRole('button', { name: 'New folder', exact: true })
    .first()
    .click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Make folder' }).click();
  await expect(
    page.getByRole('button', { name: folder, exact: true }),
  ).toBeVisible();
}

/** Makes one note inside a folder through the folder row menu. */
async function createNoteInFolder(
  page: Page,
  folder: string,
  noteName: string,
  body: string,
): Promise<void> {
  await openNavigation(page);
  await page
    .getByRole('button', { name: `Actions for the folder ${folder}` })
    .click();
  await page.getByRole('menuitem', { name: 'New note in this folder' }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+$/);
  const nameInput = page.getByLabel('Note name');
  await expect(nameInput).toBeFocused();
  await nameInput.fill(noteName);
  await replaceEditorText(page, body);
  await waitForServerSave(page);
}

test('opening a note expands its folder and scrolls its row into view', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await createFolder(page, 'Projects');
  await createNoteInFolder(page, 'Projects', 'Report', '# Report\n');

  // Move the open note away from Report, then collapse its folder by hand.
  await createNewNote(page);
  await openNavigation(page);
  const folderToggle = folderDisclosure(page, 'Projects');
  await expect(folderToggle).toHaveAttribute('aria-expanded', 'true');
  await folderToggle.click();
  await expect(folderToggle).toHaveAttribute('aria-expanded', 'false');
  const reportRow = page.getByRole('link', { name: 'Report', exact: true });
  await expect(reportRow).toBeHidden();

  // Open Report from the command palette. The folder must expand on its own
  // and the row must be shown and in view. Close the drawer first, because on
  // a narrow viewport it covers the header affordance.
  await closeNavigation(page);
  await page.getByRole('button', { name: /Search notes/ }).click();
  const palette = page.getByRole('dialog', {
    name: 'Search notes and run actions',
  });
  await expect(palette).toBeVisible();
  await palette.getByLabel('Search notes, or type an action').fill('Report');
  await palette
    .getByRole('option', { name: /Report/ })
    .first()
    .click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+$/);

  await openNavigation(page);
  await expect(folderToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(reportRow).toBeVisible();
  await expect(reportRow).toBeInViewport();
});
