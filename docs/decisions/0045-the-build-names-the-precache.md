# 0045. The build names the precache and its cache

- Status: Accepted
- Date: 2026-09-16

## Context

`apps/web/src/pwa/service-worker.ts` is written by hand. Two build packages
served it: `vite-plugin-pwa` compiled it and `workbox-build` wrote the list of
addresses into it. Both packages carried a second bundler toolchain for that
one list, and `workbox-window` was imported and discarded in
`apps/web/src/pwa/lifecycle.ts`.

The cache that holds the list was named `notesapp-app-v1` in the source. The
name never changed, `activate` deletes only a cache with another name, and
`serveAsset` answers from the cache before the network. An address that never
changes, such as `/index.html` or `/manifest.webmanifest`, was therefore served
from the deployment that first filled that cache.

## Decision

`apps/web/src/pwa/precache.ts` is the build step of the worker. It reads the
emitted bundle and the public directory, keeps the shell file kinds under the
size cap, leaves out the worker itself and the diagram frame, and compiles the
worker into one classic script at `service-worker.js`.

The name of the asset cache carries a digest of the precached bytes. A build
with other bytes fills a cache of its own, and `activate` deletes every other
one. The build fails when either constant stays unwritten in the script.

This refines [0013](0013-delivery-and-headers-belong-to-the-app.md), which
gives the worker the shell precache, and it keeps every rule of
[0044](0044-the-worker-stays-out-of-the-first-load.md). It excludes a second
bundler in the build, a Workbox runtime in the worker, and a cache name that a
person edits by hand.

## Consequences

The worker holds addresses only. It read a revision for each entry and never
used one, so the list is now one address for each file.

A deployment fills a new cache and the device holds the old one until the new
worker activates, which is the point where old clients are gone.

`apps/web/src/pwa/precache.test.ts` proves the rules and compiles the real
worker. `tests/integration/web-build.test.ts` derives the precache a second
time from the built files and refuses a worker whose cache name does not
follow them. `tests/e2e/offline.spec.ts` stays the offline gate.
