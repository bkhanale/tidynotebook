/**
 * The decisions of the installed worker of notesapp.
 *
 * Every function here reads its inputs and returns an answer. None of them
 * opens a cache, calls the network, or touches a worker scope, so each rule of
 * `service-worker.ts` can be proved on its own. The worker holds the effects
 * and this module holds the choices.
 */
import { isLegalPath } from '../lib/legal-path.ts';
import { isReaderPath } from '../lib/reader-path.ts';
import { isAssetPath } from './asset-kinds.ts';

/** What a routing decision reads from one request. */
export type RoutedRequest = {
  readonly method: string;
  readonly mode: string;
  readonly url: string;
};

/** Whether a request is a same-origin static asset this worker may keep. */
export function isCacheableAsset(
  request: RoutedRequest,
  origin: string,
): boolean {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== origin) return false;
  return isAssetPath(url.pathname);
}

/**
 * Whether this worker has an answer of its own for a request.
 *
 * A worker that takes over a request it cannot answer adds one failure path
 * and nothing else: the request then travels through the worker, and a worker
 * that stops, or a network that fails, ends it with a worker error instead of
 * the plain network error the page knows. So the worker stands aside unless
 * it holds the page shell, a static asset, or pinned bytes for the address.
 *
 * A navigation is served, because the worker holds the page shell for it: the
 * navigate branch of `handleFetch` answers a failed network with the stored
 * shell, which is how an offline launch reaches a screen at all.
 *
 * A published address is the one navigation that this worker refuses. The
 * shell is this application and the reader page is not, so a device that holds
 * the application and has no connection answered a published address with the
 * application and its not found screen. The reader has no connection either in
 * that case, so nothing would work; the message was still the wrong one. The
 * worker stands aside and the browser reports the lost connection itself.
 * The page of a legal document is a server document for the same reason
 * (record 0140), so the worker stands aside for it too.
 */
export function servedByWorker(
  request: RoutedRequest,
  origin: string,
  pinnedUrls: ReadonlySet<string>,
): boolean {
  const url = new URL(request.url);
  if (url.origin !== origin) return false;
  if (isReaderPath(url.pathname) || isLegalPath(url.pathname)) return false;
  if (request.mode === 'navigate') return true;
  if (request.method !== 'GET') return false;
  if (isCacheableAsset(request, origin)) return true;
  return pinnedUrls.has(url.href);
}

/**
 * The answer that navigation preload already started, or `null`.
 *
 * A controlled navigation waits for the worker to start before its request
 * reaches the server, because the worker decides the answer. Navigation
 * preload removes that wait: the browser starts the request for the document
 * while it starts the worker, and hands the answer to the fetch event.
 *
 * The value arrives as `undefined` in a browser that does not support the
 * feature, and in a worker that has not enabled it, so this guard states what
 * a usable answer is and never claims a type. A miss means the worker asks for
 * the document itself, which is what every navigation did before.
 */
export function preloadedResponse(value: unknown): Response | null {
  return value instanceof Response ? value : null;
}

/**
 * Runs one task for each item, with no more than `limit` running at a time.
 *
 * The precache of this worker holds about a hundred entries and a browser
 * opens six connections to one host, so a precache that asks for everything at
 * once takes every connection and the page waits behind the worker for its own
 * modules. Each reader below takes the next item, so the whole list is visited
 * exactly once and the depth of the queue stays bounded.
 */
export async function forEachBounded<Item>(
  items: readonly Item[],
  limit: number,
  run: (item: Item) => Promise<void>,
): Promise<void> {
  // One shared position, read and raised with no await between the two steps,
  // so each item is taken by exactly one reader.
  let next = 0;
  const reader = async (): Promise<void> => {
    for (;;) {
      const item = items[next];
      next += 1;
      if (item === undefined) return;
      await run(item);
    }
  };
  const readers = Math.max(0, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: readers }, () => reader()));
}
