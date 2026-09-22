# 0077. Yjs behind one package

- Status: Superseded by [0082](0082-yjs-has-a-byte-api-and-a-private-editor-bridge.md)
- Date: 2026-09-21

## Context

Record 0076 makes the text of a note a CRDT document. The server and the
browser must apply the same code. `packages/core` imports nothing (record
0018), and the first load stays small (record 0044). Automerge and Loro are
WebAssembly modules. The Automerge binding brings its own network layer. See
[design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

- The library is Yjs, on its stable major line.
- A new package, `packages/note-document`, is the only module that imports
  Yjs. It holds pure functions over bytes: start a document from text, apply
  an update, compute the update since a state vector, read the text, read the
  state vector, compare two state vectors, and replay text work (record 0080).
  It names every bound in one exported constant.
- A document opens with a new client identity in each session and each tab,
  which is the default of Yjs. No code sets a client identity.
- `packages/core` declares the server half of that set as a port in
  `src/files/ports.ts`. `apps/server` wires the package into it, so `core`
  keeps no dependency.
- `packages/sync`, `packages/storage-browser` and `packages/editor` import the
  package. `packages/editor` joins it to CodeMirror with the Yjs CodeMirror
  binding and the Yjs undo manager, which replaces the CodeMirror history in
  the note editor. The keys and `shortcuts` of `src/keymaps.ts` stay.
- No other package imports Yjs or the binding. `tools/check-boundaries.mjs`
  refuses it.

This refines record 0018. It excludes Automerge, Loro, and a second CRDT.

## Consequences

- A move to the next major line of Yjs changes this package and the binding.
- The package has a property test: random concurrent edits, delivered in random
  orders and repeated, reach one text.
- `packages/editor` proves with a headless state that a remote update keeps the
  selection and that undo reverses local edits only.
