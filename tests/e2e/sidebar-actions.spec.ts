import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  openNavigation,
  openPersonalWorkspace,
  signIn,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/** Below this width the tree lives in the drawer and has no sizing edge. */
const wideOnly = 768;

/**
 * Narrows the sidebar to its first step, through the edge a person drags.
 *
 * The sidebar is at its widest supply of names on the step it opens with, so
 * a journey that reads the room a row has must ask for the narrowest step
 * the product offers. The edge is the real control, so no test-only value
 * reaches the application.
 */
async function narrowTheSidebar(page: Page): Promise<void> {
  const edge = page.getByRole('separator', { name: 'Sidebar width' });
  const sidebar = page.locator('#notes-sidebar');
  await edge.focus();
  let width = (await sidebar.boundingBox())?.width ?? 0;
  for (let step = 0; step < 6; step += 1) {
    await edge.press('ArrowLeft');
    const next = (await sidebar.boundingBox())?.width ?? 0;
    if (next === width) break;
    width = next;
  }
}

/** Makes one folder inside another through the row menu of the parent. */
async function createFolderIn(
  page: Page,
  parent: string,
  name: string,
): Promise<void> {
  await page
    .getByRole('button', { name: `Actions for the folder ${parent}` })
    .click();
  await page
    .getByRole('menuitem', { name: 'New folder in this folder' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByLabel('Folder name').fill(name);
  await dialog.getByRole('button', { name: 'Make folder' }).click();
  await expect(dialog).toBeHidden();
}

/** Makes one folder at the top of the tree. */
async function createTopFolder(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: 'New folder', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByLabel('Folder name').fill(name);
  await dialog.getByRole('button', { name: 'Make folder' }).click();
  await expect(dialog).toBeHidden();
}

/** The actions that the row menu of a folder holds. */
const folderActions = [
  'New note in this folder',
  'New folder in this folder',
  'Rename folder',
  'Publish folder',
  'Delete folder',
];

test('every action of a deep folder row is on the screen', async ({
  checkedPage: page,
  stack,
}) => {
  // The defect this covers: the menu was laid out inside the folder tree,
  // which scrolls, and a box that scrolls on one axis clips on both. The menu
  // of a deep row lost its left edge and the menu of a row near the foot of
  // the tree showed one of its five actions.
  const viewport = page.viewportSize();
  test.skip(
    viewport === null || viewport.width < wideOnly,
    'The narrow frame has no fixed sidebar to size.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await narrowTheSidebar(page);

  await createTopFolder(page, 'Engineering');
  await createFolderIn(page, 'Engineering', 'Architecture decisions');
  await createFolderIn(page, 'Architecture decisions', 'Superseded records');

  await page
    .getByRole('button', { name: 'Actions for the folder Superseded records' })
    .click();
  const menu = page.getByRole('menu', {
    name: 'Actions for the folder Superseded records',
  });
  await expect(menu).toBeVisible();

  const screen = page.viewportSize();
  expect(screen).not.toBeNull();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  if (box === null || screen === null) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(screen.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(screen.height);

  for (const action of folderActions)
    await expect(menu.getByRole('menuitem', { name: action })).toBeVisible();
});

test('every action of the last folder row is on the screen', async ({
  checkedPage: page,
  stack,
}) => {
  // The same defect, in the other direction: a row low enough that the menu
  // would reach past the foot of the tree. The menu opens above its row.
  const viewport = page.viewportSize();
  test.skip(
    viewport === null || viewport.width < wideOnly,
    'The narrow frame has no fixed sidebar to size.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await narrowTheSidebar(page);

  // Enough folders that the tree fills its own box and the last row sits at
  // the foot of it. That row is the one whose menu had nowhere to go.
  const tree = page.locator('#notes-sidebar div.overflow-y-auto').first();
  const names: string[] = [];
  for (let index = 1; index <= 24; index += 1) {
    const name = `Folder ${String(index).padStart(2, '0')}`;
    names.push(name);
    await page.getByRole('link', { name: 'All notes' }).click();
    await createTopFolder(page, name);
    const box = await tree.boundingBox();
    const rows = await tree.evaluate((node) => node.scrollHeight);
    if (box !== null && rows > box.height) break;
  }

  const last = names.at(-1) ?? '';
  const lastRow = page.getByRole('button', {
    name: `Actions for the folder ${last}`,
  });
  await lastRow.scrollIntoViewIfNeeded();
  await lastRow.click();
  const menu = page.getByRole('menu', {
    name: `Actions for the folder ${last}`,
  });
  await expect(menu).toBeVisible();

  const screen = page.viewportSize();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  if (box === null || screen === null) return;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(screen.height);

  // The row really is at the foot of the tree, so this journey proves the
  // case it claims and not a row with room under it.
  const treeBox = await tree.boundingBox();
  const rowBox = await lastRow.boundingBox();
  expect(treeBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  if (treeBox !== null && rowBox !== null)
    expect(rowBox.y).toBeGreaterThan(treeBox.y + treeBox.height * 0.75);

  for (const action of folderActions)
    await expect(menu.getByRole('menuitem', { name: action })).toBeVisible();
});

test('the root row opens the screen that it names', async ({
  checkedPage: page,
  stack,
}) => {
  // The defect this covers: the row named `All notes` set the parent of the
  // next create action and took a drop, and neither of those moves the
  // screen, so the one row named `All notes` never opened the screen named
  // `All notes`.
  await signIn(page, stack);
  const workspaceId = await openPersonalWorkspace(page);
  await openNavigation(page);

  await createTopFolder(page, 'Engineering');
  await page
    .getByRole('button', { name: 'Actions for the folder Engineering' })
    .click();
  await page.getByRole('menuitem', { name: 'New note in this folder' }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+$/);

  await openNavigation(page);
  const root = page.getByRole('link', { name: 'All notes' });
  await root.click();
  await page.waitForURL(new RegExp(`/w/${workspaceId}$`));
  await expect(
    page.getByRole('heading', { name: 'All notes', level: 1 }),
  ).toBeVisible();
  await openNavigation(page);
  await expect(root).toHaveAttribute('aria-current', 'page');

  // It still names the parent of the next create action, so a new folder
  // lands at the top and not inside the note that was open.
  await createTopFolder(page, 'Personal journal');
  await expect(
    page.getByRole('button', { name: 'Personal journal', exact: true }),
  ).toBeVisible();
});
