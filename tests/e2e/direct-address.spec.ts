import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import type { E2EStack } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/**
 * Writes one note in a browser that the journey then throws away.
 *
 * The page under test has to reach the note address on its very first
 * document, so it cannot be the page that made the note. This helper leaves
 * the note on the server and hands back its address.
 */
async function writeNoteInAnotherBrowser(
  page: Page,
  stack: E2EStack,
  name: string,
): Promise<string> {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# Opened by address');
  await waitForServerSave(page);
  return page.url();
}

test('a note address opens in a browser that never loaded the application', async ({
  browser,
  checkedPage: page,
  context,
  stack,
}) => {
  const name = `direct-${String(Date.now())}`;
  const author = await browser.newContext();
  const shared = await (async () => {
    try {
      await prepareCleanBrowser(author);
      const address = await writeNoteInAnotherBrowser(
        await author.newPage(),
        stack,
        name,
      );
      return { address, session: await author.cookies() };
    } finally {
      await author.close();
    }
  })();

  // The first document of this browser is the note itself. Nothing is cached,
  // no worker is installed, and every module of the screen is fetched while
  // this first document installs the worker. The `checkedPage` fixture fails
  // this journey on a page error or a console error, so a module that cannot
  // load is caught here as well as by the assertions below.
  await context.addCookies(shared.session);
  // One navigation and no retry, because this journey asserts a property of
  // the first document of this browser: a second one would be controlled by
  // the worker that the first installed. `commit` is what firefox needs,
  // because it can leave the navigation promise pending after the document
  // has rendered, and the assertions below decide that the screen is there.
  await page.goto(shared.address, { waitUntil: 'commit' });

  await expect(page.getByLabel('Note name')).toHaveValue(name);
  await expect(page.locator('.cm-content')).toContainText('Opened by address');

  // The worker installs from this document but never takes it, so the document
  // reads every module from the network for its whole life and no worker
  // decides the outcome of a load that started without one. The next
  // navigation is controlled, which `offline.spec.ts` proves. See decision
  // 0044.
  await page.evaluate(async () => navigator.serviceWorker.ready);
  const controlled = await page.evaluate(
    () => navigator.serviceWorker.controller !== null,
  );
  expect(controlled, 'The worker took the document that installed it.').toBe(
    false,
  );
});
