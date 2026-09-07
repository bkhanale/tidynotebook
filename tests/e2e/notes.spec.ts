import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForLocalWrite,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('create, save, reload, rename, and delete use durable note state', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await page.getByRole('button', { name: 'Create a new note' }).first().click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+$/);

  const path = `journey-${Date.now().toString()}.md`;
  const renamed = `renamed-${Date.now().toString()}.md`;
  const content = '# Durable journey\n\nExact browser text.';
  await page.getByLabel('File path').fill(path);
  await replaceEditorText(page, content);
  await expect(
    page.getByText(/Saved on this device|Syncing|Saved to server/),
  ).toBeVisible();

  const startedAt = Date.now();
  await page.getByRole('button', { name: 'Save a checkpoint now' }).click();
  await waitForServerSave(page);
  expect(Date.now() - startedAt).toBeLessThan(10_000);
  await expect(page.getByRole('link', { name: path }).first()).toBeVisible();

  await page.reload();
  await expect(page.locator('.cm-content')).toContainText(
    'Exact browser text.',
  );
  await expect(page.getByLabel('File path')).toHaveValue(path);

  await page.getByLabel('File path').fill(renamed);
  await waitForLocalWrite(page);
  await page.getByRole('button', { name: 'Save a checkpoint now' }).click();
  await waitForServerSave(page);
  await expect(page.getByRole('link', { name: renamed }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Delete this note' }).click();
  await page
    .getByRole('button', { name: 'Confirm deletion of this note' })
    .click();
  await expect(page.getByRole('link', { name: renamed })).toHaveCount(0);
});
