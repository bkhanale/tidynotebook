# Architecture

NotesApp is a self-hosted Markdown notes application for one person. A note is
a Markdown file with one `.md` suffix. Typing writes a draft on the device.
Save creates one immutable version on the server. Nothing is stored that
cannot be exported as plain Markdown files.

This document is the one current picture of the system. Each section links to
the detailed guide instead of repeating it.

## Apps and packages

| Path                       | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `apps/web`                 | React web application, router, service worker, note screens   |
| `apps/server`              | Fastify HTTP adapter, authentication, static delivery, jobs   |
| `packages/core`            | Domain rules: files, revision graph, history, search, actors  |
| `packages/api-contract`    | OpenAPI source contract, operation list, request validators   |
| `packages/api-client`      | Generated typed client and its one handwritten configuration  |
| `packages/markdown`        | remark parse and render, sanitizer, URL policy, parse limits  |
| `packages/editor`          | CodeMirror editor, live preview, widgets, commands, diff      |
| `packages/storage-browser` | Dexie schema and IndexedDB transactions                       |
| `packages/storage-server`  | PostgreSQL stores, migrations, attachment bytes, provisioning |
| `packages/sync`            | Save queue, lease, snapshot download, local search            |
| `packages/ui`              | Shared controls, icons, and the runtime theme                 |
| `tools/sdk-codegen`        | Contract lint and client generation                           |

`apps/server` serves the built web application, the REST API and the
authentication routes on one origin. There is no second service.

## The save model

Four records hold the text, and they stay separate. See
[Local drafts and explicit saves](local-storage.md) and
[Files and versions](files-and-revisions.md) for the record shapes.

| Record         | Where                 | Meaning                                 |
| -------------- | --------------------- | --------------------------------------- |
| Draft          | IndexedDB, mutable    | The text on this device right now       |
| Local version  | IndexedDB, immutable  | What the person selected Save on        |
| Queue entry    | IndexedDB             | One save that waits to reach the server |
| Server version | PostgreSQL, immutable | The accepted history of the note        |

```text
Typing        -> coalesced draft write, about 120 ms after the last keystroke
Save          -> local version + queue entry, in one IndexedDB transaction
Sync engine   -> generated client -> Fastify -> PostgreSQL version history
```

Typing never creates a version. Save never needs a connection. The sync engine
sends queue entries in local order with a frozen body and digest, so a retry
repeats the same mutation.

### Rebase rules

A save states the head that its author saw. The server compares that
precondition with the current head and answers in one of four ways.

| Situation                            | Result                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| The head did not move                | The save is accepted as sent.                                       |
| The head moved, same note, no delete | The save is rebased on the current head and reported as superseded. |
| The head moved across a delete       | Refused with `stale_head`. The client refreshes.                    |
| A stale delete against newer text    | Refused. The note stays.                                            |

A rebased save keeps its own path when it renamed the note, and takes the
current path when it did not. So a save cannot undo a rename it never saw.

**Superseded notice.** When the head moved, the answer names the head that the
save passed and the revision that is now accepted. The application tells the
person that their save is the latest version and that the text from the other
device is kept in History. There is no conflict screen and no branch. History
stays one line.

**Stale draft.** A draft written over an older accepted head is detected when
the note opens. The person chooses. Taking the latest version copies the older
text into the recovery area first, so nothing is lost.

**Needs attention.** A save that the server refuses for good is parked in the
recovery area and listed on the Needs attention screen, which the save state
chip links to. Each row offers Retry, Save as new note, Copy text and Discard.

**Trash.** Delete moves the note to Trash. Trash lists the deleted notes with
Restore and Delete permanently. Delete permanently calls the purge operation,
which also releases the attachment bytes that no live revision references.

The note screen exposes its state as `data-save-state` on the editor element.
The values come from `apps/web/src/features/save-state.ts`: `saving-local`,
`saved-local`, `syncing`, `saved-server`, `storage-full`, `save-failed`. Only
the last two show a message, because routine local persistence stays quiet.

## Boundaries

`tools/check-boundaries.mjs` runs inside `pnpm lint` and fails the build. It
parses every source file and enforces these rules. The durable detail is in
[Toolchain](toolchain.md).

- **Dependency direction.** Each package declares which workspace packages it
  may use. `core` may use nothing. `markdown` may use `core`. `editor` may use
  `core`, `markdown` and `ui`. `sync` may use `core` and `api-client`.
  `storage-browser` may use `core` and `sync`. `storage-server` may use `core`
  and `markdown`. `apps/web` and `apps/server` sit on top. The graph is
  acyclic.
- **Browser safety.** A package that runs in the browser cannot import a Node
  built-in module, a Node-only package, or a server-only package. `core` is in
  that set, so domain code cannot reach transport, database, browser or React
  code.
- **One public entry.** Every package exposes only `exports["."]`. A deep
  import and a `#` subpath alias both fail.
- **Generated transport only.** `fetch`, `XMLHttpRequest`, `WebSocket`,
  `EventSource` and every HTTP library are refused outside the generated
  client. Feature code calls a generated operation.
- **Declared dependencies.** An import of a package that the manifest does not
  declare fails, and a type-only import may resolve through `@types/`.
- **Test placement.** A test file lives in a package `src` tree or in the
  repository-root `tests` tree. Production source cannot import a test file.

## Data storage

PostgreSQL holds the accepted state: files, the revision graph, attachments
metadata, search index and identity. Row level security restricts every row to
its workspace, and the runtime role has no migration rights. Attachment bytes
live in a bind-mounted directory, content addressed by digest.

The schema is created by one migration in
`packages/storage-server/migrations/`. The container entry point applies the
migrations with the migration role before the server starts with the
restricted runtime role, so a container that serves without its migrations
never reports ready. See [Database](database.md),
[Identity](identity.md) and [Self-hosting](../guide/self-hosting.md).

The browser holds working state in IndexedDB through Dexie: drafts, local
versions, the queue, the recovery area and the offline snapshot. Local browser
data is a working copy, not a backup.

## One Markdown grammar

The editor and the reader must never disagree about what a document means.

- `packages/markdown` is the only definition of the language: remark with
  CommonMark and GFM, plus math, a sanitizer and a URL policy. `renderMarkdown`
  produces the Read mode output and the server-side index.
- `packages/editor` keeps the Markdown source as the CodeMirror document and
  decorates it. It reads the Lezer Markdown syntax tree that CodeMirror already
  parses through `syntaxTree(state)`. The outline reads the same tree. There is
  no second scanner.
- Widgets appear only where text cannot express the result: images, Mermaid
  diagrams and display math. Tables stay editable text. A widget opens as
  source when the cursor or the selection touches it.
- One corpus document in `packages/markdown/test-data/content.ts` is rendered
  through both paths in a test, and the two results must agree on structure. A
  change that moves one path away from the other fails that test.

> In progress: the live preview of `packages/editor` still scans the source
> with regular expressions, and the corpus equivalence test is not written
> yet. The rule above is the target that the current work moves to.

## Contract and generation

`packages/api-contract/openapi.yaml` is the source. `pnpm generate` writes the
typed client and the contract index; `pnpm generated:check` fails when the
committed output does not match the contract. Every request and response is
validated against the contract at the HTTP boundary. See
[API contract](api-contract.md) and [API](api.md).

## Verification

`pnpm verify` runs contract lint, generated comparison, typecheck, lint,
format, unit tests, integration tests against PostgreSQL, and all builds.
`pnpm test:e2e` runs the Playwright matrix, which is the gate for the user
interface. See [Verification](verification.md) and `CONTRIBUTING.md`.
