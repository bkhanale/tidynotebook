import type { BrowserContext } from '@playwright/test';

/** Clears persistent browser state before the first application document. */
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
    void navigator.serviceWorker
      ?.getRegistrations()
      .then(async (registrations) => {
        await Promise.all(
          registrations.map(async (registration) => registration.unregister()),
        );
      });
    void caches?.keys().then(async (names) => {
      await Promise.all(names.map(async (name) => caches.delete(name)));
    });
    void indexedDB.databases().then(async (databases) => {
      await Promise.all(
        databases.flatMap((database) => {
          const name = database.name;
          if (name === undefined) return [];
          return [
            new Promise<void>((accept) => {
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = () => accept();
              request.onerror = () => accept();
              request.onblocked = () => accept();
            }),
          ];
        }),
      );
    });
  });
}
