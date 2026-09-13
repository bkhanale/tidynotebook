import type { Locator, Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  folderDisclosure,
  openNavigation,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
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
 * Makes a folder through the real dialog.
 *
 * The name field holds only a file name, so a test cannot place a note by
 * typing a slash. It makes the folder first, then makes each note inside it.
 */
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

/** Expands one folder row when it is not already open. */
async function expandFolder(toggle: Locator): Promise<void> {
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
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

test('Delete from a note row moves the note to Trash', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const name = `row-delete-${Date.now().toString()}`;
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# Row delete');
  await waitForServerSave(page);

  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  await openNavigation(page);
  await tree
    .getByRole('button', { name: `Actions for the note ${name}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();

  await expect(page.getByText(`${name} moved to Trash.`)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Restore', exact: true }),
  ).toBeVisible();
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

  await createFolder(page, folder);
  await createNoteInFolder(page, folder, 'Note one', '# One');
  await createNoteInFolder(page, folder, 'Note two', '# Two');

  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  const folderToggle = folderDisclosure(page, folder);
  await openNavigation(page);
  await expandFolder(folderToggle);
  await expect(tree.getByRole('link', { name: 'Note one' })).toBeVisible();
  await expect(tree.getByRole('link', { name: 'Note two' })).toBeVisible();
  await page
    .getByRole('button', { name: `Actions for the folder ${folder}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete folder' }).click();

  await expect(page.getByText('2 notes moved to Trash.')).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await openNavigation(page);
  // The restore recreates the folder, so open it again to see its notes.
  await expandFolder(folderToggle);
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

test('Delete the last note in a folder keeps the folder', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const folder = `keep-folder-${Date.now().toString()}`;
  const name = 'Solo note';

  await createFolder(page, folder);
  await createNoteInFolder(page, folder, name, '# Solo');

  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  const folderToggle = folderDisclosure(page, folder);
  await openNavigation(page);
  await expandFolder(folderToggle);
  await expect(tree.getByRole('link', { name })).toBeVisible();

  await tree
    .getByRole('button', { name: `Actions for the note ${name}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();

  await expect(page.getByText(`${name} moved to Trash.`)).toBeVisible();
  await expect(tree.getByRole('link', { name })).toHaveCount(0);
  await openNavigation(page);
  await expect(folderToggle).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Actions for the folder ${folder}` }),
  ).toBeVisible();

  await waitForSynced(page);
  await page.reload();
  await waitForSynced(page);
  await openNavigation(page);
  const reloadedToggle = folderDisclosure(page, folder);
  await expect(reloadedToggle).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Actions for the folder ${folder}` }),
  ).toBeVisible();
  await expect(tree.getByRole('link', { name })).toHaveCount(0);
});

test('A note deleted permanently leaves the sidebar and the trash', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const name = `purge-note-${Date.now().toString()}`;
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# Purge me');
  await waitForServerSave(page);

  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  await openNavigation(page);
  await tree
    .getByRole('button', { name: `Actions for the note ${name}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText(`${name} moved to Trash.`)).toBeVisible();

  await openNavigation(page);
  await page.getByRole('link', { name: 'Trash' }).click();
  const purgeRow = page.locator('li').filter({ hasText: name });
  await expect(purgeRow).toHaveCount(1);
  await purgeRow.getByRole('button', { name: 'Delete permanently' }).click();
  await purgeRow.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByText(`${name} is deleted permanently.`)).toBeVisible();
  const main = page.locator('main');
  await expect(main.locator('li').filter({ hasText: name })).toHaveCount(0);
  await expect(tree.getByRole('link', { name })).toHaveCount(0);

  await waitForSynced(page);
  await page.reload();
  await waitForSynced(page);
  await expect(tree.getByRole('link', { name })).toHaveCount(0);
  await openNavigation(page);
  await page.getByRole('link', { name: 'Trash' }).click();
  await expect(main.locator('li').filter({ hasText: name })).toHaveCount(0);
});

test('A rename keeps a note in its folder', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const folder = `rename-folder-${Date.now().toString()}`;
  const renamed = 'Renamed in folder';

  await createFolder(page, folder);
  await createNoteInFolder(page, folder, 'Original in folder', '# Stay');

  await page.getByLabel('Note name').fill(renamed);
  // A rename is a draft until a version is created, so make one on purpose.
  await page.keyboard.press('Control+S');
  await waitForServerSave(page);

  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  const folderToggle = folderDisclosure(page, folder);
  await openNavigation(page);
  const expanded = await folderToggle.getAttribute('aria-expanded');
  if (expanded !== 'true') await folderToggle.click();
  await expect(folderToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('link', { name: renamed })).toBeVisible();
  await expect(tree.getByText('This folder is empty.')).toHaveCount(0);

  await waitForSynced(page);
  await page.reload();
  await waitForSynced(page);
  await openNavigation(page);
  const reloadedToggle = folderDisclosure(page, folder);
  const reloadedExpanded = await reloadedToggle.getAttribute('aria-expanded');
  if (reloadedExpanded !== 'true') await reloadedToggle.click();
  await expect(reloadedToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('link', { name: renamed })).toBeVisible();
  await expect(tree.getByText('This folder is empty.')).toHaveCount(0);
});

test('A slash in the name is refused and the note stays put', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const folder = `slash-folder-${Date.now().toString()}`;
  const name = 'Slash stays';

  await createFolder(page, folder);
  await createNoteInFolder(page, folder, name, '# Hold');

  await page.getByLabel('Note name').fill(`Other/${name}`);
  await expect(
    page.getByText('A note name cannot contain a slash. Use Move to folder.'),
  ).toBeVisible();

  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  await openNavigation(page);
  const folderToggle = folderDisclosure(page, folder);
  const expanded = await folderToggle.getAttribute('aria-expanded');
  if (expanded !== 'true') await folderToggle.click();
  await expect(tree.getByRole('link', { name })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Other', exact: true }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel('Note name')).toHaveValue(name);
  await openNavigation(page);
  const reloadedToggle = folderDisclosure(page, folder);
  const reloadedExpanded = await reloadedToggle.getAttribute('aria-expanded');
  if (reloadedExpanded !== 'true') await reloadedToggle.click();
  await expect(tree.getByRole('link', { name })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Other', exact: true }),
  ).toHaveCount(0);
});
