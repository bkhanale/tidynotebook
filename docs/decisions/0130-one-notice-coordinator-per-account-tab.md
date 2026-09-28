# 0130. One notice coordinator per account in the lease tab

- Status: Accepted
- Date: 2026-09-28

## Context

Record 0124 puts one account coordinator in the tab that holds the sender
lease. Today each engine of `packages/sync/src/engine.ts` takes, renews, and
releases the lease itself, so a background engine that stops releases the
lease of its siblings. Only the lease tab syncs, and it runs engines for its
open workspace and for queued work only, so a workspace that is open in
another tab is not read until that tab holds the lease.
`pullNew` in `packages/sync/src/snapshot.ts` reads one feed page per call.
[Issue 190](https://github.com/bkhanale/notesapp/issues/190) holds the work.

## Decision

- **Lease.** `packages/sync/src/lease-keeper.ts` takes, renews, and releases
  the lease of one tab on its own timer. An engine reads it through a gate and
  never releases it. A lost lease stops sending at once and closes the socket.
- **Interests.** Each tab states its open workspace on a `BroadcastChannel` of
  the account, with a heartbeat and an expiry. The lease tab runs one engine
  for its open workspace, each live interest of another tab, and each
  workspace with queued work. That set is also the subscription set.
- **Socket.** `packages/api-client/src/socket.ts` wraps PartySocket with the
  disconnected buffer off, a random minimum and maximum delay for each
  coordinator, a growth factor, and a stable uptime. The coordinator opens it
  only while the tab holds the lease and `getSyncProtocol` offers the
  subprotocol. `session_ended` and `malformed` stop reconnects until the
  session is verified again or the page reloads.
- **Wakes.** An accepted set wakes every engine of the set, a notice wakes its
  engine, and `reconcile` or `refused` wakes all. A wake only requests a pass.
  A pass reads feed pages until a page is empty, with a bound on the pages of
  one turn, so one wake drains a backlog. Only an applied page moves the
  cursor.
- **Safety reads.** With an accepted set, an engine reads on a long jittered
  interval. Without one, it reads on the poll interval, as before.
- **Fallback.** An old server, an empty offer, a refused upgrade, and a closed
  socket leave the engines on the poll interval. A local checkpoint wakes its
  engine with or without a socket.

This excludes a service worker socket, a socket per engine, and a notice that
changes local state.

## Consequences

Driven-clock unit tests in `packages/sync` prove the lease keeper, the
coordinator, the interest table and the drain. Engine tests prove that a
notice moves no cursor. `tests/integration/offline-lifecycle.test.ts` proves a
multi-page backlog and a pending draft with a real store and server.
