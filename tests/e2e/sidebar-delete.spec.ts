import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForLocalWrite,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/**
 * Waits until this device holds no unsent change.
 *
 * A queued tombstone leaves the trash row as `waiting to go up` only until
 * the server accepts it. The sidebar reports the in-step state after the
 * queue drained, which proves the server accepted every deletion.
 */
async function waitForSynced(page: Page): Promise<void> {
  await expect(
    page.getByText('Everything is saved to the server.'),
  ).toBeAttached();
}

/**
 * Opens the navigation drawer on a narrow viewport.
 *
 * A wide viewport shows no drawer, so this does nothing there. It uses the
 * same shape as `createNewNote`: it waits briefly for the drawer toggle and
 * continues when the toggle never appears. Never call it while a dialog is
 * open, because the dialog covers the toggle.
 */
async function openNavigation(page: Page): Promise<void> {
  const drawer = page.getByRole('button', { name: 'Open navigation' });
  try {
    await drawer.waitFor({ state: 'visible', timeout: 2_000 });
    await drawer.click();
  } catch {
    // No drawer on this viewport. The sidebar is already placed.
  }
}

test('Delete from a note row moves the note to Trash', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const name = `row-delete-${Date.now().toString()}`;
  await expect(page.getByLabel('Note name')).toHaveValue('New note');
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# Row delete');
  await waitForLocalWrite(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await waitForServerSave(page);

  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  await openNavigation(page);
  await tree
    .getByRole('button', { name: `Actions for the note ${name}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete note' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete note' })
    .click();

  await expect(page.getByText(`${name} moved to Trash.`)).toBeVisible();
  await expect(tree.getByRole('link', { name })).toHaveCount(0);

  await waitForSynced(page);
  await page.reload();
  await waitForSynced(page);
  await expect(tree.getByRole('link', { name })).toHaveCount(0);

  await openNavigation(page);
  await page.getByRole('link', { name: 'Trash' }).click();
  const trashRow = page.locator('li').filter({ hasText: name });
  await expect(trashRow).toHaveCount(1);
  await expect(trashRow).not.toContainText('waiting to go up');
});

test('Delete folder moves every note in it to Trash', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const folder = `folder-delete-${Date.now().toString()}`;

  await createNewNote(page);
  await expect(page.getByLabel('Note name')).toHaveValue('New note');
  await page.getByLabel('Note name').fill(`${folder}/Note one`);
  await replaceEditorText(page, '# One');
  await waitForLocalWrite(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await waitForServerSave(page);

  await createNewNote(page);
  await expect(page.getByLabel('Note name')).toHaveValue('New note');
  await page.getByLabel('Note name').fill(`${folder}/Note two`);
  await replaceEditorText(page, '# Two');
  await waitForLocalWrite(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await waitForServerSave(page);

  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  const folderToggle = page.getByRole('button', {
    name: folder,
    exact: true,
  });
  await openNavigation(page);
  await folderToggle.click();
  await expect(folderToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('link', { name: 'Note one' })).toBeVisible();
  await expect(tree.getByRole('link', { name: 'Note two' })).toBeVisible();
  await page
    .getByRole('button', { name: `Actions for the folder ${folder}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete folder' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete folder' })
    .click();

  await expect(page.getByText('2 notes moved to Trash.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openNavigation(page);
  await expect(tree.getByRole('link', { name: 'Note one' })).toBeVisible();
  await expect(tree.getByRole('link', { name: 'Note two' })).toBeVisible();

  if (!(await page.getByRole('link', { name: 'Trash' }).isVisible()))
    await openNavigation(page);
  await page.getByRole('link', { name: 'Trash' }).click();
  const main = page.locator('main');
  await expect(main.locator('li').filter({ hasText: 'Note one' })).toHaveCount(
    0,
  );
  await expect(main.locator('li').filter({ hasText: 'Note two' })).toHaveCount(
    0,
  );

  await page.getByRole('link', { name: 'Back to your notes' }).click();
  await openNavigation(page);
  const expanded = await folderToggle.getAttribute('aria-expanded');
  if (expanded !== 'true') await folderToggle.click();
  await expect(folderToggle).toHaveAttribute('aria-expanded', 'true');
  await page
    .getByRole('button', { name: `Actions for the folder ${folder}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete folder' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete folder' })
    .click();

  await expect(page.getByText('2 notes moved to Trash.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: folder, exact: true }),
  ).toHaveCount(0);
  await expect(tree.getByRole('link', { name: 'Note one' })).toHaveCount(0);
  await expect(tree.getByRole('link', { name: 'Note two' })).toHaveCount(0);

  await waitForSynced(page);
  await page.reload();
  await waitForSynced(page);
  await expect(
    page.getByRole('button', { name: folder, exact: true }),
  ).toHaveCount(0);
  await expect(tree.getByRole('link', { name: 'Note one' })).toHaveCount(0);
  await expect(tree.getByRole('link', { name: 'Note two' })).toHaveCount(0);

  await openNavigation(page);
  await page.getByRole('link', { name: 'Trash' }).click();
  const trashOne = page.locator('li').filter({ hasText: 'Note one' });
  const trashTwo = page.locator('li').filter({ hasText: 'Note two' });
  await expect(trashOne).toHaveCount(1);
  await expect(trashOne).not.toContainText('waiting to go up');
  await expect(trashTwo).toHaveCount(1);
  await expect(trashTwo).not.toContainText('waiting to go up');
});
