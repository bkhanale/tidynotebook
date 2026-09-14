import type { Locator, Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  folderDisclosure,
  openNavigation,
  openPersonalWorkspace,
  replaceEditorText,
  runNoteAction,
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

test('Delete the last open note keeps the folder', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const folder = `keep-open-folder-${Date.now().toString()}`;
  const name = 'Only open note';

  await createFolder(page, folder);
  await createNoteInFolder(page, folder, name, '# Keep the folder');

  await runNoteAction(page, 'Delete this note');
  await expect(page.getByText(`${name} moved to Trash.`)).toBeVisible();

  await openNavigation(page);
  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  await expect(folderDisclosure(page, folder)).toBeVisible();
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

test('A note deleted permanently in another session leaves the sidebar', async ({
  checkedPage: page,
  browser,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const name = `purge-other-tab-${Date.now().toString()}`;
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# Purge in another tab');
  await waitForServerSave(page);

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, stack);
  await other.goto(page.url());
  await expect(other.getByLabel('Note name')).toHaveValue(name);
  // The second device deletes a note it holds. A device that has not received
  // the note yet cannot state its deletion, and the application says so, so
  // this journey waits for the first sync instead of racing it.
  await waitForSynced(other);

  await runNoteAction(other, 'Delete this note');
  await runNoteAction(other, 'Go to Trash');
  const purgeRow = other.locator('main li').filter({ hasText: name });
  await purgeRow.getByRole('button', { name: 'Delete permanently' }).click();
  await purgeRow.getByRole('button', { name: 'Confirm' }).click();
  await expect(
    other.getByText(`${name} is deleted permanently.`),
  ).toBeVisible();
  await expect(purgeRow).toHaveCount(0);
  await otherContext.close();

  await page.bringToFront();
  await expect(
    page.getByRole('heading', { name: 'Note deleted permanently' }),
  ).toBeVisible({ timeout: 25_000 });
  await openNavigation(page);
  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  await expect(tree.getByRole('link', { name })).toHaveCount(0);
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

/** Makes a folder inside the folder that is selected right now. */
async function createChildFolder(page: Page, child: string): Promise<void> {
  await openNavigation(page);
  await page
    .getByRole('button', { name: 'New folder', exact: true })
    .first()
    .click();
  await page.getByLabel('Folder name').fill(child);
  await page.getByRole('button', { name: 'Make folder' }).click();
  await expect(
    page.getByRole('button', { name: child, exact: true }),
  ).toBeVisible();
}

test('Delete a child folder keeps the folder above it', async ({
  checkedPage: page,
  browser,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const suffix = Date.now().toString();
  const parent = `parent-${suffix}`;
  const child = `child-${suffix}`;

  await createFolder(page, parent);
  await page.getByRole('button', { name: parent, exact: true }).click();
  await createChildFolder(page, child);
  await createNoteInFolder(page, child, 'Child note', '# Child');
  await waitForSynced(page);

  // A second device knows the folders through the note paths only, which is
  // the state in which one delete used to take the whole branch. The context
  // is new, so it starts with no folder of its own.
  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await signIn(other, stack);
    await openPersonalWorkspace(other);
    await openNavigation(other);
    const otherTree = other.locator('section[aria-labelledby="tree-heading"]');
    await expandFolder(folderDisclosure(other, parent));
    await expandFolder(folderDisclosure(other, child));
    // The second device holds the note before the delete runs, so the delete
    // moves a note and never an empty folder.
    await expect(
      otherTree.getByRole('link', { name: 'Child note' }),
    ).toBeVisible();

    // The second device can still be pulling the note down. The application
    // says so and asks for the action again, so the journey repeats the same
    // action until it runs, and it waits for that state instead of a delay.
    await expect(async () => {
      await other
        .getByRole('button', { name: `Actions for the folder ${child}` })
        .click();
      await other.getByRole('menuitem', { name: 'Delete folder' }).click();
      await expect(other.getByText('Child note moved to Trash.')).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(
      other.getByRole('button', { name: child, exact: true }),
    ).toHaveCount(0);
    // Only the folder the person named goes. The folder above it stays.
    await expect(
      other.getByRole('button', { name: parent, exact: true }),
    ).toBeVisible();
    await expect(
      otherTree.getByRole('link', { name: 'Child note' }),
    ).toHaveCount(0);
  } finally {
    await second.close();
  }
});

test('Delete the open note from its row keeps it in Trash', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const name = `open-row-delete-${Date.now().toString()}`;
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# Before the delete');
  await waitForServerSave(page);

  // The sidebar deletes the note that the editor has open. The store marks
  // every working copy deleted, so the open editor cannot save it back.
  const tree = page.locator('section[aria-labelledby="tree-heading"]');
  await openNavigation(page);
  await tree
    .getByRole('button', { name: `Actions for the note ${name}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText(`${name} moved to Trash.`)).toBeVisible();
  await expect(tree.getByRole('link', { name })).toHaveCount(0);

  await waitForSynced(page);
  await page.reload();
  await waitForSynced(page);
  await expect(tree.getByRole('link', { name })).toHaveCount(0);
  await openNavigation(page);
  await page.getByRole('link', { name: 'Trash' }).click();
  await expect(
    page.locator('main').locator('li').filter({ hasText: name }),
  ).toHaveCount(1);
});
