import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
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
  await page.getByRole('button', { name: 'Create a new note' }).first().click();
  const path = `features-${Date.now().toString()}.md`;
  await page.getByLabel('File path').fill(path);
  await replaceEditorText(
    page,
    '# Feature heading\n\nSearchable browser phrase with **strong text**.\n\n- [x] Complete\n- [ ] Open\n\n| Name | Value |\n| --- | ---: |\n| count | 2 |\n\n> Quoted text\n\n```ts\nconst value = 2;\n```',
  );
  await page.getByRole('button', { name: 'Save this note' }).click();
  await waitForServerSave(page);

  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.locator('.notes-markdown');
  await expect(
    preview.getByRole('heading', { name: 'Feature heading' }),
  ).toBeVisible();
  await expect(preview.locator('strong')).toHaveText('strong text');
  await expect(preview.locator('table')).toContainText('count');
  await expect(preview.locator('blockquote')).toHaveText('Quoted text');
  await expect(preview.locator('code.language-ts')).toContainText(
    'const value = 2;',
  );
  await page.getByRole('button', { name: 'Write' }).click();
  await page.getByRole('button', { name: 'Outline' }).click();
  await expect(
    page
      .locator('#notes-outline-panel')
      .getByText('Feature heading', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Backlinks' }).click();
  await expect(page.getByText(/No accepted note links here/)).toBeVisible();
  await page.getByLabel('Search notes').fill('Searchable browser phrase');
  await expect(page.getByRole('link', { name: path }).first()).toBeVisible();

  await page.getByRole('link', { name: 'History and checkpoints' }).click();
  await expect(
    page.getByRole('heading', { name: new RegExp(`History of ${path}`) }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Server history' }),
  ).toBeVisible();
});
