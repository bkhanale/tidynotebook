import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  openNavigation,
  openPersonalWorkspace,
  signIn,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

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
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await openNavigation(page);

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
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await openNavigation(page);

  const names = [
    'Recipes',
    'Travel plans',
    'Work log',
    'Reading list',
    'Ideas',
    'Receipts',
    'Meeting notes',
    'Projects',
  ];
  for (const name of names) {
    await page.getByRole('link', { name: 'All notes' }).click();
    await createTopFolder(page, name);
  }

  const last = names.at(-1) ?? '';
  await page
    .getByRole('button', { name: `Actions for the folder ${last}` })
    .click();
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
  await page
    .getByRole('menuitem', { name: 'New note in this folder' })
    .click();
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
