# packages/note-document

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

The one Yjs document of a note, behind a byte API (records 0081, 0082, 0084).
It starts, applies, validates, encodes, and reads a document, and it states
the complete observed state that decides whether work is unseen.

## What lives here and what does not

- `src/document.ts` holds the byte operations. `applyDocumentUpdate` is the
  one door for foreign work: it applies to a trial document and refuses
  malformed bytes, a missing insertion or deletion, any structure other than
  plain text in the one text root, and a result past the bounds.
- `src/observed.ts` holds complete observed state: the state vector and the
  deletion set, encoded as a Yjs snapshot. A state vector alone serves a
  delta and never decides whether work is unseen.
- `src/bounds.ts` holds the one set of resource bounds. The text limit of a
  note stays in `packages/markdown`.
- `src/editor-bridge.ts` is the private entry for `packages/editor` only.
- No storage, no transport, no React, and no CodeMirror code lives here.

## Allowed imports

No workspace package. Only `yjs` and `diff`. This package runs in the browser
and on the server, so it uses no DOM and no Node built in module.

## How to add a common thing here

- **A document operation.** Take and return bytes or text. Load a fresh
  document from bytes, so a refusal cannot change the caller's bytes.
- **A refusal.** Add the reason to `DocumentRefusal` and a test that proves the
  input bytes are unchanged after it.

## Testing conventions here

`node --test` through `pnpm test:unit`. Tests may drive Yjs directly to act as
a device. A seeded property test states its seed, so a failure repeats.

## Forbidden here

- No Yjs type in the shared entry. Only `src/editor-bridge.ts` returns one.
- No caller-assigned client identity. Each document and session takes the
  default fresh identity.
- No new document from current text to meet a size bound (record 0084).
- No normalization of line endings or Unicode.

## Key files

| File                   | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `src/index.ts`         | The byte API entry                       |
| `src/document.ts`      | Start, apply, validate, encode, and read |
| `src/observed.ts`      | Complete observed state and coverage     |
| `src/bounds.ts`        | The one set of resource bounds           |
| `src/editor-bridge.ts` | The private entry of the editor          |
