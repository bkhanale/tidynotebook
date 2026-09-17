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
  closeNavigation,
  createNewNote,
  openNavigation,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForLocalWrite,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/**
 * The sidebar, at every width.
 *
 * A wide viewport gives it the complementary role. A narrow one opens it as a
 * modal drawer, which is a dialog. The accessible name is the same either way,
 * so the journey names the region and lets the role follow the width.
 */
function sidebar(page: Page) {
  return page
    .getByRole('complementary', { name: 'Notes navigation' })
    .or(page.getByRole('dialog', { name: 'Notes navigation' }));
}

/** The switcher trigger, whatever workspace it currently names. */
function switcher(page: Page) {
  return page.getByRole('button', { name: /^Workspace: / });
}

/**
 * Waits until the switcher names one workspace.
 *
 * A narrow viewport keeps the sidebar in a closed drawer, and every action of
 * the switcher closes that drawer, so the drawer has to be brought back before
 * the trigger can be read. The whole step retries, because the close and the
 * reopen race on that viewport and neither one is a state the journey can wait
 * for on its own.
 */
async function expectWorkspace(page: Page, name: string): Promise<void> {
  await expect(async () => {
    await openNavigation(page);
    await expect(switcher(page)).toHaveAccessibleName(`Workspace: ${name}`, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}

/** The workspace identifier that the address names right now. */
function workspaceIdOf(page: Page): string {
  const match = /\/w\/([0-9a-f-]+)/.exec(new URL(page.url()).pathname);
  if (match?.[1] === undefined)
    throw new Error('The address names no workspace.');
  return match[1];
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
  // The address moves to the new workspace, and the switcher names it. A
  // client side move fires no load event, so the address is a state to assert
  // and not a navigation to wait for.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/);
  await expectWorkspace(page, name);
  return workspaceIdOf(page);
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
  await expectWorkspace(page, name);
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

test('the workspace dialog covers the page, not the sidebar', async ({
  page,
  stack,
}) => {
  // The sidebar slides, so it carries a transform, and a transform makes its
  // box the containing block of every fixed descendant. A dialog rendered
  // inside it is trapped in the width of the sidebar. The frame owns these
  // dialogs for that reason, and this journey holds that rule.
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const menu = await openSwitcher(page);
  await menu.getByRole('menuitemradio', { name: 'New workspace' }).click();

  const panel = page.getByRole('dialog', { name: 'New workspace' });
  await expect(panel).toBeVisible();

  const viewport = page.viewportSize();
  const box = await panel.boundingBox();
  if (viewport === null || box === null)
    throw new Error('The dialog has no box.');
  const aside = await sidebar(page).boundingBox();
  if (aside === null) throw new Error('The sidebar has no box.');

  // Wider than the sidebar, and centred on the viewport rather than pinned
  // inside the left column.
  expect(box.width).toBeGreaterThan(aside.width);
  const centre = box.x + box.width / 2;
  expect(Math.abs(centre - viewport.width / 2)).toBeLessThan(
    viewport.width / 10,
  );
});

test('a second workspace keeps its notes away from the first', async ({
  page,
  stack,
}) => {
  await signIn(page, stack);
  const personalId = await openPersonalWorkspace(page);
  await expectWorkspace(page, 'Personal');

  await writeNote(page, 'Personal only note');

  const workId = await createWorkspace(page, 'Work sw1');
  expect(workId).not.toBe(personalId);

  // The new workspace is empty. The note of the other one is not in its tree.
  // The sidebar and the note list each name the empty state, so the check
  // reads the tree and not whichever one the page happened to render first.
  await openNavigation(page);
  const tree = sidebar(page);
  await expect(tree.getByText('No notes yet.')).toBeVisible();
  await expect(
    tree.getByRole('link', { name: 'Personal only note', exact: true }),
  ).toHaveCount(0);

  await writeNote(page, 'Work only note');

  await switchTo(page, 'Personal');
  await expect(page).toHaveURL(new RegExp(`/w/${personalId}`));
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
  await expect(page).toHaveURL(new RegExp(`/w/${workId}$`));
  await expectWorkspace(page, 'Work sw2');
});

test('a workspace is renamed from the switcher', async ({ page, stack }) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createWorkspace(page, 'Work sw3');

  const menu = await openSwitcher(page);
  await menu.getByRole('menuitemradio', { name: 'Rename workspace' }).click();
  await page.getByLabel('Workspace name').fill('Consulting sw3');
  await page.getByRole('button', { name: 'Rename workspace' }).click();

  await expectWorkspace(page, 'Consulting sw3');
  const listed = (await stack.readWorkspaces()).map((one) => one.name);
  expect(listed).toContain('Consulting sw3');
  expect(listed).not.toContain('Work sw3');
});

test('a workspace is deleted and the person lands in another one', async ({
  page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const workId = await createWorkspace(page, 'Work sw4');
  await writeNote(page, 'Note that goes sw4');

  const menu = await openSwitcher(page);
  await menu.getByRole('menuitemradio', { name: 'Delete permanently' }).click();
  // The dialog states what goes and asks for the name, because nothing above a
  // workspace holds a Trash.
  await page.getByLabel('Type Work sw4 to confirm').fill('Work sw4');
  await page.getByRole('button', { name: 'Delete permanently' }).click();

  // The person lands in the workspace beside the one that went, whichever
  // that is, and never on the address of the workspace they deleted.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+/);
  await expect(page).not.toHaveURL(new RegExp(`/w/${workId}`));
  await openNavigation(page);
  await expect(switcher(page)).toHaveAccessibleName(/^Workspace: /);
  await expect(switcher(page)).not.toHaveAccessibleName('Workspace: Work sw4');

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

  // The drawer covers the header on a narrow viewport, so it closes before the
  // palette opens.
  await closeNavigation(page);
  await page.getByRole('button', { name: /Search notes/ }).click();
  const palette = page.getByRole('dialog', {
    name: 'Search notes and run actions',
  });
  await palette.getByLabel('Search notes, or type an action').fill('Work sw6');
  await palette.getByRole('option', { name: 'Go to Work sw6' }).click();

  await expectWorkspace(page, 'Work sw6');
});
