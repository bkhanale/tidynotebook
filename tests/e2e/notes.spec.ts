import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  closeNavigation,
  createNewNote,
  openNavigation,
  openPersonalWorkspace,
  replaceEditorText,
  runNoteAction,
  saveVersion,
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
  // A rename creates its own version, exactly as a pause in typing does, so
  // this journey asks for no Save of its own.
  await page.getByLabel('Note name').press('Enter');
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

test('renaming a saved note reaches the server', async ({
  checkedPage: page,
  stack,
}) => {
  // The defect this covers: the name field started the draft timer alone, and
  // a draft is recovery data of this device that never reaches the server.
  // The new name therefore stopped at the local store, the save state stayed
  // at `saved-local` for good, and a second device kept reading the old name.
  //
  // Naming a note right after the create action always worked, which is why
  // every other journey passed: each one fills the name of a note the create
  // action just focused. This one renames a note that is already on the
  // server, and it reads the server to decide.
  await signIn(page, stack);
  const workspaceId = await openPersonalWorkspace(page);
  await createNewNote(page);

  const first = `saved-${Date.now().toString()}`;
  const second = `${first}-renamed`;
  await page.getByLabel('Note name').fill(first);
  await replaceEditorText(page, '# A note that is already saved\n');
  await saveVersion(page);
  await expect
    .poll(async () => await stack.readNotePaths(workspaceId))
    .toContain(`${first}.md`);

  // The person leaves the note and opens it again, so nothing about the
  // create action is still in play.
  await openNavigation(page);
  await page.getByRole('link', { name: 'All notes' }).click();
  await expect(
    page.getByRole('heading', { name: 'All notes', level: 1 }),
  ).toBeVisible();
  await openNavigation(page);
  await page.getByRole('link', { name: first }).first().click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+$/);
  await expect(page.getByLabel('Note name')).toHaveValue(first);

  // The rename itself, with no Save of its own.
  await page.getByLabel('Note name').fill(second);
  await page.getByLabel('Note name').press('Enter');

  await waitForServerSave(page);
  await expect
    .poll(async () => await stack.readNotePaths(workspaceId), {
      timeout: 30_000,
    })
    .toContain(`${second}.md`);
  expect(await stack.readNotePaths(workspaceId)).not.toContain(`${first}.md`);
});
