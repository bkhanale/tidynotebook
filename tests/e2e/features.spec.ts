import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('history, sharing, search, outline, and backlinks stay reachable', async ({
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
    '# Feature heading\n\nSearchable browser phrase.',
  );
  await page.getByRole('button', { name: 'Save a checkpoint now' }).click();
  await waitForServerSave(page);

  await page.getByText('Public sharing', { exact: true }).click();
  const publish = page.getByRole('button', { name: 'Publish new link' });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(
    page.getByText('The accepted revision is public. Copy the URL now.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /\/s\// })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('The public link is revoked.')).toBeVisible();
  await page.getByRole('button', { name: 'Outline' }).click();
  await expect(page.getByText('Feature heading')).toBeVisible();
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
