/**
 * The workspace switcher, and the isolation it exists to give.
 *
 * Record 0049 makes the workspace a container that a person chooses. These
 * journeys drive the visible control and then check what the server holds, so
 * a switch that only changed the address would fail.
 *
 * Every workspace and note here carries a name of its own, because the browser
 * gate runs the files in parallel workers (record 0036).
 */
import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openNavigation,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForLocalWrite,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/** The switcher trigger, whatever workspace it currently names. */
function switcher(page: Page) {
  return page.getByRole('button', { name: /^Workspace: / });
}

/** Opens the switcher menu and returns it. */
async function openSwitcher(page: Page) {
  await openNavigation(page);
  await switcher(page).click();
  const menu = page.getByRole('menu', { name: /^Workspace: / });
  await expect(menu).toBeVisible();
  return menu;
}

/** Makes a workspace through the pinned row of the switcher. */
async function createWorkspace(page: Page, name: string): Promise<string> {
  const menu = await openSwitcher(page);
  await menu.getByRole('menuitemradio', { name: 'New workspace' }).click();
  await page.getByLabel('Workspace name').fill(name);
  await page.getByRole('button', { name: 'Make workspace' }).click();
  // The switcher names the new workspace once the list has been read again,
  // and the address moves with it.
  await expect(switcher(page)).toHaveAccessibleName(`Workspace: ${name}`);
  await page.waitForURL(/\/w\/[0-9a-f-]+$/);
  const match = /\/w\/([0-9a-f-]+)$/.exec(new URL(page.url()).pathname);
  const workspaceId = match?.[1];
  if (workspaceId === undefined)
    throw new Error('The new workspace has no address.');
  return workspaceId;
}

/** Writes one named note in the open workspace and waits for the server. */
async function writeNote(page: Page, name: string): Promise<void> {
  await createNewNote(page);
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, `# ${name}\n`);
  await waitForServerSave(page);
}

/** Moves to one workspace by name through the switcher. */
async function switchTo(page: Page, name: string): Promise<void> {
  const menu = await openSwitcher(page);
  await menu.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(switcher(page)).toHaveAccessibleName(`Workspace: ${name}`);
}

// This journey runs first on purpose. The stack is owned by the worker and
// every journey of this file shares its server, so only the first one sees an
// account that still holds one workspace.
test('the last workspace offers no delete action', async ({ page, stack }) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  // Record 0051. One workspace means the row is absent, so a person never
  // reaches a control that always refuses.
  const menu = await openSwitcher(page);
  await expect(
    menu.getByRole('menuitemradio', { name: 'Delete permanently' }),
  ).toHaveCount(0);
  await expect(
    menu.getByRole('menuitemradio', { name: 'New workspace' }),
  ).toBeVisible();
});

test('a second workspace keeps its notes away from the first', async ({
  page,
  stack,
}) => {
  await signIn(page, stack);
  const personalId = await openPersonalWorkspace(page);
  await openNavigation(page);
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Personal');

  await writeNote(page, 'Personal only note');

  const workId = await createWorkspace(page, 'Work sw1');
  expect(workId).not.toBe(personalId);

  // The new workspace is empty. The note of the other one is not in its tree.
  // The sidebar and the note list each name the empty state, so the check
  // reads the tree and not whichever one the page happened to render first.
  await openNavigation(page);
  const tree = page.getByRole('complementary', { name: 'Notes navigation' });
  await expect(tree.getByText('No notes yet.')).toBeVisible();
  await expect(
    tree.getByRole('link', { name: 'Personal only note', exact: true }),
  ).toHaveCount(0);

  await writeNote(page, 'Work only note');

  await switchTo(page, 'Personal');
  await page.waitForURL(new RegExp(`/w/${personalId}`));
  await openNavigation(page);
  await expect(
    tree.getByRole('link', { name: 'Personal only note', exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole('link', { name: 'Work only note', exact: true }),
  ).toHaveCount(0);

  // The server agrees, and not only the screen. Each note is in one workspace.
  const inPersonal = await stack.readNotePaths(personalId);
  const inWork = await stack.readNotePaths(workId);
  expect(inPersonal).toContain('Personal only note.md');
  expect(inPersonal).not.toContain('Work only note.md');
  expect(inWork).toContain('Work only note.md');
  expect(inWork).not.toContain('Personal only note.md');
});

test('the chosen workspace survives a reload', async ({ page, stack }) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const workId = await createWorkspace(page, 'Work sw2');

  await page.goto(`${stack.baseUrl}/`);
  // The root address opens the workspace this device last chose, not the
  // personal one.
  await page.waitForURL(new RegExp(`/w/${workId}$`));
  await openNavigation(page);
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Work sw2');
});

test('a workspace is renamed from the switcher', async ({ page, stack }) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createWorkspace(page, 'Work sw3');

  const menu = await openSwitcher(page);
  await menu.getByRole('menuitemradio', { name: 'Rename workspace' }).click();
  await page.getByLabel('Workspace name').fill('Consulting sw3');
  await page.getByRole('button', { name: 'Rename workspace' }).click();

  await expect(switcher(page)).toHaveAccessibleName(
    'Workspace: Consulting sw3',
  );
  const listed = (await stack.readWorkspaces()).map((one) => one.name);
  expect(listed).toContain('Consulting sw3');
  expect(listed).not.toContain('Work sw3');
});

test('a workspace is deleted and the person lands in another one', async ({
  page,
  stack,
}) => {
  await signIn(page, stack);
  const personalId = await openPersonalWorkspace(page);
  const workId = await createWorkspace(page, 'Work sw4');
  await writeNote(page, 'Note that goes sw4');

  const menu = await openSwitcher(page);
  await menu.getByRole('menuitemradio', { name: 'Delete permanently' }).click();
  // The dialog states what goes and asks for the name, because nothing above a
  // workspace holds a Trash.
  await page.getByLabel('Type Work sw4 to confirm').fill('Work sw4');
  await page.getByRole('button', { name: 'Delete permanently' }).click();

  await page.waitForURL(new RegExp(`/w/${personalId}`));
  await openNavigation(page);
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Personal');

  // The server took the workspace with it.
  const listed = await stack.readWorkspaces();
  expect(listed.map((one) => one.workspaceId)).not.toContain(workId);
  expect(listed.map((one) => one.name)).not.toContain('Work sw4');
});

test('a save reaches the server after the person switches away', async ({
  page,
  stack,
}) => {
  // Record 0050. The engine of a workspace that still holds queued work keeps
  // running, so a save does not wait for the person to come back.
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const workId = await createWorkspace(page, 'Work sw5');

  await createNewNote(page);
  await page.getByLabel('Note name').fill('Left behind sw5');
  await replaceEditorText(page, '# Left behind sw5\n');
  // Leave as soon as the write is on the device, without waiting for the
  // server, so the queue is what carries the note.
  await waitForLocalWrite(page);

  await switchTo(page, 'Personal');
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Personal');

  // The person never returns to the other workspace. Its queue drains anyway.
  await expect
    .poll(async () => await stack.readNotePaths(workId), { timeout: 30_000 })
    .toContain('Left behind sw5.md');
});

test('the command palette moves between workspaces', async ({
  page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createWorkspace(page, 'Work sw6');
  await switchTo(page, 'Personal');

  await page.getByRole('button', { name: /Search notes/ }).click();
  const palette = page.getByRole('dialog', {
    name: 'Search notes and run actions',
  });
  await palette.getByLabel('Search notes, or type an action').fill('Work sw6');
  await palette.getByRole('option', { name: 'Go to Work sw6' }).click();

  await openNavigation(page);
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Work sw6');
});
