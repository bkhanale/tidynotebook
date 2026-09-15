# 0038. An empty state names what is missing, and a failed read names the failure

- Status: Accepted
- Date: 2026-09-16

## Context

`apps/web/src/features/editor/backlinks.tsx` catches every failure of its read
into an empty list and then renders "No notes link here." A refused read, a
timeout, and no connection all produce the sentence that belongs to a note with
no inbound links. `apps/web/src/features/editor/outline.tsx`,
`apps/web/src/features/history/history.tsx`, and
`apps/web/src/features/accounts/accounts.tsx` take the same shape.

The root `AGENTS.md` states that a message gives one cause and that an empty
state names what is missing. `useOnline` in
`apps/web/src/features/editor/save-status.tsx` already reports the connection,
and `apps/web/src/shell/files.tsx` and `apps/web/src/features/trash/trash.tsx`
already keep local rows when a server read fails. See
[design 009](../design/009-backlinks-on-standard-links.md).

## Decision

A read surface of `apps/web` holds three states, and it never folds one into
another.

- **Empty.** The read answered and there is nothing. The surface names what is
  missing and offers the action that fills it.
- **Failed.** The read did not answer. The surface says so in one sentence and
  says what the person can do next. It does not show an identifier, a status
  code, or an engine notice.
- **Partial.** The device answered and the server did not. The surface shows
  the rows it has and marks them, as `apps/web/src/shell/command-palette.tsx`
  marks an offline search.

A catch that discards the reason and sets an empty collection is refused. A
surface that can read the local store prefers a partial answer to a failed one.

This excludes a stacked pair of a general message and a detailed message for
one failure, a retry that hides the failure, a spinner that never ends, and a
second offline hook beside `useOnline`.

## Consequences

- Backlinks, the outline of a note that is not open, History, and Accounts each
  gain a failed state. Backlinks and the outline gain a partial state, because
  the device holds the body already.
- The browser matrix gains a journey with the network down. It proves that a
  note with inbound links does not report zero, which
  [decision 0014](0014-browser-tests-are-the-interface-gate.md) makes the gate
  of the interface.
- The rewrite refusal of `expandMovedReferences` above 1,000 files follows the
  same rule. It reports `invalid_graph` today, whose sentence in
  `apps/web/src/lib/parked-saves.ts` names the save history and not the rename,
  so it needs its own reason in `packages/core`, its own row in
  `apps/server/src/plugins/problem.ts`, and its own sentence.
- Each surface carries a little more state than a single list. That is the cost
  of telling the person what actually happened.
