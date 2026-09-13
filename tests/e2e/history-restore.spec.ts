import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openPersonalWorkspace,
  replaceEditorText,
  runNoteAction,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('an earlier version can be restored from the history', async ({
  checkedPage: page,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'phone-390' ||
      testInfo.project.name === 'tablet-768',
    'Desktop engines cover the history journey.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const name = `history-${Date.now().toString()}`;
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# First content');
  await waitForServerSave(page);
  await replaceEditorText(page, '# Second content');
  await waitForServerSave(page);

  await runNoteAction(page, 'Open the history of this note');
  await expect(
    page.getByRole('heading', { name: `History of ${name}` }),
  ).toBeVisible();

  // Two versions exist, and the older one is restored.
  const restoreButtons = page.getByRole('button', {
    name: 'Restore',
    exact: true,
  });
  await expect(restoreButtons).toHaveCount(2);
  await restoreButtons.last().click();
  await expect(
    page.getByText(
      'That text is back as the newest version. Every earlier version is kept.',
    ),
  ).toBeVisible();

  // The server now holds the earlier text as the newest version. The list
  // reloads after a restore, so the first row is that restored version.
  await expect(
    page.getByText('Earlier text brought back').first(),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /^Saved/ })
    .first()
    .click();
  await page.getByText('Whole text of this version').first().click();
  await expect(
    page.getByLabel(`Whole text of ${name} in this version`).first(),
  ).toContainText('First content');
});
