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

test('Markdown preview, history, search, outline, and backlinks work', async ({
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
    '# Feature heading\n\nSearchable browser phrase with **strong text**.\n\n- [x] Complete\n- [ ] Open\n\n| Name | Value |\n| --- | ---: |\n| count | 2 |\n\n> Quoted text\n\n```ts\nconst value = 2;\n```',
  );
  await page.getByRole('button', { name: 'Save this note' }).click();
  await waitForServerSave(page);

  await expect(
    page.locator('.cm-np-heading').filter({ hasText: 'Feature heading' }),
  ).toBeVisible();
  await expect(page.locator('.cm-np-bold')).toHaveText('strong text');
  await expect(
    page.locator('[data-notesapp-rich="table"] table'),
  ).toContainText('count');
  await expect(page.locator('.cm-np-quote')).toContainText('Quoted text');
  await expect(page.locator('.cm-np-code-block')).toContainText(
    'const value = 2;',
  );
  await page.getByRole('button', { name: 'Outline' }).click();
  await expect(
    page
      .locator('#notes-outline-panel')
      .getByText('Feature heading', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Backlinks' }).click();
  await expect(page.getByText(/No accepted note links here/)).toBeVisible();
  await page
    .getByLabel('Search note content')
    .fill('Searchable browser phrase');
  await expect(page.getByText(path, { exact: true }).first()).toBeVisible();

  await page.keyboard.press('Control+O');
  const quickOpen = page.getByRole('dialog', { name: 'Open note' });
  await expect(quickOpen).toBeVisible();
  await quickOpen.getByLabel('Open a note').fill(path);
  await expect(
    quickOpen.getByRole('option', { name: new RegExp(path) }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(quickOpen).toBeHidden();

  await page.getByRole('link', { name: 'History and checkpoints' }).click();
  await expect(
    page.getByRole('heading', { name: `History of ${path}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Server history' }),
  ).toBeVisible();
});
