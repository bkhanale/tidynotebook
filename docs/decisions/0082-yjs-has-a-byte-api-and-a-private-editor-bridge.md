# 0082. Yjs has a byte API and a private editor bridge

- Status: Accepted
- Date: 2026-09-22

## Context

The CodeMirror binding needs live Yjs text and undo state. The bytes-only
surface of record 0077 cannot supply them. Recreating a document on each edit
would also break ownership and undo. See
[design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

- `packages/note-document` owns Yjs on its stable major line. The lockfile
  selects a tested compatible editor binding. Only this package imports Yjs
  at runtime. Core receives a port through the server composition root.
- The shared byte API starts, applies, validates, encodes, and reads documents
  and complete observed states. It has no DOM or Node dependency. One set of
  bounds limits wire bytes, decoded state, structure, and recovery work.
- Browser editing uses an opaque live session with explicit open, subscribe,
  apply, encode, and destroy ownership. Each session and tab gets the default
  fresh client identity. No caller assigns a client identity.
- A private editor bridge exposes live Yjs text and undo types only to
  `packages/editor`. Only the editor imports the CodeMirror binding. No Yjs
  type enters core, sync, storage, or web feature contracts. The shared entry
  does not load CodeMirror. `tools/check-boundaries.mjs` holds these rules.
- `packages/editor/src/create-editor.ts` joins one session to one view. Local
  undo replaces CodeMirror history for that view. Origins separate local
  input, remote work, and repair. Plain History and diff editors remain valid.
- Remote updates wait before they reach the bound document during composition.
  Completion applies them through the binding. Teardown and repair release
  listeners and invalid undo references without dropping unpersisted text.

This supersedes [0077](0077-yjs-behind-one-package.md) and refines record 0018.

## Consequences

- Byte consumers stay isolated from the library. The editor has one narrow
  typed exception, with positive and negative boundary checks.
- Seeded document properties and editor state tests prove convergence,
  selection mapping, and local undo. A manual served-browser check proves
  composition and lifecycle behavior under record 0066. Headless state alone
  cannot prove browser event order.
