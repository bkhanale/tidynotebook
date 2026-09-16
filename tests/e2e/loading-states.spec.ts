import type { Locator, Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openNavigation,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForServerSave,
} from './support/account.ts';

// The service worker of the application answers with its own fetch, and a
// request that a worker makes never reaches the route below. This journey
// holds one answer open on purpose, so it runs without the worker.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/**
 * Holds every answer of one operation until the test lets it go.
 *
 * The screen then stays in its loading state for as long as the test needs,
 * and without a fixed delay: a call releases the answers, not a timer.
 */
async function holdAnswers(
  page: Page,
  pattern: string,
  onRequest: () => void = () => {},
): Promise<() => void> {
  let release = (): void => {};
  const held = new Promise<void>((accept) => {
    release = accept;
  });
  await page.route(pattern, async (route) => {
    onRequest();
    await held;
    await route.continue();
  });
  return release;
}

/** The shared placeholder that one screen shows while it waits. */
function loadingState(page: Page, label: string): Locator {
  return page.getByRole('status').filter({ hasText: label }).first();
}

/** Proves that a wait uses the shared visual and accessible placeholder. */
async function expectLoadingState(page: Page, label: string): Promise<void> {
  const loading = loadingState(page, label);
  await expect(loading).toBeAttached();
  await expect(loading).toHaveAttribute('aria-busy', 'true');
  await expect(loading.locator('[aria-hidden="true"]')).toHaveCount(1);
}

test('every startup wait shows the shape of the screen that follows', async ({
  checkedPage: page,
  stack,
}) => {
  const releaseAccount = await holdAnswers(page, '**/api/account');
  const releaseSetup = await holdAnswers(page, '**/api/setup');

  await page.goto(`${stack.baseUrl}/`);
  await expectLoadingState(page, 'Your account is loading.');

  releaseAccount();
  await page.waitForURL(`${stack.baseUrl}/login`);
  await expectLoadingState(page, 'The sign-in screen is loading.');

  releaseSetup();
  await expect(page.getByLabel('Address')).toBeVisible();

  const releaseWorkspaces = await holdAnswers(page, '**/api/workspaces');
  await page.getByLabel('Address').fill(stack.email);
  await page.getByLabel('Password', { exact: true }).fill(stack.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expectLoadingState(page, 'Your notes are opening.');

  releaseWorkspaces();
  await openPersonalWorkspace(page);
});

test('a screen that waits shows the shape of what follows', async ({
  checkedPage: page,
  stack,
}) => {
  // The note list is held from before sign in, so the first screen of the
  // session is still waiting when the assertions below run.
  const release = await holdAnswers(page, '**/api/workspaces/*/files?*');
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await openNavigation(page);

  // The placeholder states what loads, in one polite live region. The bars
  // that stand for the rows are decoration, so the sentence is the whole
  // message for assistive technology.
  await expectLoadingState(page, 'Your notes are loading.');

  release();
  await expect(page.getByText('Your notes are loading.')).toHaveCount(0);
});

test('the tree keeps its notes when the window comes back', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  const noteName = `focus-${String(Date.now())}`;
  await page.getByLabel('Note name').fill(noteName);
  await replaceEditorText(page, '# Still here');
  await waitForServerSave(page);
  await openNavigation(page);

  const navigation = page.locator('#notes-sidebar');
  const row = navigation.getByRole('link', { name: noteName });
  await expect(row).toBeVisible();

  // Hold every later read of the note list, so the refresh that the window
  // focus starts is still running while the assertions below run.
  let reads = 0;
  const release = await holdAnswers(page, '**/api/workspaces/*/files?*', () => {
    reads += 1;
  });

  // The window focus refresh waits out a quiet period between reads, so the
  // event is sent until one read starts. This waits for a condition and not
  // for a clock.
  await expect
    .poll(async () => {
      await page.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new Event('focus'));
      });
      return reads;
    })
    .toBeGreaterThan(0);

  // The defect this covers: a refresh emptied the note list and put the
  // placeholder over the tree, every time the person came back to the window.
  await expect(row).toBeVisible();
  await expect(navigation.getByText('Your notes are loading.')).toHaveCount(0);

  release();
  await expect(row).toBeVisible();
});
