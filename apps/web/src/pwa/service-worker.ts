/**
 * Installed application worker of notesapp.
 *
 * This worker precaches the application shell, the editor, fonts, math, and
 * diagram modules so an installed application launches offline after its
 * first provisioning. It caches no API response. Only same-origin GET
 * responses for static application assets and
 * the shell document are stored. Everything else travels on the network and
 * is never written to a cache.
 *
 * Pinned workspace content lives in two places. Markdown bodies stay in
 * IndexedDB, owned by the local store, and the main thread copies them
 * there through the generated client. This worker keeps an explicit pinned
 * cache only for bytes the main thread names through a message, such as an
 * image chosen with Make available offline or a historic document chosen
 * with a history pin action. Pinning never pulls a private API response on its
 * own.
 *
 * There is no Background Sync dependency. Sync runs in the foreground tab;
 * this worker only serves cached assets and pinned bytes.
 *
 * Old precaches stay installed while old clients remain active. The worker
 * waits to activate until the application asks for the update after local
 * persistence succeeds, so a reload never strands a running tab.
 *
 * This worker stays out of a load that started without it. It takes no client
 * of its own, so the document that installs it stays on the network for its
 * whole load and the worker controls the next navigation instead. Its precache
 * takes at most half of the connections that a browser opens to one host, so
 * the page keeps a share of them for its own modules. See
 * [decision 0044](../../../../docs/decisions/0044-the-worker-stays-out-of-the-first-load.md).
 */
import { forEachBounded, isCacheableAsset, servedByWorker } from './routing.ts';

type WorkerScope = {
  readonly location: { readonly origin: string };
  readonly caches: CacheStorage;
  readonly skipWaiting: () => Promise<void>;
  addEventListener(
    type: 'install',
    listener: (event: ExtendableEvent) => void,
  ): void;
  addEventListener(
    type: 'activate',
    listener: (event: ExtendableEvent) => void,
  ): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(
    type: 'message',
    listener: (event: ExtendableMessageEvent) => void,
  ): void;
};

type ExtendableEvent = {
  waitUntil(task: Promise<unknown>): void;
};

type FetchEvent = ExtendableEvent & {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
};

type ExtendableMessageEvent = ExtendableEvent & {
  readonly data: unknown;
};

declare const self: WorkerScope;

/**
 * The addresses of this build, written by the build step.
 *
 * `apps/web/src/pwa/precache.ts` derives the list from the emitted files and
 * writes both constants into this script. The build fails when either one
 * stays unwritten, so a worker that reaches a browser always holds them.
 */
declare const __NOTESAPP_PRECACHE__: readonly string[];

/**
 * The name of the asset cache of this build.
 *
 * The name carries a digest of the precached bytes, so a build with different
 * bytes fills a cache of its own and `activate` below deletes the older one.
 * An entry whose address never changes, such as `/index.html`, therefore
 * follows the deployment instead of staying until the browser evicts it.
 */
declare const __NOTESAPP_APP_CACHE__: string;

/** Application asset cache of this build. */
const appCacheName = __NOTESAPP_APP_CACHE__;

/** Explicitly pinned bytes named by the main thread. */
const pinnedCacheName = 'notesapp-pinned-v1';

/** Messages the main thread may send to this worker. */
type WorkerMessage =
  | { readonly type: 'NOTESAPP_SKIP_WAITING' }
  | { readonly type: 'NOTESAPP_PIN'; readonly url: string }
  | { readonly type: 'NOTESAPP_UNPIN'; readonly url: string };

/** Reads an unknown message without asserting its shape. */
function readMessage(value: unknown): WorkerMessage | null {
  if (value === null || typeof value !== 'object') return null;
  const record = Object.fromEntries(Object.entries(value));
  if (record['type'] === 'NOTESAPP_SKIP_WAITING')
    return { type: 'NOTESAPP_SKIP_WAITING' };
  if (record['type'] === 'NOTESAPP_PIN' && typeof record['url'] === 'string')
    return { type: 'NOTESAPP_PIN', url: record['url'] };
  if (record['type'] === 'NOTESAPP_UNPIN' && typeof record['url'] === 'string')
    return { type: 'NOTESAPP_UNPIN', url: record['url'] };
  return null;
}

/**
 * How many precache entries this worker fetches at one time.
 *
 * A browser opens six connections to one host over HTTP/1.1. The manifest
 * holds about a hundred entries, so a worker that asks for all of them at once
 * takes every connection and the page waits behind the worker for its own
 * modules. The worker therefore takes at most half of them and leaves the
 * other half to the page. The install then takes longer and costs nothing,
 * because the six connections carry the same bytes in the same time whatever
 * the depth of the queue behind them.
 */
const precacheConcurrency = 3;

/** Stores every injected precache entry in the versioned asset cache. */
async function precacheShell(): Promise<void> {
  let cache: Cache;
  try {
    cache = await self.caches.open(appCacheName);
  } catch {
    // Storage can be refused or full. The worker still serves the network,
    // so a missing precache must not fail the install.
    return;
  }
  await forEachBounded(
    __NOTESAPP_PRECACHE__,
    precacheConcurrency,
    async (url) => {
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response.clone());
      } catch {
        // One asset that does not load must not stop the whole precache.
      }
    },
  );
}

/**
 * Serves one request for a static asset from the application cache.
 *
 * The cache is an optimisation. A refused or full storage, or a failed
 * write, falls back to the network, because an asset request must never fail
 * only because the cache could not be read.
 */
async function serveAsset(request: Request): Promise<Response> {
  let cache: Cache | null = null;
  try {
    cache = await self.caches.open(appCacheName);
    const hit = await cache.match(request);
    if (hit !== undefined) return hit;
  } catch {
    cache = null;
  }
  const network = await fetch(request);
  if (cache !== null && network.ok) {
    try {
      await cache.put(request, network.clone());
    } catch {
      // A failed write leaves the answer unchanged.
    }
  }
  return network;
}

/**
 * Every address the main thread pinned, as this worker knows them now.
 *
 * The fetch listener has to decide without waiting whether this worker can
 * answer a request at all, and only an address in this set has stored bytes.
 * The set follows the pinned cache: it is read once when the worker starts
 * and it follows every pin and unpin message after that.
 */
const pinnedUrls = new Set<string>();

/** Reads the pinned addresses that an earlier run of this worker stored. */
async function readPinnedUrls(): Promise<void> {
  try {
    const pinned = await self.caches.open(pinnedCacheName);
    for (const request of await pinned.keys()) pinnedUrls.add(request.url);
  } catch {
    // Storage can be refused. The worker then pins nothing and serves the
    // network, which is what a miss does as well.
  }
}

/**
 * Serves one request from the pinned cache, or `undefined` when it misses.
 *
 * A pin is explicit bytes the main thread named. A cache that cannot be read
 * answers a miss, so the request travels to the network instead of failing.
 */
async function servePinned(request: Request): Promise<Response | undefined> {
  try {
    const pinned = await self.caches.open(pinnedCacheName);
    return await pinned.match(request);
  } catch {
    return undefined;
  }
}

/** Serves one fetch without ever storing a private response. */
async function handleFetch(event: FetchEvent): Promise<Response> {
  const request = event.request;
  if (request.mode === 'navigate') {
    try {
      return await fetch(request);
    } catch {
      try {
        const cache = await self.caches.open(appCacheName);
        const shell = await cache.match('/index.html');
        if (shell !== undefined) return shell;
      } catch {
        // Storage is unavailable, so there is no cached shell to serve.
      }
      // A network error and not a thrown error. The page then reports a lost
      // connection, the way it does for a request this worker never saw.
      return Response.error();
    }
  }
  if (isCacheableAsset(request, self.location.origin)) {
    try {
      return await serveAsset(request);
    } catch {
      return Response.error();
    }
  }
  const pinnedHit = await servePinned(request);
  if (pinnedHit !== undefined) return pinnedHit;
  try {
    return await fetch(request);
  } catch {
    return Response.error();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async (): Promise<void> => {
      try {
        const names = await self.caches.keys();
        await Promise.all(
          names.map(async (name) => {
            if (name !== appCacheName && name !== pinnedCacheName)
              await self.caches.delete(name);
          }),
        );
      } catch {
        // Cleanup is best effort. The worker still serves the next
        // navigation.
      }
      await readPinnedUrls();
      // This worker claims no client. A document that loaded without it is
      // already reading every module it needs straight from the network, so
      // taking that document part way through its load adds one failure path
      // and gives it nothing: a cache that misses ends the module in a worker
      // error rather than the plain answer the page was about to receive. The
      // next navigation is controlled from its first byte, which is where an
      // offline launch starts anyway (decision 0044).
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (!servedByWorker(event.request, self.location.origin, pinnedUrls)) return;
  event.respondWith(handleFetch(event));
});

self.addEventListener('message', (event) => {
  const message = readMessage(event.data);
  if (message === null) return;
  if (message.type === 'NOTESAPP_SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (message.type === 'NOTESAPP_PIN') {
    event.waitUntil(
      (async (): Promise<void> => {
        const pinned = await self.caches.open(pinnedCacheName);
        const response = await fetch(message.url);
        if (!response.ok) return;
        await pinned.put(message.url, response.clone());
        pinnedUrls.add(new URL(message.url, self.location.origin).href);
      })(),
    );
    return;
  }
  event.waitUntil(
    (async (): Promise<void> => {
      const pinned = await self.caches.open(pinnedCacheName);
      await pinned.delete(message.url);
      pinnedUrls.delete(new URL(message.url, self.location.origin).href);
    })(),
  );
});
