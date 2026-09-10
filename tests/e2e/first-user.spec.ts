import { test, expect, startE2EStack } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  replaceEditorText,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('the first account opens a Personal workspace and saves its first note', async ({
  checkedPage: page,
  browserName,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Chromium covers the isolated first-installation contract.',
  );

  const stack = await startE2EStack(browserName, false);
  try {
    await page.goto(`${stack.baseUrl}/login`);
    await expect(
      page.getByRole('heading', { name: 'Create your account' }),
    ).toBeVisible();
    await page.getByLabel('Address').fill('first-user@e2e.notes.invalid');
    await page.getByLabel('Password').fill('first-user-password');
    await page.getByRole('button', { name: 'Create account' }).click();

    await page.waitForURL(/\/w\/[0-9a-f-]+$/);
    await expect(
      page.getByRole('heading', { name: 'Personal', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Personal/ })).toBeVisible();

    await createNewNote(page);
    const name = page.getByLabel('Note name');
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('New note');
    await expect(name).not.toHaveValue(/\.md$/i);
    await name.fill('My first note');
    await replaceEditorText(
      page,
      '# First heading\n\nThis is **rendered** while it stays editable.\n\n| State | Value |\n| --- | --- |\n| save | valid |',
    );

    await expect(
      page.locator('.cm-np-heading').filter({ hasText: 'First heading' }),
    ).toBeVisible();
    await expect(page.locator('.cm-np-bold')).toHaveText('rendered');
    await expect(
      page.locator('[data-notesapp-rich="table"] table'),
    ).toContainText('valid');

    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/changesets'),
    );
    await page.getByRole('button', { name: 'Save this note' }).click();
    expect((await response).status()).toBe(200);
    await waitForServerSave(page);

    await page.reload();
    await expect(page.getByLabel('Note name')).toHaveValue('My first note');
    await expect(page.locator('.cm-content')).toContainText(
      'This is rendered while it stays editable.',
    );
  } finally {
    await stack.close();
  }
});
