import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  openNavigation,
  openPersonalWorkspace,
  signIn,
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
async function holdAnswers(page: Page, pattern: string): Promise<() => void> {
  let release = (): void => {};
  const held = new Promise<void>((accept) => {
    release = accept;
  });
  await page.route(pattern, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

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
  const loading = page
    .getByRole('status')
    .filter({ hasText: 'Your notes are loading.' })
    .first();
  await expect(loading).toBeAttached();
  await expect(loading).toHaveAttribute('aria-busy', 'true');
  await expect(loading.locator('[aria-hidden="true"]')).toHaveCount(1);

  release();
  await expect(page.getByText('Your notes are loading.')).toHaveCount(0);
});
