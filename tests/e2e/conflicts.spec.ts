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

test('two browser contexts create and explicitly resolve a conflict', async ({
  checkedPage: first,
  browser,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'One engine covers concurrent contexts.',
  );
  await signIn(first, stack);
  const workspaceId = await openPersonalWorkspace(first);
  await first
    .getByRole('button', { name: 'Create a new note' })
    .first()
    .click();
  await first
    .getByLabel('File path')
    .fill(`conflict-${Date.now().toString()}.md`);
  await replaceEditorText(first, '# Shared\n\nBase');
  await first.getByRole('button', { name: 'Save a checkpoint now' }).click();
  await waitForServerSave(first);
  const noteUrl = first.url();

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  try {
    await signIn(second, stack);
    await second.goto(noteUrl);
    await expect(second.locator('.cm-content')).toContainText('Base');
    await secondContext.route(
      '**/api/workspaces/*/sync/changes**',
      async (route) => {
        const cursor = new URL(route.request().url()).searchParams.get(
          'cursor',
        );
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ changes: [], nextCursor: cursor ?? '0' }),
        });
      },
    );

    await replaceEditorText(first, '# Shared\n\nCurrent version');
    await first.getByRole('button', { name: 'Save a checkpoint now' }).click();
    await waitForServerSave(first);

    await replaceEditorText(second, '# Shared\n\nIncoming version');
    await waitForLocalWrite(second);
    await second.getByRole('button', { name: 'Save a checkpoint now' }).click();
    await expect(
      second.locator('.notes-save-pill').getByRole('status'),
    ).toContainText('Conflict');
    await secondContext.unroute('**/api/workspaces/*/sync/changes**');
    await second.goto(`${stack.baseUrl}/w/${workspaceId}/conflicts`);
    await expect(
      second.getByRole('heading', { name: 'Conflict group', exact: true }),
    ).toBeVisible();
    const incomingChoices = second.getByLabel('Take the incoming lines');
    await incomingChoices.first().waitFor();
    for (let index = 0; index < (await incomingChoices.count()); index += 1)
      await incomingChoices.nth(index).check();
    await second
      .getByRole('button', {
        name: 'Resolve every file of this conflict group',
      })
      .click();
    await expect(second.getByText(/Conflict group resolved/)).toBeVisible();
  } finally {
    await secondContext.close();
  }
});
