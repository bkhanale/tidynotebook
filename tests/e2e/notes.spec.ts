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

test('a checkpoint made during the first sync does not conflict with its parent', async ({
  browser,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'One engine covers the ordered checkpoint contract.',
  );

  let releaseFirstRequest = (): void => {};
  const firstRequestRelease = new Promise<void>((accept) => {
    releaseFirstRequest = accept;
  });
  let reportFirstRequest = (): void => {};
  const firstRequestStarted = new Promise<void>((accept) => {
    reportFirstRequest = accept;
  });
  let delayNextRequest = true;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await context.route('**/api/workspaces/*/changesets', async (route) => {
    if (delayNextRequest && route.request().method() === 'POST') {
      delayNextRequest = false;
      reportFirstRequest();
      await firstRequestRelease;
    }
    await route.continue();
  });

  try {
    await signIn(page, stack);
    await openPersonalWorkspace(page);
    await page
      .getByRole('button', { name: 'Create a new note' })
      .first()
      .click();
    await page.waitForURL(/\/notes\/[0-9a-f-]+$/);

    const path = `ordered-${Date.now().toString()}.md`;
    await page.getByLabel('File path').fill(path);
    await replaceEditorText(page, '# First checkpoint');
    await page.getByRole('button', { name: 'Save a checkpoint now' }).click();
    await firstRequestStarted;

    await replaceEditorText(page, '# Second checkpoint');
    await page.getByRole('button', { name: 'Save a checkpoint now' }).click();
    releaseFirstRequest();

    await waitForServerSave(page);
    await expect(page.locator('.notes-save-pill')).not.toContainText(
      'Conflict',
    );
    await page.reload();
    await expect(page.locator('.cm-content')).toContainText(
      'Second checkpoint',
    );

    await page.getByRole('button', { name: 'Delete this note' }).click();
    await page
      .getByRole('button', { name: 'Confirm deletion of this note' })
      .click();
    await expect(page.getByRole('link', { name: path })).toHaveCount(0);
  } finally {
    releaseFirstRequest();
    await context.close();
  }
});
