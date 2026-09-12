import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('one surface reads and writes the note in place', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await page.getByLabel('Note name').fill('One surface');
  await replaceEditorText(
    page,
    '# Heading\n\nBody with `code`.\n\n- [ ] Task\n\n```js\nconst answer = 42;\n```\n',
  );
  // Move the caret to the top, so no construct shows its source.
  await page.locator('.cm-content').press('Control+Home');
  // The note saves itself; a version follows the typing pause and reaches the
  // server, so there is no Save button to press.
  await waitForServerSave(page);

  // The one surface renders every construct in place.
  await expect(page.locator('.cm-np-h1')).toHaveText('Heading');
  await expect(page.locator('.cm-np-code')).toHaveText('code');
  await expect(page.locator('.cm-np-task')).toBeVisible();
  await expect(page.locator('.cm-np-code-block-line').first()).toBeVisible();

  // The code fence lines hide while the caret sits away from the block, so the
  // ``` markers are gone from the surface but the code stays.
  await expect(page.locator('.cm-content')).toContainText('const answer = 42;');
  await expect(page.locator('.cm-content')).not.toContainText('```');

  // There is no Write and Read toggle any more: one surface, not two.
  await expect(
    page.getByRole('button', { name: 'Read', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Write', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-note-view="read"]')).toHaveCount(0);
});
