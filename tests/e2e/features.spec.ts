import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openPalette,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('the live preview, the outline, and the palette work together', async ({
  checkedPage: page,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'phone-390' ||
      testInfo.project.name === 'tablet-768',
    'Desktop engines cover the complete feature journey.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  const path = `features-${Date.now().toString()}`;
  await page.getByLabel('Note name').fill(path);
  await replaceEditorText(
    page,
    '# Feature heading\n\nSearchable browser phrase with **strong text**.\n\n| Name | Value |\n| --- | ---: |\n| count | 2 |\n\n> Quoted text\n\n```ts\nconst value = 2;\n```',
  );
  await waitForServerSave(page);

  // Every construct renders in place on the one surface.
  await expect(
    page.locator('.cm-np-heading').filter({ hasText: 'Feature heading' }),
  ).toBeVisible();
  await expect(page.locator('.cm-np-bold')).toHaveText('strong text');
  await expect(
    page.locator('.cm-np-table-cell').filter({ hasText: 'count' }),
  ).toBeVisible();
  await expect(page.locator('.cm-np-quote')).toContainText('Quoted text');
  await expect(
    page
      .locator('.cm-np-code-block-line')
      .filter({ hasText: 'const value = 2;' }),
  ).toBeVisible();

  // The outline reads the same syntax tree, so the heading is one row. The
  // section is open by default on a desktop viewport.
  await expect(
    page
      .locator('#notes-outline-panel')
      .getByText('Feature heading', { exact: true }),
  ).toBeVisible();

  // The command palette finds the note by its text, which is the server and
  // the local index answering the same query.
  const palette = await openPalette(page);
  await palette
    .getByLabel('Search notes, or type an action')
    .fill('Searchable browser phrase');
  await expect(
    palette.getByRole('option', { name: new RegExp(path) }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});
