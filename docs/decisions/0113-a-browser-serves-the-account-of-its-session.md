# 0113. A browser serves the account of its session

- Status: Accepted
- Date: 2026-09-26

## Context

`verifyOnce` in `packages/sync/src/engine.ts` reads the account of the session
and accepts any answer. One browser profile holds one session cookie. When a
second person signs in in another tab, the engine of the first person sends its
queue with the cookie of the second. The server refuses, the engine reads lost
access, and the work goes to recovery. A session that expires with no sign-out
also leaves the private data of its account in the browser store. See
[design 015](../design/015-several-accounts-on-one-installation.md).

## Decision

The session check compares the account of the session with the account of the
engine. When they differ, the engine pauses. It keeps its queue where it is,
sends nothing, and states that another account signed in on this browser.

When an account signs in, the client deletes the private data of every other
account of that origin that holds no queued work and no recovery record. A
partition with such work stays, out of view, until its own account signs in or
signs out.

One browser profile serves one signed-in account at a time. Several accounts
signed in at once stay out.

## Consequences

- The work of a person never moves to recovery because another person signed
  in.
- A shared device keeps less private data at rest. The cost is a full download
  when an absent account signs in again.
- A unit test in `packages/sync` proves the pause and the kept queue, and it
  fails before the fix. A unit test of the local store proves which partitions
  the sign-in deletes.
