import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('an offline edit survives reload and syncs after reconnect', async ({
  checkedPage: page,
  context,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'One engine covers network emulation.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await page.getByRole('button', { name: 'Create a new note' }).first().click();
  await page
    .getByLabel('File path')
    .fill(`offline-${Date.now().toString()}.md`);
  await replaceEditorText(page, '# Online base');
  await page.getByRole('button', { name: 'Save a checkpoint now' }).click();
  await waitForServerSave(page);
  await page.evaluate(async () => navigator.serviceWorker.ready);

  await context.setOffline(true);
  await replaceEditorText(page, '# Offline draft\n\nStill here.');
  await expect(page.getByText(/Saved on this device/)).toBeVisible();
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Still here.');

  await context.setOffline(false);
  await page.getByRole('button', { name: 'Save a checkpoint now' }).click();
  await waitForServerSave(page);
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Still here.');
});
