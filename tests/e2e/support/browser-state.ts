import type { BrowserContext } from '@playwright/test';

/**
 * Clears persistent browser state before the first application document.
 *
 * A Playwright context starts empty, so this helper only guarantees the
 * first document sees no stored values. It must not unregister the service
 * worker: the application registers one during the first document, and an
 * asynchronous unregister here would remove that fresh registration and
 * leave the offline journeys without a worker.
 */
export async function prepareCleanBrowser(
  context: BrowserContext,
): Promise<void> {
  await context.clearCookies();
  await context.addInitScript(() => {
    if (
      window.location.protocol !== 'http:' &&
      window.location.protocol !== 'https:'
    )
      return;
    if (window.sessionStorage.getItem('notesapp-e2e-clean') === 'yes') return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('notesapp-e2e-clean', 'yes');
  });
}
