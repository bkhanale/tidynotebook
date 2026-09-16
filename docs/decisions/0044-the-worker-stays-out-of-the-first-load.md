# 0044. The worker stays out of the first load

- Status: Accepted
- Date: 2026-09-16

## Context

A person who opens a note address in a browser that never loaded the
application saw the shell module of the screen fail, and the console kept the
failure after the router recovered the screen. A browser run of the built
application on Firefox measured the cause.

`apps/web/src/main.tsx` registered the worker while the entry module ran, so
the install of the worker started while the document was still loading. The
install fetches every entry of the precache manifest, which holds about a
hundred files, and a browser opens six connections to one host. The modules of
the open screen then queued behind the worker: a chunk that took one
millisecond before the flood took forty nine during it.

`apps/web/src/pwa/service-worker.ts` then called `clients.claim()` when it
activated. The measured claim landed at 233 ms, while the lazy modules of the
screen were still arriving. From that instant the worker answered the module
requests of a document it had not served. `serveAsset` falls back to the
network on a miss, and `handleFetch` turns a failed network answer into
`Response.error()`, which a module import reports as a module that cannot load.
A load that started on the network therefore ended in the worker, and the
outcome changed with the timing. Nothing in the application read
`navigator.serviceWorker.controller`, so the claim served no reader.

## Decision

The worker stays out of a load that started without it.

- `registerServiceWorker` in `apps/web/src/pwa/lifecycle.ts` waits for the
  `load` event of the document before it registers. A document that is already
  complete registers at once.
- `apps/web/src/pwa/service-worker.ts` calls no `clients.claim()`. The worker
  controls the next navigation, which is where an offline launch starts.
- `precacheShell` fetches at most `precacheConcurrency` entries at one time.
  The value is half of the six connections that a browser opens to one host, so
  the page keeps a share of them.

This refines [0013](0013-delivery-and-headers-belong-to-the-app.md), which
gives the worker the shell precache. It excludes a retry around a dynamic
import, a claim of a document that the worker did not serve, and a precache
that asks for the whole manifest at once.

## Consequences

The first document of a browser is never controlled, so it reads every module
from the network and no worker decides its outcome. An offline launch needs one
navigation after the install, which `tests/e2e/offline.spec.ts` already
performs and asserts.

The install of the worker finishes later, because it starts after `load` and
runs three requests at a time. Nothing waits on it: the precache serves a later
launch, not this one.

`tests/e2e/direct-address.spec.ts` opens a note address in a browser that never
loaded the application and fails on a console error or a page error, which is
the failure this record removes.
