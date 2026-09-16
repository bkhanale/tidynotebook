# 008: Published read-only links

Status: complete

This design states how a person publishes one note or one folder to a reader
who has no account. It answers the row "Publish a read-only link to a note or a
folder" on the
[GitHub project board](https://github.com/users/bkhanale/projects/2).

## The problem

Every operation that serves workspace data starts at `requireActor` in
`apps/server/src/auth/actor.ts`. The route files `files.ts`, `history.ts`,
`search.ts`, `sync.ts`, `attachments.ts`, `export.ts`, `accounts.ts` and
`workspaces.ts` under `apps/server/src/routes/` all call it. The root security
block of `packages/api-contract/openapi.yaml` names the session scheme for
every operation, and only the service probes and the first-run setup opt out of
it. A person therefore has no way to show a note to somebody who does not sign
in. The person copies the text out, or exports a file, and the note stops being
the source.

The product needs one link. The link opens one note, or one folder and
everything below it. A reader opens the link and reads. A reader never writes.

## What the code forces

Five facts in the repository decide most of this design.

**A verified actor cannot be built by hand.**
`packages/core/src/identity/actor.ts` marks an `Actor` with a unique symbol.
Only `verifyActor` sets the mark, and the package entry does not export the
symbol. `tools/actor-brand/fixture.ts` proves that rule at compile time. Every
write use case of `packages/core` takes an `Actor`.

**Every workspace read runs under a database identity.** `runTransaction` in
`packages/storage-server/src/workspace-store/transaction.ts` takes an `Actor`,
sets the account of the transaction, and takes the workspace lock. The
row-level policies of `packages/storage-server/migrations/0000_initial.sql`
read that setting through the membership tables. A transaction that sets no
account sees no row.

**The contract decides which request meets the identity hook.**
`registerOperations` in `apps/server/src/plugins/register.ts` calls the
identity resolver only for an operation that declares a security requirement.
An operation that declares an empty requirement never reaches the resolver. A
handler of such an operation that calls `requireActor` finds nothing and
refuses.

**One sanitized renderer exists, and today it has no user.** `renderMarkdown`
in `packages/markdown/src/render.ts` drops raw HTML, applies the URL policy of
`packages/markdown/src/policy.ts`, and sanitizes with the shared schema.
Decision 0003 gave that renderer a surface that a person saw. Decision 0025
supersedes 0003, removes the surface, and keeps the renderer as the oracle of
the equivalence gate and for a reader that needs HTML. Record 0025 names a
future share page as one such reader. Record 0025 governs today. A search of
the source finds only tests that call `renderMarkdown`, so the published link
becomes its first production reader.

**The server has no rate limit.** `apps/server/src/plugins/` holds no such
plugin, although decision 0018 names one in the target structure. A password on
a link is a guessing target, so this gap is now on the critical path.

## The options for the reader path

**Option A. Mint a scoped actor for the link.** The server reads the link,
finds the account that owns it, and builds an `Actor` that carries only the
read action. Every existing read use case and every existing repository then
works with no change. The cost is high. An unauthenticated request now produces
a verified actor, so the one rule that keeps user input away from the domain is
opened to a stranger. A write use case still accepts that actor at compile
time, and only the run-time role check refuses the call. The guarantee moves
from the type system to a run-time branch, and no check proves that the branch
is still there next year.

**Option B. A closed read-only path beside the account path.**
`packages/core` gets its own publication context with its own port. The port
declares read methods only. The use cases take a resolved publication, not an
`Actor`. `packages/storage-server` gets a publication repository and a unit of
work that sets the owner account of the link, marks the transaction read only,
and reads nothing outside the scope of the link. `apps/server` gets one route
file whose handlers never import `requireActor`. The cost is duplication: a
second unit of work, a second read path for a note, and a second listing query.
That duplication is the price of a guarantee that the compiler holds.

**Option C. Copy the published note into a separate public table.** The
publish action writes a snapshot that the reader path serves. The reader path
then touches no workspace table at all, which is the strongest isolation of the
three. The cost is a second copy of the note. The copy goes stale on every
save, so the product must either republish on every save or tell the person
that a link shows an old version. Both answers are worse than the problem.

This design takes Option B. Option A is cheap and wrong, because it trades a
compile-time guarantee for a run-time branch. Option C is safe and wrong,
because it breaks the promise that a link shows the current note.

## How the code makes a write impossible

Option B stacks four independent refusals. The design states them plainly,
because "no write handler exists" is not a guarantee on its own.

1. **The contract.** The published operations declare an empty security
   requirement, so `registerOperations` never runs the identity hook for them.
   No published operation describes a request body that a write use case could
   read.
2. **The type.** A published handler holds no `Actor` and cannot build one, so
   a call to a write use case does not compile. This is the rule that
   `tools/actor-brand/fixture.ts` already holds.
3. **The port.** The publication port of `packages/core` declares read methods
   only. There is no write method to call.
4. **The database.** The publication unit of work marks its transaction read
   only, so PostgreSQL refuses a write even when every layer above it fails.

## The token

The link carries an opaque random token. The token is not the note identifier
and not the folder path. A reader who holds one token learns nothing about
another note, and an identifier that leaks elsewhere does not become a link.

The server stores only a hash of the token. A person who reads the database
gets the hash and cannot rebuild the link. The token is shown once, in the URL
that the owner copies, and the product never shows it again.

The token hash uses a fast digest, not the slow password hasher. Two reasons
force that. The token already holds full random entropy, so a slow function
adds no strength against a guess. And the lookup needs an index on the hash, so
one read finds the row instead of a scan over every link.

## The password

The password on a link is optional and belongs to that one link. The product
reuses the hasher of the account path. `apps/server/src/cli/recover-account.ts`
reaches that hasher through the Better Auth context, as `context.password`, and
`apps/server/src/auth/better-auth.ts` states that the library owns password
hashing for this deployment. A second scheme would mean two password policies
and two upgrade paths, so the design refuses one.

`packages/core` cannot import the library, so the hasher reaches the domain as
a port. `apps/server` supplies the adapter over the Better Auth context. The
cost is a dependency on a surface of that library that its release notes may
not treat as public. An integration test that hashes and verifies through the
adapter turns a library move into a failed build instead of a broken link.

A wrong password answers the same refusal as a link that does not exist. The
answer names no note, no folder, and no owner. Otherwise a stranger could walk
tokens and learn which ones are real.

The reader does not send the password on every request. A repeated slow hash is
a cheap way to exhaust the server. The unlock operation answers with a reading
ticket that is bound to that one link and lives for 12 hours. Reading does not
refresh it. A reader who returns the next day gives the password again. A fixed
life keeps the ticket a short credential and needs no sliding expiry, so there
is no clock to get wrong and no way for a ticket to outlive the password.

The reader page holds the ticket for the session and sends it with each
published call. The server stores only a hash of the ticket, as it does for the
token. No cookie is set, so the reader path gains no ambient authority and no
cross-site risk.

## The scope

A link names one note, or one folder. A folder link serves that folder and
every note below it. Nothing else is reachable.

A folder is a part of a note path, not a stored record. Decision 0005 states
that, and design 007 confirms it. So the scope of a folder link is a path
prefix inside one workspace. The scope check belongs in the SQL of the
publication repository, not in a caller, because a caller can forget it. One
query answers "the notes of this publication" and every published read starts
from it.

The reader path still sets the owner account on the transaction, so the
row-level policies keep the read inside the right workspace. The design accepts
that the database no longer bounds the reader inside the workspace, and it puts
that bound in one query instead. The alternative is a new row-level policy that
evaluates a path prefix on every row of every workspace table. That policy runs
on the account path too, where it buys nothing, and it makes every listing
slower. The integration test of the scope is the guard, in the shape of the
existing `tests/integration/row-access.test.ts`.

A note that is in the Trash is not in scope. A deleted note is not in scope.

A folder link lists the notes below it. The owner chose to publish that folder,
so the names in it are published too. A link that hides its own contents is not
useful, because a reader cannot find the second note. The cost is plain:
publishing a folder publishes every note name below it, now and later. The
create dialog states that before the person confirms.

A workspace holds at most 200 published links. The limit is one named constant
beside the publication use cases, in the style that `maxFilesPerChangeset` in
`packages/core/src/files/commit.ts` and `maxOpenSnapshots` in
`packages/core/src/files/snapshot.ts` already use. The limit bounds the damage
of a client defect that publishes in a loop.

## A link inside a published note

A published note can link to another note. The rule follows the scope. A link
to a note inside the same scope resolves, and it keeps the reader on the
published path. A link to a note outside the scope does not resolve.

An unresolved link renders as plain text, not as a dead address into the
private application. This matters twice. A dead address would tell a stranger
that a private note exists. It would also invite that stranger to a sign-in
screen, which a published page must never do.

The renderer already behaves this way. `applyUrlPolicy` in
`packages/markdown/src/render.ts` replaces a blocked destination with a span
that keeps the visible text, so the reader still sees what the author wrote.
The published path only needs a note resolver beside the existing
`attachmentHref` option, which answers with an address for an in-scope note and
with nothing for any other note.

## What a reader sees

**Option 1. The server renders the page.** A published operation answers with
`text/html` from `renderMarkdown`. The media table `mediaTypeHandling` in
`apps/server/src/plugins/register.ts` already holds a row for that media type,
and its comment says that no operation returns one yet and that a later task
adds the size, access and caching checks there. This option needs a small
document shell and a stylesheet, and it gives the reader no theme switch and no
outline. It ships no application code to a stranger.

**Option 2. The web application serves a reader route.** A route under
`apps/web/src/features/` mounts the live preview of `packages/editor` in its
read-only mode, which `setEditorReadOnly` already supports. The reader then
sees the exact surface that the author sees, with the theme and the layout of
the product. The cost is that a stranger downloads the editor, the sync stack
and the session provider to read one page, and every defect in that code
becomes reachable without an account.

**Option 3. The web application injects rendered HTML.** This is refused.
`apps/web/AGENTS.md` bans `innerHTML` outside the sandboxed diagram frame, and
`tools/check-design-rules.mjs` holds that ban.

This design takes Option 1. It keeps the anonymous surface small, it uses the
`text/html` hook that `register.ts` already documents, and it gives
`renderMarkdown` the production reader that record 0025 named. The equivalence
gate `tests/integration/markdown-equivalence.test.ts` already proves that this
renderer and the live preview agree, so the reader sees what the author sees.

A Mermaid fence stays a placeholder with its source, because the diagram frame
belongs to the application shell. Math needs the KaTeX stylesheet on the
published page. Both are stated costs, not defects.

The published page uses the built application stylesheet, and nothing else. One
stylesheet means the published page cannot drift from the theme. A second small
stylesheet is refused, because it would drift on the first theme change that
nobody copies across.

The server must therefore resolve the hashed name of that stylesheet. There is
no build manifest to read: `apps/web/vite.config.ts` emits none, and
`apps/server/src/app.ts` resolves a request against the built directory by name
and falls back to the shell document. The server does already read the built
shell document. `documentContentPolicy` in
`apps/server/src/plugins/static-assets.ts` reads it to hash its inline scripts,
and it caches the result by the modification time of the file. The published
page reads the stylesheet link of that same document, through the same cache.
The alternative is to turn on the build manifest in `apps/web/vite.config.ts`
and read that instead. It is cleaner and it changes the build, so the
implementation wave decides it. Either way there is one stylesheet.

## An attachment inside a shared note

A note names an image as an attachment path, which `classifyUrl` in
`packages/markdown/src/policy.ts` recognises. `renderMarkdown` accepts an
`attachmentHref` option that maps an attachment revision to a transport path.
The published page uses that option to point each image at a published
attachment address that carries the link token and the note.

The rule that bounds an attachment is this: **the server serves an attachment
only when the note that names it is inside the scope of the link, and the
current content of that note references that attachment revision.** The address
therefore carries the token, the note, and the revision, and the server proves
all three facts on every request. It does not trust the address.

The alternative is a signed address that carries its own permission. That needs
no second read, but it adds a new signed value, a new secret use, and a new
expiry to get right. The rule above needs one note read, which the reader has
just done anyway.

An attachment is a file with its own path, so a path prefix does not put it in
the scope of a folder link. The reference rule is what puts it in scope, and it
is the same rule for a note link and for a folder link.

## Revocation and expiry

A link is revocable. Revocation is immediate, because the server reads the link
row on every published request and refuses at once when the row is revoked.
There is no cache to wait for and no token to outlive.

A link carries an optional expiry. An expired link answers the same refusal as
a link that does not exist. The check is a comparison in the domain, so one
test proves it and no clock skew in a cache can widen it.

Every refusal fails closed. A missing row, a revoked row, an expired row, a
wrong password, a note outside the scope, and an attachment that no in-scope
note references all give the same answer.

## What this excludes

There is no reader account, now or later. There is no comment, no reaction, no
suggestion, and no edit. A link is publication, not collaboration. The reader
path serves one HTML page and the images inside it, and nothing else.

The product does not publish the History of a note, the Trash, the search
index, or an export. Those are account operations and they stay on the account
path.

## Risks

**The server has no rate limit.** `apps/server/src/plugins/` holds no such
plugin, although decision 0018 names one in the target structure. A password on
a link invites guessing, and a token space invites walking. This work does not
design a second throttle. The board row "Rate limit the setup and the
authentication routes" owns that plugin and is already in progress. The
published password reuses it and ships only after it exists. The link itself,
with no password, does not wait.

**The Better Auth hasher is reached through its context.** A library release
can move that surface. The adapter test turns that move into a build failure.

**A published page is cached by somebody else.** A link that a person shares in
a chat is fetched by a preview bot. The published answers must state that they
are private and must not be stored by a shared cache.

**A folder link is a wide door.** A person who publishes a folder publishes
every note that later lands in it. The product must say so where the link is
made.

## The questions and their answers

Six questions were open when this design was written. The owner closed all six.
Each answer is recorded here with the reason, so no item of the plan waits.

1. **How long does a reading ticket live, and does reading refresh it?** It
   lives 12 hours, and reading does not refresh it. A reader who returns later
   gives the password again. A fixed life keeps the ticket a short credential
   and needs no sliding expiry.
2. **Does the owner see how many times a link was opened?** No. The product
   shows no reader count and keeps no per-reader record. This is publication,
   not analytics, and a reader did not agree to be counted. Record 0031 states
   this as a refusal, so a later task does not add it by accident.
3. **Does a folder link list the notes below it?** Yes. The owner chose to
   publish the folder, so the names in it are published too. A link that hides
   its own contents is not useful. The create dialog says that a folder link
   publishes every note name below it, before the person confirms.
4. **Does a link inside a published note keep the reader on the published
   path?** A link to a note inside the same scope resolves and keeps the reader
   on the published path. A link outside the scope does not resolve, and it
   renders as plain text. A dead address would disclose a private note and
   would invite a stranger to a sign-in screen.
5. **Where does the published page get its stylesheet?** It uses the built
   application stylesheet, and no other. A second stylesheet is refused. The
   server resolves the hashed name, and the section above states how, because
   the build emits no manifest today.
6. **How many links may one workspace hold, and is an expired row removed?** A
   workspace holds at most 200 links, as one named constant beside the
   publication use cases. An expired or revoked row is removed by the hourly
   cleanup that `apps/server/src/app.ts` already runs over
   `apps/server/src/jobs/sync-cleanup.ts` and
   `apps/server/src/jobs/attachment-cleanup.ts`. No second scheduler is added.

One correction belongs with answer 6. The owner asked for the sweep that
expires the Trash. There is no such sweep. Record 0023 planned an auto-expiring
Trash, and record 0026 supersedes it and states that Trash gains no auto-purge,
because a purge on a timer is irreversible deletion. The hourly cleanup above is
the one existing sweep, and it is the one this work extends.

## Decisions

- [0030. A published link is a hashed token over a read-only scope](../decisions/0030-published-links-are-hashed-tokens-over-a-scope.md)
- [0031. The reader path is a closed read-only boundary](../decisions/0031-the-reader-path-is-a-closed-read-only-boundary.md)
- [0046. The reader carries its credentials in the address](../decisions/0046-the-reader-carries-its-credentials-in-the-address.md)
- Kept: [0025. The live preview is the one note surface](../decisions/0025-the-live-preview-is-the-one-note-surface.md)
- Kept: [0018. The directory structure follows ports and adapters](../decisions/0018-directory-structure-by-layer.md)
- Kept: [0019. One contract, generated types, and no type assertions](../decisions/0019-contract-validation-and-shared-types.md)
