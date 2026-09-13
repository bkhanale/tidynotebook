import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import { openNavigation, signIn } from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

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
  const folderName = page.getByLabel('Folder name');
  await folderName.pressSequentially('Enter folder');
  await folderName.press('Enter');
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
  const folderName = page.getByLabel('Folder name');
  await folderName.fill('Escape folder');
  await folderName.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Escape folder', exact: true }),
  ).toBeHidden();
});
