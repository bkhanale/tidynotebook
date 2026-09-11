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
    const expanded = await drawer.getAttribute('aria-expanded');
    if (expanded !== 'true') await drawer.click();
  } catch {
    // No drawer on this viewport. The sidebar is already placed.
  }
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
  await expect(page.getByLabel('Note name')).toHaveValue('New note');
  await page.getByLabel('Note name').fill(noteName);
  await replaceEditorText(page, body);
  await waitForLocalWrite(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
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

  await createFolder(page, folder);
  await createNoteInFolder(page, folder, 'Note one', '# One');
  await createNoteInFolder(page, folder, 'Note two', '# Two');

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
  const folderToggle = page.getByRole('button', {
    name: folder,
    exact: true,
  });
  await openNavigation(page);
  await folderToggle.click();
  await expect(folderToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('link', { name })).toBeVisible();

  await tree
    .getByRole('button', { name: `Actions for the note ${name}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete note' }).click();

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
  const reloadedToggle = page.getByRole('button', {
    name: folder,
    exact: true,
  });
  await expect(reloadedToggle).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Actions for the folder ${folder}` }),
  ).toBeVisible();
  await expect(tree.getByRole('link', { name })).toHaveCount(0);
});

test('A note deleted for good leaves the sidebar and the trash', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const name = `purge-note-${Date.now().toString()}`;
  await expect(page.getByLabel('Note name')).toHaveValue('New note');
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# Purge me');
  await waitForLocalWrite(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await waitForServerSave(page);

  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  await openNavigation(page);
  await tree
    .getByRole('button', { name: `Actions for the note ${name}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete note' }).click();
  await expect(page.getByText(`${name} moved to Trash.`)).toBeVisible();

  await openNavigation(page);
  await page.getByRole('link', { name: 'Trash' }).click();
  const purgeRow = page.locator('li').filter({ hasText: name });
  await expect(purgeRow).toHaveCount(1);
  await purgeRow.getByRole('button', { name: 'Delete permanently' }).click();
  await purgeRow.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByText(`${name} is deleted for good.`)).toBeVisible();
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
  await waitForLocalWrite(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await waitForServerSave(page);

  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  const folderToggle = page.getByRole('button', {
    name: folder,
    exact: true,
  });
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
  const reloadedToggle = page.getByRole('button', {
    name: folder,
    exact: true,
  });
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
  const folderToggle = page.getByRole('button', {
    name: folder,
    exact: true,
  });
  const expanded = await folderToggle.getAttribute('aria-expanded');
  if (expanded !== 'true') await folderToggle.click();
  await expect(tree.getByRole('link', { name })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Other', exact: true }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel('Note name')).toHaveValue(name);
  await openNavigation(page);
  const reloadedToggle = page.getByRole('button', {
    name: folder,
    exact: true,
  });
  const reloadedExpanded = await reloadedToggle.getAttribute('aria-expanded');
  if (reloadedExpanded !== 'true') await reloadedToggle.click();
  await expect(tree.getByRole('link', { name })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Other', exact: true }),
  ).toHaveCount(0);
});
