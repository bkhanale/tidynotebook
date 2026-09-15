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
 */
type WorkerScope = {
  readonly location: { readonly origin: string };
  readonly caches: CacheStorage;
  readonly skipWaiting: () => Promise<void>;
  readonly clients: { readonly claim: () => Promise<void> };
  /** The precache manifest the build injects. Never edited by hand. */
  readonly __WB_MANIFEST: readonly {
    readonly url: string;
    readonly revision: string | null;
  }[];
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

/** Versioned application asset cache of this worker. */
const appCacheName = 'notesapp-app-v1';

/** Explicitly pinned bytes named by the main thread. */
const pinnedCacheName = 'notesapp-pinned-v1';

/** Static application assets this worker may store. */
const assetPattern =
  /\.(?:js|css|woff2?|ttf|otf|svg|png|ico|webmanifest|html)$/;

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

/** Whether a request is a same-origin static asset this worker may keep. */
function isCacheableAsset(request: Request, origin: string): boolean {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== origin) return false;
  return assetPattern.test(url.pathname);
}

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
  await Promise.all(
    self.__WB_MANIFEST.map(async (entry) => {
      try {
        const response = await fetch(entry.url);
        if (response.ok) await cache.put(entry.url, response.clone());
      } catch {
        // One asset that does not load must not stop the whole precache.
      }
    }),
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

/**
 * Whether this worker has an answer of its own for a request.
 *
 * A worker that takes over a request it cannot answer adds one failure path
 * and nothing else: the request then travels through the worker, and a worker
 * that stops, or a network that fails, ends it with a worker error instead of
 * the plain network error the page knows. So the worker stands aside unless
 * it holds the page shell, a static asset, or pinned bytes for the address.
 */
function servedByWorker(request: Request): boolean {
  if (request.mode === 'navigate') return true;
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (isCacheableAsset(request, self.location.origin)) return true;
  return pinnedUrls.has(url.href);
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
        // Cleanup is best effort. The worker still takes over the clients.
      }
      await readPinnedUrls();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (!servedByWorker(event.request)) return;
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

export {};
