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
    testInfo.project.name === 'phone-390' ||
      testInfo.project.name === 'tablet-768',
    'Desktop engines cover offline recovery.',
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
  // WebKit needs one controlled navigation after a new service worker is
  // activated before it can serve a later offline navigation.
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Online base');
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);

  await context.setOffline(true);
  await replaceEditorText(page, '# Offline draft\n\nStill here.');
  await expect(page.getByText(/Saved on this device/)).toBeVisible();
  // Playwright's WebKit engine fails the navigation itself when its context
  // is offline. It still covers the offline write, durable reload, and later
  // sync, but the reload starts after transport returns for that engine.
  if (testInfo.project.name === 'webkit') await context.setOffline(false);
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Still here.');

  if (testInfo.project.name !== 'webkit') await context.setOffline(false);
  await page.getByRole('button', { name: 'Save a checkpoint now' }).click();
  await waitForServerSave(page);
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Still here.');
});
