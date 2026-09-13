import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  closeNavigation,
  createNewNote,
  openNavigation,
  openPersonalWorkspace,
  replaceEditorText,
  runNoteAction,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('create, save, reload, rename, and delete use durable note state', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const path = `journey-${Date.now().toString()}`;
  const renamed = `renamed-${Date.now().toString()}`;
  const content = '# Durable journey\n\nExact browser text.';
  await expect(page.getByLabel('Note name')).toBeFocused();
  await page.getByLabel('Note name').fill(path);
  await replaceEditorText(page, content);

  // The note saves itself. One version follows the typing pause and reaches
  // the server, so the journey waits for that write instead of pressing a
  // Save button.
  const startedAt = Date.now();
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/changesets'),
  );
  expect((await saveResponse).ok()).toBe(true);
  await waitForServerSave(page);
  expect(Date.now() - startedAt).toBeLessThan(15_000);
  await openNavigation(page);
  await expect(page.getByRole('link', { name: path }).first()).toBeVisible();

  await page.reload();
  await expect(page.locator('.cm-content')).toContainText(
    'Exact browser text.',
  );
  await expect(page.getByLabel('Note name')).toHaveValue(path);

  await page.getByLabel('Note name').fill(renamed);
  // A rename is a draft until a version is created, so make one on purpose.
  await page.keyboard.press('Control+S');
  await waitForServerSave(page);
  await openNavigation(page);
  await expect(page.getByRole('link', { name: renamed }).first()).toBeVisible();

  await closeNavigation(page);
  await runNoteAction(page, 'Delete this note');
  await expect(page.getByText(`${renamed} moved to Trash.`)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Restore', exact: true }),
  ).toBeVisible();
  await openNavigation(page);
  await expect(page.getByRole('link', { name: renamed })).toHaveCount(0);
});

test('a save made during the first sync keeps its parent', async ({
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
    await createNewNote(page);

    const path = `ordered-${Date.now().toString()}`;
    await page.getByLabel('Note name').fill(path);
    await replaceEditorText(page, '# First checkpoint');
    await page.locator('.cm-content').press('Control+S');
    await firstRequestStarted;

    await replaceEditorText(page, '# Second checkpoint');
    await page.locator('.cm-content').press('Control+S');
    releaseFirstRequest();

    await waitForServerSave(page);
    await expect(page.getByText('Conflict')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.cm-content')).toContainText(
      'Second checkpoint',
    );

    await runNoteAction(page, 'Delete this note');
    await expect(page.getByText(`${path} moved to Trash.`)).toBeVisible();
    await expect(page.getByRole('link', { name: path })).toHaveCount(0);
  } finally {
    releaseFirstRequest();
    await context.close();
  }
});
