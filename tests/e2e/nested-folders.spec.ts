import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  openNavigation,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('the selected folder receives a child folder and a saved note', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const suffix = Date.now().toString();
  const parent = `work-${suffix}`;
  const child = `plans-${suffix}`;
  const noteName = `outline-${suffix}`;
  const navigation = page.locator('#notes-sidebar');

  await openNavigation(page);
  await navigation
    .getByRole('button', { name: 'New folder', exact: true })
    .click();
  await page.getByLabel('Folder name').fill(parent);
  await page.getByRole('button', { name: 'Make folder' }).click();

  const work = page.getByRole('button', { name: parent, exact: true });
  await work.click();
  await expect(work).toHaveAttribute('aria-pressed', 'true');
  await expect(work).toHaveAttribute('aria-expanded', 'true');

  await navigation
    .getByRole('button', { name: 'New folder', exact: true })
    .click();
  await page.getByLabel('Folder name').fill('two/levels');
  await page.getByRole('button', { name: 'Make folder' }).click();
  await expect(
    page.getByText('A folder name cannot contain a slash.'),
  ).toBeVisible();
  await page.getByLabel('Folder name').fill(child);
  await page.getByRole('button', { name: 'Make folder' }).click();

  const plans = page.getByRole('button', { name: child, exact: true });
  await expect(plans).toHaveAttribute('aria-pressed', 'true');
  await navigation
    .getByRole('button', { name: 'New note', exact: true })
    .click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+$/);
  await page.getByLabel('Note name').fill(noteName);
  await replaceEditorText(page, '# Nested note');
  await waitForServerSave(page);

  await page.reload();
  await expect(page.getByLabel('Note name')).toHaveValue(noteName);
  await openNavigation(page);
  const savedChild = page
    .getByRole('button', { name: child, exact: true })
    .locator('xpath=ancestor::li[1]');
  await expect(savedChild.getByRole('link', { name: noteName })).toBeVisible();
});
