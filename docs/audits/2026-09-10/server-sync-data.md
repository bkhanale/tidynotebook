# NotesApp backend audit: server, sync, and data

Audited on 2026-09-10 against commit `40eebba`.

Read-only audit. No file in the repository was changed. Scope: everything below
the user interface. `packages/core`, `packages/sync`, `packages/storage-browser`,
`packages/storage-server`, `apps/server`, `apps/mcp-stdio`,
`packages/api-contract`, `packages/api-client`, `tools/sdk-codegen`, and
`tools/check-boundaries.mjs`. In-scope source is about 98,700 lines.

## Summary

The engineering underneath is strong. Migrations are transactional, the three
role database model is real, secrets have no fallbacks, path rules are careful,
attachment validation sniffs magic bytes, and backup and restore is tested in
CI. Package boundaries pass cleanly. Three problems block a v0.1 launch.

1. **The save model can silently drop the user's work in ordinary single-user
   situations.** A local draft shadows newer server content forever, a stale
   save overwrites the current head, a stale delete removes newer edits, and a
   permanently refused save is parked in IndexedDB behind one passing banner.
   There is no trash, so a lost note is unrecoverable from the interface.
2. **The default deployment is not safe.** `docker-compose.yml` ships the
   author's own LAN address as the origin, binds `0.0.0.0`, serves `/metrics`
   with no authentication, and mounts an OAuth authorize endpoint that issues a
   full-scope code with no consent step to a `test-client` that redirects off
   origin.
3. **The codebase is about three times the size the product needs.** 55,000 of
   the 98,700 in-scope lines are generated artifacts, 77 percent of the API
   contract index is one duplicated error schema, and 8 database tables plus
   large parts of `core`, `storage-server`, and the test suite serve removed
   multi-user features.

## Findings

Severity: P0 blocks launch. P1 must fix for v0.1. P2 should fix. P3 later.

### Save, sync, and local storage

| ID    | Sev | Area            | Finding                                                                                                                                                                                                                                                                                                                                             | Location                                                                                                                           | Fix                                                                                                                                                       |
| ----- | --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-01 | P0  | storage-browser | A local draft shadows newer server content forever. `readCachedNote` always returns the newest draft row and never compares it with the accepted head. Drafts are removed only by `clearPrivateData`. After one keystroke in a note, that device shows its own text for good.                                                                       | `packages/storage-browser/src/local-store.ts:1532`, deletion only at `:311`, opened at `apps/web/src/features/note-editor.tsx:860` | Compare `draft.baseRevisionId` with `acceptedHeadRevisionId` on open. Drop a draft whose digest equals the accepted head. Show a stale banner otherwise.  |
| BE-02 | P0  | sync + core     | A stale save silently replaces the head content. The rebase reparents the revision and keeps the client's text, so the other device's accepted versions leave the head with no signal.                                                                                                                                                              | `packages/core/src/files/commit.ts:155-163`                                                                                        | Keep the rebase, but when the parent moved, return the superseded revision id in the answer and let the client show "your other device saved newer text". |
| BE-03 | P0  | core            | `heads()` returns the head of a deleted file, so the rebase resurrects a deleted note, and a stale delete removes newer edits from the tree. Neither case is checked.                                                                                                                                                                               | `packages/storage-server/src/workspace-store.ts:783-803`, used at `packages/core/src/files/commit.ts:148`                          | Refuse a rebase across a deletion boundary with `stale_head`, or require the client to confirm.                                                           |
| BE-04 | P0  | sync            | A permanently refused save is parked forever. Anything that is not 401, 403, 404 or 413 becomes `conflict`, and `pushQueue` then filters conflict entries out for good. The only signal is one transient message that names a mutation UUID. Nothing writes the text into the recovery area, and `listLocalConflicts` has no caller in the web app. | `packages/sync/src/queue.ts:201-206`, `:380`, `:250`; message at `apps/web/src/app.tsx:363`                                        | Write the text into the recovery area, list parked saves in the interface, and allow an explicit retry or a save as a new note.                           |
| BE-05 | P1  | core            | `renameFolderChangeset` carries the member content the client last read. After a rebase the rename revision writes that stale content over each current head, so a folder rename can revert every note in it.                                                                                                                                       | `packages/core/src/files/operations.ts:302-372`                                                                                    | Make a rename a metadata-only revision, or refuse a folder rebase and answer `stale_head`.                                                                |
| BE-06 | P1  | core            | A stale save keeps `revision.path`, so it silently reverts a rename. When the old path is taken it raises the deferred unique index and answers 409 `path_conflict`, which lands in BE-04.                                                                                                                                                          | `packages/core/src/files/commit.ts:156-163`, `packages/storage-server/migrations/0001_row_access.sql:195`                          | Take the path from the current head during a rebase unless the client changed it in this save.                                                            |
| BE-07 | P1  | storage-browser | `applyRemoteChanges` and `activateSnapshot` treat only `localHead !== acceptedHead` as dirty. A note with an uncheckpointed draft is not dirty, so the local head is overwritten while the draft keeps shadowing it, which is the mechanism behind BE-01.                                                                                           | `local-store.ts:2195-2198`, `:2087-2090`                                                                                           | Include "has a draft that differs from the accepted head" in the dirty test.                                                                              |
| BE-08 | P1  | sync            | First sync fetches one revision per note, serially, one HTTP request each. There is no bulk revision read in the contract. A 10,000 note workspace needs 10,000 round trips.                                                                                                                                                                        | `packages/sync/src/snapshot.ts:202-225`                                                                                            | Add a bulk revision read, or return content in the snapshot page.                                                                                         |
| BE-09 | P1  | storage-browser | The IndexedDB migration revalidation loads every row of every table, including every content body, inside one transaction over all 14 stores. It runs on any version bump.                                                                                                                                                                          | `packages/storage-browser/src/migrations.ts:472-489`, `:568`                                                                       | Validate lazily on read, or revalidate in bounded chunks.                                                                                                 |
| BE-10 | P2  | storage-browser | Local growth is unbounded. `contents` and `checkpoints` rows are removed only by `clearPrivateData`, so every version of every note is kept in the browser forever until quota fails.                                                                                                                                                               | `local-store.ts:321-340`                                                                                                           | Keep the accepted head plus the pending chain. Drop older local content.                                                                                  |
| BE-11 | P2  | sync            | `pushQueue` submits at most one batch or one entry per cycle, then waits the 15 second poll. A queue of entries that already reached `sending` drains at one per 15 seconds.                                                                                                                                                                        | `packages/sync/src/queue.ts:242-259`, `packages/sync/src/engine.ts:233`                                                            | Loop until the queue is empty or a failure occurs.                                                                                                        |
| BE-12 | P2  | sync + web      | Every Save press writes a version. The editor always passes the message `Manual save`, and `shouldCheckpoint` returns true for any non-empty message. History fills with identical entries and the quota grows.                                                                                                                                     | `apps/web/src/features/note-editor.tsx:319-322`, `packages/sync/src/checkpoints.ts:93`                                             | Pass `null` unless the user named the version. Suppress an unchanged save.                                                                                |
| BE-13 | P2  | storage-browser | `checkpoint()` does not refuse a draft older than the stored one, so a caller that passes a stale buffer commits older text as an immutable version.                                                                                                                                                                                                | `local-store.ts:558-742`                                                                                                           | Compare `draft.sequence` with the stored sequence and refuse a lower one.                                                                                 |
| BE-14 | P2  | storage-browser | Full table scans in hot paths. `listSearchFiles` reads every note body into memory per call, `listLocalFiles` and `clearPrivateData` scan every table across all partitions, and `readFileSaveSnapshot` reads the whole queue on every editor refresh.                                                                                              | `local-store.ts:1660`, `:1085`, `:311`, `:1163`                                                                                    | Use the partition ranges that the schema already provides, and index the queue by file.                                                                   |
| BE-15 | P2  | core            | `restoreRevision` answers 412 `stale_head` while `commitChangeset` rebases. A restore fails whenever the local head is a poll behind, and the two write paths disagree.                                                                                                                                                                             | `packages/core/src/history/service.ts:570`                                                                                         | Rebase the restore, or refresh the head in the client before the call.                                                                                    |
| BE-16 | P3  | core            | `restoreRevision` and `createCheckpoint` each repeat the role, receipt, purge, head, graph and accept order by hand instead of building a changeset and calling `commitChangeset`. The invariant order now lives in three places.                                                                                                                   | `packages/core/src/history/service.ts:544-660`                                                                                     | Route both through `commitChangeset`.                                                                                                                     |
| BE-17 | P3  | sync            | The frozen request digest has no effect. The client stores it and never compares it, and the server recomputes its own from the body. `submitBatch` also leaves the batch digest on the first entry after it falls back to single sends.                                                                                                            | `packages/sync/src/queue.ts:294`, `:356`; server at `apps/server/src/http/files.ts:654`                                            | Remove the client-side digest field and the `markSending` argument.                                                                                       |
| BE-18 | P3  | sync            | `submitBatch` maps accepted revisions back to queue entries by slicing the answer at an offset. It is correct today only because the server preserves submission order, which the contract does not state.                                                                                                                                          | `packages/sync/src/queue.ts:301-316`, `packages/storage-server/src/workspace-store.ts:2068`                                        | Match by revision id instead of by position.                                                                                                              |
| BE-19 | P3  | storage-browser | `isBlockedUpgradeError` branches on substrings of an error message.                                                                                                                                                                                                                                                                                 | `packages/storage-browser/src/migrations.ts:589-601`                                                                               | Add a typed reason field to `LocalStorageError`.                                                                                                          |
| BE-20 | P3  | sync            | Dead viewer-downgrade logic. The engine still probes for a role downgrade, suspends writes, and announces `role-downgraded` and `writes-resumed`, which cannot happen with one owner.                                                                                                                                                               | `packages/sync/src/engine.ts:369-396`, notices at `packages/sync/src/queue.ts:74-75`                                               | Delete the branch and both notices.                                                                                                                       |

### Server, authentication, and routes

| ID    | Sev | Area           | Finding                                                                                                                                                                                                                                                                                                                                                                       | Location                                                                                                                          | Fix                                                                                                                                                           |
| ----- | --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-21 | P0  | apps/server    | `GET /oauth/authorize` issues a full-scope authorization code with no consent step and no CSRF protection, and a `test-client` with `https://example.com/callback` is registered in production code. `POST /oauth/token` is public, needs no client secret and has no rate limit. One cross-site navigation of a signed-in browser yields read and write on every note.       | `apps/server/src/mcp/authorization.ts:49-58`, `:243-353` (redirect at `:352`), token route at `apps/server/src/mcp/server.ts:923` | Unmount `/oauth/*` and `/mcp` for v0.1. If they stay: delete `test-client`, add a consent page behind a POST with a CSRF token, and verify the client secret. |
| BE-22 | P1  | apps/server    | `POST /api/auth/sign-in/email` returns the raw session token to page script. The strip is applied only to `/get-session`, and the contract fragment declares the field. This defeats the HttpOnly cookie and contradicts `docs/development/identity.md`.                                                                                                                      | `apps/server/src/auth/better-auth.ts:435`, `tools/sdk-codegen/src/auth-contract.ts:141-149`                                       | Strip `token` from every auth answer and remove it from the fragment.                                                                                         |
| BE-23 | P1  | apps/server    | `pnpm owner:bootstrap` checks `hasAccount()` outside the transaction and then calls the unguarded `linkAccount`, so a second account can be created. There is no database level one-account invariant.                                                                                                                                                                        | `apps/server/src/cli/bootstrap.ts:116-131`; the safe path is `packages/storage-server/src/identity-store.ts:709`                  | Call `linkFirstAccount` and fail on `null`. Add a unique constraint or a single-row guard.                                                                    |
| BE-24 | P1  | apps/server    | Unexpected 500 errors are never logged. `setErrorHandler` replaces Fastify's default logging and no `onError` hook exists, so a database failure produces only an info line with `statusCode: 500`. Production faults are undiagnosable.                                                                                                                                      | `apps/server/src/app.ts:359`                                                                                                      | Log `err` for anything that classifies as `internal_error`.                                                                                                   |
| BE-25 | P1  | apps/server    | `/metrics` has no authentication and every scrape walks the whole attachment tree with a `stat` per file. It is both an information leak and a trivial denial of service.                                                                                                                                                                                                     | route at `apps/server/src/app.ts:277-289`, walk at `apps/server/src/observability.ts:100-124`                                     | Require a credential, and read `workspace_usage.bytes_used` or cache with a TTL.                                                                              |
| BE-26 | P1  | apps/server    | No security headers anywhere. A repository-wide search finds no CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` or HSTS on any route, including attachment and single-page responses. The app renders user-authored Markdown and serves attachments from its own origin.                                                                                  | verified absent across `apps/server/src` and `apps/web/index.html`                                                                | Add a strict CSP plus `nosniff` globally, and `Content-Disposition` on attachments.                                                                           |
| BE-27 | P1  | apps/server    | `POST /api/setup` has no rate limit. It calls `auth.api.signUpEmail` directly and never passes through Better Auth's rate limit hook. Better Auth's own limits also depend on an undeclared `NODE_ENV`.                                                                                                                                                                       | `apps/server/src/auth/setup.ts:48`                                                                                                | Set `rateLimit` explicitly and add a limit to the setup and OAuth token routes.                                                                               |
| BE-28 | P1  | apps/server    | The default 5 second `requestTimeout` makes a 20 MiB attachment upload impossible. The route allows 25 MiB and the inspector then spends its own budget.                                                                                                                                                                                                                      | `apps/server/src/app.ts:186`, `docker-compose.yml:52`, cap at `apps/server/src/http/attachments.ts:42`                            | Set a per-route timeout for `uploadAttachment`.                                                                                                               |
| BE-29 | P1  | apps/server    | The write pause cannot be triggered from the product, cannot be resumed from outside the process, and bricks every write on a corrupt state file. `isPaused` stops re-reading the file once the flag is true, so deleting the file leaves the server paused until restart. An unreadable file sets `paused = true`. The 503 is retryable, so the sync engine retries forever. | `apps/server/src/write-pause.ts:48-60`, `:70-83`; hook at `apps/server/src/app.ts:226-251`                                        | Replace with a PostgreSQL advisory lock held by the backup, or delete it and document `docker compose stop app`.                                              |
| BE-30 | P1  | apps/server    | The write origin check and the host allowlist disagree. `checkWriteOrigin` compares against `config.origin` alone while the allowlist and `trustedOrigins` accept four hosts, so a user on an alternate allowed host signs in and then fails every write with no diagnostic.                                                                                                  | `apps/server/src/auth/actor.ts:240-246` versus `apps/server/src/app.ts:202-218`                                                   | Derive both from one list of served origins.                                                                                                                  |
| BE-31 | P1  | apps/server    | No security headers on attachment answers: only `content-length`, `etag` and `content-type`. SVG is blocked today, so this is defence in depth, but one addition to the allowlist becomes stored cross-site scripting on the app origin.                                                                                                                                      | `apps/server/src/http/attachments.ts:385-391`                                                                                     | Add `nosniff`, `Content-Disposition: attachment` and a restrictive CSP.                                                                                       |
| BE-32 | P2  | apps/server    | The `trustedOrigins` derivation from allowed hosts is too permissive. It synthesises `http://` for an HTTPS deployment and invents port 3000, giving 17 trusted origins with the shipped defaults including `http://localhost:3000`.                                                                                                                                          | `apps/server/src/auth/better-auth.ts:157-169` (commit f775aed)                                                                    | Trust only the configured origin, plus explicit extra origins if needed.                                                                                      |
| BE-33 | P2  | apps/server    | Setup compensation is not transactional, and `fromSession` creates an account as a fallback. Together they form a second-account path: a failed compensation leaves an orphan auth user who can sign in, and the next request silently creates account two with its own workspace.                                                                                            | `apps/server/src/auth/setup.ts:61-74`, `apps/server/src/auth/actor.ts:320-325`                                                    | Guard the compensation with try and catch, log the orphan id, and make `fromSession` answer 401 instead of creating an account.                               |
| BE-34 | P2  | apps/server    | A multipart upload with no file part never settles. `writeFinished` is resolved only inside the file handler, so the request hangs until the socket timeout, and the "Missing file in upload payload" branch is unreachable dead code.                                                                                                                                        | `apps/server/src/http/attachments.ts:163-198`                                                                                     | Rewrite with `stream/promises.pipeline` and one settled outcome.                                                                                              |
| BE-35 | P2  | apps/server    | The image inspector leaks absolute filesystem paths to the client. `execFile` error text, which names the node binary, the worker path and the temporary file, becomes the problem `detail`.                                                                                                                                                                                  | `apps/server/src/jobs/inspect-image.ts:56-64`, surfaced at `apps/server/src/http/attachments.ts:212`                              | Return a fixed message and log the detail.                                                                                                                    |
| BE-36 | P2  | apps/server    | `/ready` and `/api/ready` are unauthenticated, return full internal detail by default, and open two fresh PostgreSQL clients per call. The Compose health check polls every 10 seconds.                                                                                                                                                                                       | `apps/server/src/http/handlers.ts:88-90`, `:118-122`, `:168-172`                                                                  | Reuse the pool, cache briefly, and default to summary for anonymous callers.                                                                                  |
| BE-37 | P2  | apps/server    | OAuth tokens are not bounded to a workspace, and `authCodes` and `oauthTokens` are plain maps with no eviction. `registeredClients` is module level mutable global state.                                                                                                                                                                                                     | `apps/server/src/mcp/authorization.ts:150-151`, `:500-503`, `:62`                                                                 | Removed with BE-21.                                                                                                                                           |
| BE-38 | P2  | apps/server    | An agent token can carry `purge`, so a token minted for an agent can call `purgeFiles` and `deleteWorkspace` and destroy every note. `share` and `members` are also grantable and have no reachable operation.                                                                                                                                                                | `packages/api-contract/openapi.yaml:2055-2061`, `apps/server/src/http/accounts.ts:91-111`                                         | Restrict token scopes to `read`, `write` and `history`.                                                                                                       |
| BE-39 | P2  | apps/server    | Agent tokens can delete a workspace but not create one, and nothing protects the workspace that setup created. `notesapp_delete_workspace` checks only the owner role and has no `personal` guard.                                                                                                                                                                            | `packages/storage-server/migrations/0003_identity_access.sql:652-680`                                                             | Make the two workspace mutations session only and refuse to delete the personal workspace.                                                                    |
| BE-40 | P2  | apps/server    | `NOTESAPP_MAX_BODY_BYTES` defaults to 1,048,576 bytes while `MarkdownText.maxLength` is 1,048,576 characters, so a note anywhere near its declared limit can never be saved: the JSON envelope always exceeds the byte cap first.                                                                                                                                             | `docker-compose.yml:50`, `apps/server/src/app.ts:184`, `packages/api-contract/openapi.yaml:2226`                                  | Raise the body limit to about four times the text cap, or lower the text cap.                                                                                 |
| BE-41 | P2  | apps/server    | MCP tools return raw internal error text, including `pg` messages with SQL fragments and constraint names, to the client.                                                                                                                                                                                                                                                     | `apps/server/src/mcp/server.ts:814-826`, `:203`; also `apps/mcp-stdio/src/tools.ts:434-440`                                       | Map through the same classification table as HTTP.                                                                                                            |
| BE-42 | P2  | apps/server    | The write pause runs three to five blocking syscalls plus a file create and unlink per mutation, on the event loop, before authentication.                                                                                                                                                                                                                                    | `apps/server/src/write-pause.ts:96-148`, hooked at `apps/server/src/app.ts:226`                                                   | Removed with BE-29.                                                                                                                                           |
| BE-43 | P3  | apps/server    | Seven unused dependencies: `hono`, `@modelcontextprotocol/fastify`, `@modelcontextprotocol/node`, `@better-fetch/fetch`, `better-call`, `@better-auth/core`, `@better-auth/utils`. Zero imports in `src`.                                                                                                                                                                     | `apps/server/package.json:16-31`                                                                                                  | Remove them.                                                                                                                                                  |
| BE-44 | P3  | apps/server    | No `__Host-` cookie prefix, and `sameSite` is `lax` where `strict` would work. Three database round trips per authenticated request; Better Auth `session.cookieCache` is not enabled.                                                                                                                                                                                        | `apps/server/src/auth/better-auth.ts:217`                                                                                         | Optional hardening.                                                                                                                                           |
| BE-45 | P3  | apps/mcp-stdio | `get_attachment` returns `{}`: it `JSON.stringify`s a binary response body.                                                                                                                                                                                                                                                                                                   | `apps/mcp-stdio/src/tools.ts:408-425`                                                                                             | Base64 encode, or delete with BE-21.                                                                                                                          |
| BE-46 | P3  | apps/server    | Metric semantics are wrong. `saveFailures` counts a 412 stale head and a 428 precondition as save failures, `authFailures` misses a 401 on a data route, and hijacked write-pause answers never reach `onResponse`.                                                                                                                                                           | `apps/server/src/observability.ts:197-208`                                                                                        | Removed or corrected with BE-25.                                                                                                                              |
| BE-47 | P3  | apps/server    | `recover-account.ts` still refers to "the configured provider" and refuses accounts without a local password on a policy that no longer exists.                                                                                                                                                                                                                               | `apps/server/src/cli/recover-account.ts:221-245`                                                                                  | Delete the stale branch.                                                                                                                                      |

### Data model and storage-server

| ID    | Sev | Area              | Finding                                                                                                                                                                                                                                                                                                                                   | Location                                                                                                                                                                                                                                     | Fix                                                                                                                             |
| ----- | --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| BE-48 | P0  | product + storage | No trash and no restore path for a deleted note. `files.deleted` exists but `listFiles` filters it out, `getFile` answers 404, search excludes it, and no screen lists deleted notes. The only route is the purge screen, where the user types a file UUID by hand.                                                                       | flag at `packages/storage-server/src/schema.ts:147`, filter at `packages/storage-server/src/workspace-store.ts:857`, local filter at `packages/storage-browser/src/local-store.ts:1653`, UUID entry at `apps/web/src/features/purge.tsx:228` | Add a `listDeletedFiles` operation, a Trash screen, and a one-click restore. This is the safety net for BE-02, BE-03 and BE-04. |
| BE-49 | P0  | storage-server    | Purge marks in-flight attachment uploads unavailable. The statement selects every attachment object with no `contents` reference, with no state filter and no age cutoff, so a `temporary` object uploaded seconds ago is destroyed by a purge of an unrelated note. The 24 hour reclaimer gets this right.                               | `packages/storage-server/migrations/0008_public_sharing.sql:320-330`; correct version at `migrations/0004_attachment_cleanup.sql:22-27`                                                                                                      | Add `AND ao.state = 'finalized' AND ao.finalized_at < now() - interval '24 hours'`.                                             |
| BE-50 | P0  | storage-server    | Purge and workspace deletion never delete attachment bytes, and nothing else ever will. Purge sets `state = 'unavailable'`, and the only code path that unlinks a file admits only `temporary` and `finalized`. "Permanently delete" leaves the bytes on disk forever.                                                                    | `migrations/0008_public_sharing.sql:328`, `:188`; reclaim filter at `migrations/0004_attachment_cleanup.sql:22-23`; unlink at `packages/storage-server/src/attachments.ts:475-501`                                                           | Unlink in the purge path, or add `unavailable` to the reclaim candidates.                                                       |
| BE-51 | P1  | storage-server    | The attachment reclaim digest check runs outside the lock and outside a transaction. The race deletes the bytes of a finalized object, leaving a row with no file and a permanently broken image.                                                                                                                                         | `packages/storage-server/src/attachments.ts:472`, check at `:485`, unlink at `:496`                                                                                                                                                          | Move the digest check and the unlink into the same locked transaction as the mark.                                              |
| BE-52 | P1  | storage-server    | The migration journal `when` values are out of order. `0006_sync_cleanup` has the largest value of all eleven, and the driver gates each entry on the one timestamp it read at the start, so a database whose newest migration is `0006` silently skips `0007` through `0010` and reports success.                                        | `packages/storage-server/migrations/meta/_journal.json`; gate in the pinned `drizzle-orm/pg-core/dialect`                                                                                                                                    | Renumber monotonically, or squash to one migration.                                                                             |
| BE-53 | P1  | storage-server    | Search has no relevance ranking. Results are ordered alphabetically by path, so a common word returns the first N notes by name, not the best N.                                                                                                                                                                                          | `migrations/0010_indexed_search.sql:44`                                                                                                                                                                                                      | Order by `ts_rank_cd` with a title boost.                                                                                       |
| BE-54 | P1  | storage-server    | The search excerpt is the first 1024 characters of the note, not the match. There is no `ts_headline`, so the user never sees why or where a note matched.                                                                                                                                                                                | `migrations/0010_indexed_search.sql:50`                                                                                                                                                                                                      | Use `ts_headline`.                                                                                                              |
| BE-55 | P1  | storage-server    | The text search configuration is `simple`, so there is no stemming and no stopwords, and `websearch_to_tsquery` gives no prefix matching. "running" does not match "run" and typing "not" finds nothing for a note named "Notes". Search as you type does not work.                                                                       | `migrations/0010_indexed_search.sql:33`, `:43`, `packages/storage-server/src/schema.ts:638`                                                                                                                                                  | Use `english`, and add a trigram index or a prefix query for incremental search.                                                |
| BE-56 | P1  | core + contract   | Notes have no created timestamp in the domain or the API. `files.created_at` is stored and never read, and the only `createdAt` in the whole contract belongs to `AgentToken`. A notes app cannot sort by created.                                                                                                                        | `packages/storage-server/src/schema.ts:148`, `packages/core/src/files/ports.ts:32-40`, `packages/api-contract/openapi.yaml:2105`                                                                                                             | Expose `createdAt` on `FileRecord` and in `listFiles`.                                                                          |
| BE-57 | P1  | storage-server    | `listFiles` orders and pages by a random file UUID, so there is no server-side sort by name or recency and the client must fetch every file to sort. The web shell pages 100 at a time until exhausted, which is 100 sequential requests for 10,000 notes.                                                                                | `packages/storage-server/src/workspace-store.ts:859`, `:862`; client loop at `apps/web/src/features/shell.tsx:58-79`                                                                                                                         | Add keyset paging on `(updated_at, id)` and on `(path, id)`.                                                                    |
| BE-58 | P1  | product           | No export. There is no operation in the 33 operation contract that returns notes as Markdown files, and no client-side save. The only exit is an encrypted, installation-bound GPG archive of a PostgreSQL dump that only this application version can read. For a self-hosted notes app this is lock-in.                                 | contract has no export operation; archive format at `tools/ops/backup.sh:237-243`                                                                                                                                                            | Add "download all notes as a zip of .md files". It is also the cheapest disaster recovery.                                      |
| BE-59 | P2  | storage-server    | Every accepted save reads every live note in the workspace to build the wiki-title map. With 10,000 notes that is a 10,000 row scan per Save, inside the workspace write lock. The measured save p95 of 175 ms already sits against a 200 ms limit.                                                                                       | `packages/storage-server/src/workspace-store.ts:527-537`, called at `:2053`                                                                                                                                                                  | Resolve titles with an indexed lookup of only the titles the changeset links to.                                                |
| BE-60 | P2  | storage-server    | Backlinks go stale in one direction. Link rows are recomputed only for the files in the current changeset, and `link_index.target_file_id` has no foreign key. A `[[Project X]]` written before its target exists stays unresolved until the source is edited again, and a rename leaves every title link pointing at the old resolution. | `workspace-store.ts:548-570`, resolution at `:527-546`, missing key at `schema.ts:591`                                                                                                                                                       | Re-resolve the inbound title links of any file whose path or liveness changed.                                                  |
| BE-61 | P2  | storage-server    | Raw Markdown is indexed for search, including link URLs and code fences, and there is no separate title field to weight. A link to `https://example.com/q3.pdf` makes the note match "https", "example" and "pdf".                                                                                                                        | `workspace-store.ts:523`                                                                                                                                                                                                                     | Strip syntax before indexing and index the title as its own weighted field.                                                     |
| BE-62 | P2  | storage-server    | A very large note can fail `to_tsvector`, which caps one vector at 1 MB. The body limit sits at 1 MiB, so a note is bounded near the cap rather than safely below it. The index insert then aborts the whole accept savepoint and the Save fails with a 500.                                                                              | `schema.ts:636`, insert at `workspace-store.ts:517`                                                                                                                                                                                          | Truncate the indexed text well below 1 MB.                                                                                      |
| BE-63 | P2  | storage-server    | Purge has no savepoint, unlike `accept` and `acceptBranch`. A SQL failure is converted to a domain result over an already aborted transaction, and the following `commit` silently becomes a rollback.                                                                                                                                    | `workspace-store.ts:1600-1667`; correct pattern at `:1260`                                                                                                                                                                                   | Wrap it in a savepoint.                                                                                                         |
| BE-64 | P2  | storage-server    | Purge accounting is wrong and disagrees with its own preview. The preview reports `files * 512`, the purge reclaims `revisions * 1024`, and the 512 bytes charged per receipt are never released. `greatest(0, ...)` hides the drift.                                                                                                     | preview at `workspace-store.ts:1546`, reclaim at `migrations/0008_public_sharing.sql:339`, charge at `workspace-store.ts:1899-1902`                                                                                                          | Reclaim exactly what was charged, and assert usage in a test.                                                                   |
| BE-65 | P2  | storage-server    | `notesapp_purge_files` does not delete `snapshot_items`, whose foreign key references `revisions`. It works only because the TypeScript caller deletes them first. Any second caller hits a foreign key violation.                                                                                                                        | `migrations/0008_public_sharing.sql:300`, pre-step at `workspace-store.ts:1604-1613`                                                                                                                                                         | Move the delete into the function.                                                                                              |
| BE-66 | P2  | storage-server    | A duplicate revision id returns HTTP 500. Only three unique-violation constraints are mapped, so the `revisions` primary key, `revision_parents_edge_key` and `changesets_cursor_key` all become an operational error.                                                                                                                    | `workspace-store.ts:301-336`, throw at `:1281`                                                                                                                                                                                               | Map them to 409 or 422.                                                                                                         |
| BE-67 | P2  | storage-server    | Attachment filesystem writes happen inside an open transaction. A rollback after the rename leaves the row `temporary` with bytes already at the immutable path, which the reclaimer then treats as used forever.                                                                                                                         | `packages/storage-server/src/attachments.ts:278-286`                                                                                                                                                                                         | Rename after commit, or keep a pending-delete journal.                                                                          |
| BE-68 | P2  | storage-server    | Every attachment read takes the workspace write lock. A note with 20 images serialises 20 lock acquisitions against every concurrent save. The workspace store has a read-only escape; the attachment store does not.                                                                                                                     | `attachments.ts:154`, `:204`, `:338`; escape at `workspace-store.ts:665`                                                                                                                                                                     | Add a read-only path that skips the advisory lock.                                                                              |
| BE-69 | P2  | storage-server    | Three attachment SQL functions have no membership check and accept any workspace id from any authenticated caller. `notesapp_reclaim_attachments` returns every workspace's objects, and `notesapp_mark_attachment_unavailable` will mark any workspace's attachment unavailable.                                                         | `migrations/0004_attachment_cleanup.sql:8`, `:49`, `:69`; grants at `:31`, `:67`, `:85`; correct pattern at `migrations/0008_public_sharing.sql:225`                                                                                         | Add `notesapp_is_member` checks, or restrict the grant to a job role.                                                           |
| BE-70 | P2  | storage-server    | `listHistory` orders by `clock_timestamp()`, not by the commit cursor, so a clock step backwards can invert history order. `changesets.cursor` is the authoritative monotone order and is not used.                                                                                                                                       | `workspace-store.ts:1292-1295`                                                                                                                                                                                                               | Order by the cursor.                                                                                                            |
| BE-71 | P2  | storage-server    | `mutation_receipts` grows without limit. Nothing removes a receipt except workspace deletion, and each carries a JSON outcome naming every accepted revision.                                                                                                                                                                             | `schema.ts:438`, delete only at `migrations/0008_public_sharing.sql:184`                                                                                                                                                                     | Add a retention window; a receipt only needs to outlive a client retry.                                                         |
| BE-72 | P2  | storage-server    | No advisory lock around `runMigrations`. The applied set is read outside the transaction, so two simultaneous container starts both try to apply and the loser exits non-zero. It self-heals on restart but breaks a scaled or rolling deploy.                                                                                            | `packages/storage-server/src/migrate.ts:74-77`                                                                                                                                                                                               | Take `pg_advisory_lock` around the migration.                                                                                   |
| BE-73 | P2  | storage-server    | The quota is enforced but not configurable and not surfaced. It is always 5 GiB, no operation returns `bytesUsed`, and a normal delete frees nothing: only an explicit purge decrements usage. The only user-visible outcome is a 413 they cannot act on.                                                                                 | `schema.ts:93`, default at `packages/storage-server/src/provision.ts:21`, decrement only at `migrations/0005_history_purge.sql:258`                                                                                                          | Surface usage, make the limit configurable, or replace it with a disk check.                                                    |
| BE-74 | P2  | storage-server    | `0008_public_sharing.sql` cannot be deleted despite 158 dead lines, because lines 159 to 359 carry the only current bodies of `notesapp_delete_workspace` and `notesapp_purge_files`.                                                                                                                                                     | `migrations/0008_public_sharing.sql:159-359`                                                                                                                                                                                                 | Handle it in the squash of BE-52.                                                                                               |
| BE-75 | P3  | storage-server    | `set constraints all deferred` after the immediate check is over-broad: it defers every deferrable constraint in the transaction, not the two that were originally deferred.                                                                                                                                                              | `workspace-store.ts:2102-2103`                                                                                                                                                                                                               | Name the two constraints.                                                                                                       |
| BE-76 | P3  | storage-server    | `files.updated_at` uses `now()` while `revisions.server_time` uses `clock_timestamp()`, so two changesets in one transaction get distinct revision times and an identical file time.                                                                                                                                                      | `workspace-store.ts:2017`, `schema.ts:283`                                                                                                                                                                                                   | Use one clock.                                                                                                                  |
| BE-77 | P3  | storage-server    | No `lock_timeout` and no `idle_in_transaction_session_timeout`. A stalled client holds the workspace advisory lock and blocks every other write.                                                                                                                                                                                          | `workspace-store.ts:581-583`                                                                                                                                                                                                                 | Set both on the pool.                                                                                                           |
| BE-78 | P3  | storage-server    | `purgeFiles` has no file count cap, unlike the 1000 file cap on a changeset.                                                                                                                                                                                                                                                              | `packages/core/src/history/purge.ts:57`                                                                                                                                                                                                      | Cap it.                                                                                                                         |
| BE-79 | P3  | storage-server    | The search GIN index has no leading `workspace_id`, and `notesapp_search` sorts the whole match set inside a materialised CTE before the limit.                                                                                                                                                                                           | `schema.ts:636`, `migrations/0010_indexed_search.sql:44-45`                                                                                                                                                                                  | Include the workspace in the index and push the limit down.                                                                     |
| BE-80 | P3  | storage-server    | The required schema version is a hand-maintained literal `11` compared against `notesapp_schema_version()`. Every migration needs both bumped by hand.                                                                                                                                                                                    | `apps/server/src/http/handlers.ts:180`, `migrations/0010_indexed_search.sql:58`                                                                                                                                                              | Derive it from the migration count.                                                                                             |

### API contract, client, and codegen

| ID    | Sev | Area            | Finding                                                                                                                                                                                                                                                                                                                      | Location                                                                                                                                                                          | Fix                                                                                                            |
| ----- | --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| BE-81 | P1  | api-contract    | The generated contract index is fully dereferenced, so one shared error schema is copied 259 times. 28,231 of its 36,412 data lines, that is 77 percent, are duplicated `ProblemDetails`. The file is 1.4 MB and the built JavaScript is 1.8 MB.                                                                             | `packages/api-contract/src/generated/contract.ts`; emit at `tools/sdk-codegen/src/emit.ts:15-100`                                                                                 | Emit one shared `$defs` block and rewrite refs to it. Measured result: 7,632 data lines, identical validation. |
| BE-82 | P1  | apps/server     | Nine route entries live outside the contract, including `POST /oauth/token`, and `docs/development/api-contract.md:111` claims only the contract creates routes. `/health`, `/ready` and `/metrics` duplicate contract operations with unvalidated bodies, and the whole MCP and OAuth surface bypasses contract validation. | `apps/server/src/app.ts:254`, `:265`, `:277`; `apps/server/src/mcp/server.ts:883-928`                                                                                             | Bring them into the contract or document the exception honestly. Most disappear with BE-21.                    |
| BE-83 | P2  | api-contract    | Compiling one Ajv validator per slot and per response compiles 434 schemas of which only 67 are unique. Caching by schema digest cuts startup from 419 ms to 82 ms and resident memory from 130 MB to 94 MB.                                                                                                                 | `tools/sdk-codegen/src/emit.ts:155-172`                                                                                                                                           | Cache by digest. Six lines.                                                                                    |
| BE-84 | P2  | sdk-codegen     | `emitValidatorModule()` takes no arguments and returns a constant string: a 78 line generator that emits a 79 line file which never varies with the contract.                                                                                                                                                                | `tools/sdk-codegen/src/emit.ts:109-186`                                                                                                                                           | Make it a normal hand-written source file.                                                                     |
| BE-85 | P2  | api-contract    | `AuthRedirect` is the only unreferenced schema in the merged contract, left over from the deleted social sign-in operation, and it still reaches the shipped client. Redocly's unused-component lint runs on `openapi.yaml` only, so nothing in the merged document is checked.                                              | `tools/sdk-codegen/src/auth-contract.ts:199-215`, shipped at `packages/api-client/src/generated/types.gen.ts:295`                                                                 | Delete it and add an orphan-component walk over the merged document.                                           |
| BE-86 | P2  | api-contract    | Three contract operations have no caller anywhere: `getAuthSession`, `requestPasswordReset` and `resetPassword`. There is no forgot-password interface; the supported path is the operator command. They cost 2,656 lines in the contract index.                                                                             | `tools/sdk-codegen/src/auth-contract.ts`                                                                                                                                          | Add the interface or drop the operations.                                                                      |
| BE-87 | P2  | api-contract    | `mcp-operations.ts` falls back to a UUID schema when a named contract property is absent, so renaming `limit` in the contract leaves the MCP tool advertising a UUID input for a page limit, and nothing fails: the file is not generated and the tests only count 14 tools.                                                 | `packages/api-contract/src/mcp-operations.ts:50-67`                                                                                                                               | Throw instead of falling back.                                                                                 |
| BE-88 | P2  | core + contract | The `Role` enum is a stated compatibility type with four values of which only `owner` is ever written, and the permission matrix still grants `share` and `members`, two actions with no reachable operation. The web app still branches on a viewer role that cannot occur.                                                 | `packages/api-contract/openapi.yaml:1914-1923`, `packages/core/src/identity/actor.ts:17`, `:61-66`, `apps/web/src/features/recovery.tsx:6`                                        | Reduce to one role and three actions, or drop the matrix.                                                      |
| BE-89 | P2  | apps/server     | Dead public sharing code. `publicSharePage` is exported and no route serves it, `/s/` is still treated as an API prefix in the not-found handler, the live content store type is still named `SharingStore`, and `readPublicShareAttachment` is still stubbed.                                                               | `apps/server/src/public/page.ts`, exported at `apps/server/src/index.ts:91`, prefix at `apps/server/src/app.ts:307`, type at `apps/server/src/http/handlers.ts:62`, stub at `:50` | Delete.                                                                                                        |
| BE-90 | P3  | sdk-codegen     | `protocolExtension` is declared twice, independently, so the reader and the writer of the same marker can diverge. Two unused boundary allowances exist for imports nobody makes. The repository carries two TypeScript majors because the generator needs 6.0.3 while everything else needs 7.0.2.                          | `tools/sdk-codegen/src/contract-index.ts:75` and `auth-contract.ts:27`; `tools/check-boundaries.mjs:38`, `:40`; `tools/check-versions.mjs:49-62`                                  | Unify, prune, and document the version split.                                                                  |
| BE-91 | P3  | api-contract    | `Preferences` names a request body, a response and a schema, so the generator exports `Preferences2` as the public request-body type.                                                                                                                                                                                        | `packages/api-contract/openapi.yaml:1378`, `:1543`, `:1932`                                                                                                                       | Rename the request body to `PreferencesUpdate`.                                                                |

### Operations

| ID     | Sev | Area | Finding                                                                                                                                                                                                                                                                                                                                                                                | Location                                                                                                               | Fix                                                                                               |
| ------ | --- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| BE-92  | P0  | ops  | `docker-compose.yml` ships the author's own LAN address and host name as the default origin and allowed hosts. A self-hoster who runs `docker compose up -d` without writing a `.env` gets an application whose cookies and CORS bind to an address they do not own, and the file publishes the author's network layout.                                                               | `docker-compose.yml:43`, `:48`                                                                                         | Remove the defaults so Compose fails loudly, or default to `localhost`.                           |
| BE-93  | P0  | ops  | The default publish address is `0.0.0.0`, contradicting both `.env.example:5` and the self-hosting guide. Combined with an unauthenticated `/metrics`, an open `POST /api/setup` and the consent-free OAuth authorize route, a fresh install on a public host is an account takeover window.                                                                                           | `docker-compose.yml:63`                                                                                                | Default to `127.0.0.1`.                                                                           |
| BE-94  | P0  | ops  | The documented backup and restore commands use host bind paths that the shipped Compose file never creates. Compose stores everything in named volumes, so a self-hoster who follows the guide backs up an empty directory, the write pause never reaches the running application, and the dump is uncoordinated. This is a silent, wrong-looking-right backup of a notes application. | volumes at `docker-compose.yml:13`, `:65`; commands at `docs/operations/self-hosting.md:41-48`, `:123-130`, `:164-171` | Bind-mount the host paths the docs already name, or make the scripts Compose-aware.               |
| BE-95  | P1  | ops  | The documented migration failure behaviour is wrong, and the docs describe a one-shot migration service that commit 553e981 removed. In reality the `&&` short-circuits, the container exits non-zero, and `restart: unless-stopped` produces a crash loop that, with no log rotation, fills the disk.                                                                                 | `docker-compose.yml:40`, `:32`; claims at `docs/operations/self-hosting.md:3`, `:83`, `:92`, `:189`                    | Rewrite the passages, or start the server unready on a migration failure so the docs become true. |
| BE-96  | P1  | ops  | Nothing checks that a backup is complete. `pg_dump --enable-row-security` exports only rows visible to the dumping role, and no check compares restored row counts with the source. The CI round trip never puts a note body or a version through the cycle.                                                                                                                           | dump at `tools/ops/backup.sh:97`; test asserts only file presence at `tests/integration/operations.test.ts:530-531`    | Compare row counts per table in `restore.sh`, and round-trip a real note with history.            |
| BE-97  | P1  | ops  | No reverse proxy or TLS example exists, although the guide requires the operator to supply one and explains that plain HTTP loses secure-context browser features. There is also no proxy trust configuration anywhere, so the request log records the proxy.                                                                                                                          | `docs/operations/self-hosting.md:5`, `:19-23`; no `trustProxy` in `apps/server/src`                                    | Ship a ten-line Caddy service in an optional profile.                                             |
| BE-98  | P2  | ops  | Backup requires Node 26, GnuPG, PostgreSQL client tools and a repository checkout on the host. Six `node -e` blocks force the exact runtime. For a "one Compose stack" product this is the largest piece of unnecessary complexity.                                                                                                                                                    | `tools/ops/backup.sh:73`, `:142`, `:166`, `:196`, `:247`, `:257`; requirements at `docs/operations/self-hosting.md:27` | Rewrite in POSIX shell, or ship backup as a subcommand of the image.                              |
| BE-99  | P2  | ops  | No log rotation and no resource limits on either service. A crash loop, which a failed migration produces, fills a small disk.                                                                                                                                                                                                                                                         | `docker-compose.yml` has no `logging` or `deploy.resources`                                                            | Set `logging.options.max-size` and `max-file`.                                                    |
| BE-100 | P2  | ops  | No backup scheduling is shipped, and the backup age metric returns -1 when no backup has ever run, so the documented "alert on age above the interval" never fires for the case worth alerting on.                                                                                                                                                                                     | `apps/server/src/observability.ts:78-81`, guidance at `docs/operations/self-hosting.md:185`                            | Ship a timer example and return a large sentinel or a separate present gauge.                     |
| BE-101 | P2  | ops  | CI never builds the Docker image and never runs Playwright. Every Dockerfile and Compose finding above is unverified by CI, and the browser suite that `AGENTS.md` requires for every P0 journey does not gate a merge.                                                                                                                                                                | `.github/workflows/ci.yml`; `verify` at `package.json:30`                                                              | Add `docker compose build` plus a stack smoke test, and add `test:e2e`.                           |
| BE-102 | P2  | ops  | The PostgreSQL image is pinned by a bare digest with no tag, so the running major version is invisible in the file, and there is no documented major upgrade path even though PGDATA is version-numbered.                                                                                                                                                                              | `docker-compose.yml:4`                                                                                                 | Write `postgres:18.6@sha256:...` and document `pg_upgrade`.                                       |
| BE-103 | P2  | ops  | `image: notesapp:latest` alongside `build:` means `docker compose up -d` reuses a stale image after a pull, with no warning. The migration entry point is also a hardcoded pnpm-internal path that a linker change breaks.                                                                                                                                                             | `docker-compose.yml:28-31`, `:40`                                                                                      | Publish a versioned image, and move migrate-then-serve into an entrypoint script.                 |
| BE-104 | P2  | ops  | `.secrets` and `.storage` are not in `.dockerignore`, so secret files enter the build context on every build. Nothing enforces mode 0600 on the seven secret files; the local ones are 0644 inside a 0700 directory, while the backup scripts do enforce it on their own key files.                                                                                                    | `.dockerignore:1-17`; enforcement pattern at `tools/ops/backup.sh:25-32`                                               | Add both paths, and ship a secret-init script that generates all seven at 0600.                   |
| BE-105 | P3  | ops  | No `HEALTHCHECK` in the Dockerfile, no `init: true`, no `read_only`, no `cap_drop`, no `no-new-privileges`. The image already runs as uid 10001, which is the important half.                                                                                                                                                                                                          | `Dockerfile`, `docker-compose.yml`                                                                                     | Cheap hardening.                                                                                  |
| BE-106 | P3  | ops  | The role password appears in SQL statement text through server-side `format`, so PostgreSQL logs it if `log_statement` is on or the statement errors.                                                                                                                                                                                                                                  | `packages/storage-server/src/migrate.ts:84-92`                                                                         | Wrap in `SET LOCAL log_statement = 'none'`.                                                       |

## Entity model

### The entities that exist

**Identity, 9 tables.** `auth_user`, `auth_session`, `auth_account`,
`auth_verification` are owned by the `notesapp_auth` role, and the application
role holds no right on them at all. `account_identities` maps one auth user to
one application `accounts` row. `account_preferences`, `account_audit_events`,
`agent_tokens` and `invitations` hang off the account.

**Workspace and content, 22 tables.** `workspaces` with `workspace_usage`
(bytes used and a 5 GiB quota) and `workspace_cursors` (the monotone commit
order). `memberships` binds an account to a workspace with a role.

**Content, the core five.** A `files` row is a stable UUID with a path, a kind,
a head revision and a deleted flag. A `revisions` row is immutable and names a
content digest, a path, a deleted flag, a changeset, an actor and two times.
`revision_parents` is the edge table, allowing zero, one or two parents. A
`contents` row is content addressed by `(workspace_id, digest)` and holds either
Markdown text or an attachment object reference. A `changesets` row is one
atomic operation with its mutation id, device id and request digest.

**Derived and bookkeeping.** `live_paths` enforces path uniqueness with a
deferred unique index, which is what allows an atomic two-path swap.
`search_index` holds one row per live note head with a GIN index.
`link_index` holds one row per outbound link. `mutation_receipts` stores the
outcome of an accepted mutation so a retry is safe. `purge_markers` blocks a
purged file identity forever. `sync_changes` is the ordered change feed.
`snapshots` and `snapshot_items` are the first-sync download plan.
`attachment_objects` holds attachment metadata with a state machine while the
bytes live on the filesystem.

**Dead, from removed features.** `shares`, `branches`, `invitations` and
`audit_events`, plus 9 SQL functions, 1 trigger, 3 policies and about 40 columns.

**Client side, IndexedDB, 14 stores.** `drafts` (one mutable working copy per
open editor, with a sequence), `checkpoints` (immutable local versions),
`contents`, `acceptedFiles` (the accepted head plus the local head per file),
`queue` (one pending mutation with a sequence and a state), `receipts`,
`stagedSnapshots`, `snapshotItems`, `leases` (one sync worker lease),
`cursors`, `preferences`, `recovery`, `branches` (dead), and `meta`. Every
private row is keyed by `(serverOrigin, accountId, workspaceId, ...)`.

### Text diagram

```
IDENTITY                                     WORKSPACE AND CONTENT
--------                                     ---------------------
auth_user --1:1-- account_identities         workspaces
   |                      |                    +--1:1-- workspace_usage
   +--1:N-- auth_session  |                    +--1:1-- workspace_cursors
   +--1:N-- auth_account  |                    +--1:N-- memberships (role, only owner used)
            (SSO cols     |                    +--1:N-- invitations       [DEAD]
             all dead)    |                    +--1:N-- audit_events      [write only]
                          v                    +--1:N-- purge_markers
                       accounts                +--1:N-- sync_changes
                          |                    +--1:N-- snapshots --1:N-- snapshot_items
   +----------------------+                    |
   +--1:1-- account_preferences                +--1:N-- attachment_objects
   +--1:N-- account_audit_events               |            ^ (contents_object_fk)
   +--1:N-- agent_tokens                       +--1:N-- contents  PK (workspace_id, digest)
   +--1:N-- memberships                        |            ^ (revisions_content_fk)
   +--1:N-- changesets.actor                   |
   +--1:N-- revisions.actor                    +--1:N-- files  PK (workspace_id, id)
   +--1:N-- mutation_receipts.actor            |          |
   +--1:N-- snapshots.account                  |          +--1:1-- live_paths  unique(ws, path) DEFERRED
                                               |          +--0:1-- search_index
                                               |          +--1:N-- link_index (target has no FK)
                                               |          +--1:N-- branches   [DEAD]
                                               |          +--1:N-- shares     [DEAD]
                                               |          |
                                               |          +--1:N-- revisions  (immutable)
                                               |                     +--N:M via revision_parents
                                               +--1:N-- changesets (mutation id, cursor)
                                               +--1:N-- mutation_receipts (stored outcome)

BROWSER (IndexedDB, keyed by serverOrigin + accountId + workspaceId)
-------
drafts (mutable, per working copy, sequence)  ->  checkpoints (immutable) -> queue (pending mutation)
   |                                                    |                        |
   +-- text, path, deleted, baseRevisionId              +-- digest, parents      +-- ChangesetInput, state, digest
                                                        v                        v
                                         acceptedFiles (acceptedHead + localHead)  receipts, cursors
                              stagedSnapshots -> snapshotItems -> contents        leases (one worker)
```

### Is the model proportionate?

No. It is a correct, carefully built multi-tenant collaboration store for a
product that is now one person editing Markdown. `workspace_id` is the leading
column of every primary key, every index and every composite foreign key across
22 tables, and it forces the advisory-lock-per-workspace design, the whole row
level security layer, and `notesapp_is_member`.

**Over-engineered for v0.1:** multi-workspace (live and user-visible, but the
largest single tax), the member row access policies (about 400 lines plus 4
helper functions to separate exactly one account), the artificial 5 GiB quota,
snapshots as first-sync machinery, purge shipped before trash, agent tokens plus
two MCP servers plus an OAuth authorization server, metrics, the write pause,
and the 4-role by 6-action permission matrix of which one role and three actions
are reachable. Conflict branches, sharing and invitations are simply dead.

**Worth keeping:** the `notesapp_auth` and `notesapp_app` role split, the
immutability of `contents`, `revisions`, `revision_parents`, `changesets` and
`mutation_receipts` enforced by both grants and triggers, the deferred
`live_paths` unique index, the content-addressed store, the mutation receipt,
and the stable file identity that survives a rename.

**Missing for a good notes app:** trash and restore (BE-48), a note created
timestamp (BE-56), server-side sort by name or recency (BE-57), export (BE-58),
folders as first-class entities, tags, pinning, and manual ordering.

## Save path trace and data-loss risks

### The trace, keystroke to PostgreSQL row

1. **Keystroke.** The CodeMirror change handler bumps an in-memory sequence and
   arms a 120 ms timer (`apps/web/src/features/note-editor.tsx:497-510`).
2. **Draft write.** `saveDraft` opens one read-write transaction on `drafts`,
   reads the stored row, ignores the write if the stored sequence is newer, and
   puts the row with a fresh `savedAt`
   (`packages/storage-browser/src/local-store.ts:500-523`). No version exists yet.
3. **Save pressed.** The editor validates the path, flushes the draft, then
   calls `checkpoint(draft, 'Manual save')`
   (`note-editor.tsx:302-338`). The message is always non-empty, so
   `shouldCheckpoint` always returns true (`packages/sync/src/checkpoints.ts:93`).
4. **Local version.** `checkpoint` computes the SHA-256 outside the transaction,
   then in one read-write transaction over `drafts`, `checkpoints`, `contents`,
   `acceptedFiles` and `queue` it writes the content row, an immutable
   checkpoint whose parent is the last local checkpoint or the draft base, the
   new local head, and a queue entry whose `expectedHeads` names the **accepted**
   head. It links the draft to the new checkpoint (`local-store.ts:558-742`).
5. **Wake.** The editor publishes a queue change; the app calls
   `engine.requestSync()` (`apps/web/src/app.tsx:395-407`).
6. **Lease and session.** The engine acquires or renews the single IndexedDB
   worker lease, then verifies the session with `getAccount`
   (`packages/sync/src/engine.ts:287-348`).
7. **Push.** `pushQueue` reads the queue in sequence order, drops `conflict`
   entries, and either retries a `sending` entry alone or batches the leading run
   of `pending` entries into one changeset under the first mutation id
   (`packages/sync/src/queue.ts:242-259`).
8. **Send.** `prepareCommit` computes the request digest, `markSending` freezes
   it locally, and `commit` calls the generated `commitChangeset` operation with
   bounded backoff for transport failures and retryable statuses
   (`queue.ts:294-299`, `engine.ts:479-512`).
9. **Server boundary.** Fastify validates the body, query, params and headers
   against Ajv schemas compiled from the contract
   (`apps/server/src/http/register.ts:453-469`). The handler resolves the actor,
   builds a `ChangesetInput`, and computes the request digest over the raw body
   (`apps/server/src/http/files.ts:641-658`).
10. **Domain.** `commitChangeset` refuses an empty or oversized changeset, then
    inside one transaction: takes the workspace advisory lock, checks the role
    and the grant, reads the actor-bound receipt (returning the stored outcome on
    a matching digest, `mutation_reused` otherwise), checks purge markers,
    normalises paths to NFC, **rebases** each stale head, validates the revision
    graph, recomputes every Markdown digest, then accepts
    (`packages/core/src/files/commit.ts:219-287`).
11. **Write.** `writeChangeset` locks the affected file rows in identifier
    order, inserts missing files, verifies attachment objects, verifies digests
    again, inserts content with `onConflictDoNothing`, charges the quota through
    a membership-checked function, allocates the commit cursor, inserts the
    changeset, the revisions and the parent edges, advances every head in one
    statement, updates `live_paths`, rebuilds the search and link indexes,
    inserts the sync change rows, stores the receipt, forces deferred
    constraints immediate so a path conflict is a domain result, and commits
    (`packages/storage-server/src/workspace-store.ts:1749-2110`).
12. **Acknowledge.** The client deletes the queue entry, marks its checkpoints
    accepted, moves the accepted head, advances the precondition of the first
    pending child, and stores the receipt, in one transaction
    (`local-store.ts:829-966`).
13. **Pull.** `pullNew` fetches the ordered change feed and, for each change,
    fetches the immutable revision, then applies the batch and the cursor in one
    transaction, keeping any file with local work
    (`packages/sync/src/snapshot.ts:244-303`).

The separation of concerns is genuinely clean: a draft is mutable and coalesced,
a checkpoint is immutable, a queue entry is durable and carries its own
preconditions, and a server revision is the only thing that is a version. Steps
10 to 12 are the strongest code in the repository.

### Where user content can be silently dropped

**1. The draft that never lets go (BE-01, BE-07).** The largest risk, and it
needs no second device. Type one character in a note. A draft row now exists and
is never removed except by sign-out. `readCachedNote` returns the newest draft
unconditionally, and the editor opens through it. Newer server content arrives,
`applyRemoteChanges` advances the accepted head, and the draft is not "dirty"
by the `localHead !== acceptedHead` rule, so nothing warns. The user reads stale
text believing it is current, edits it, and presses Save. The server rebases and
their stale text becomes the head. No comparison of `draft.baseRevisionId`
against `acceptedHeadRevisionId` exists anywhere in the live path; the only such
comparison sits inside the dead `resolveConflict` (`local-store.ts:1444`).

**2. Two tabs on one note (BE-02).** Both tabs get their own working copy and
both name the same accepted head as parent, which the integration suite asserts
as correct (`tests/integration/browser-storage.test.ts:395-396`). Both queue
entries are `pending`, so `takeBatchable` combines them and the second revision
fails `validateGraph` with `invalid_graph`. `submitBatch` then falls back to
per-entry sends: the first commits, the second is rebased onto it, and the first
tab's text is gone from the head. It survives in history, but the user is told
nothing. The test at `browser-storage.test.ts:411` even asserts that the second
tab's checkpoint became the local head.

**3. Two devices, offline (BE-02).** The documented behaviour. Device B saves
while offline, device A saves three versions, B reconnects, and B's text becomes
the head. The promise of "one linear history and no conflict UI" is kept, but
"no conflict UI" was implemented as "no signal at all". The minimum honest
version is a notice naming the superseded revision.

**4. A stale delete (BE-03).** `heads()` returns the tombstone as the head, so
the rebase accepts a deletion whose parent is now three versions newer. The
note leaves the tree, and because there is no trash (BE-48), the user cannot get
it back from the interface at all. The mirror case also holds: a stale edit
rebased onto a tombstone silently resurrects a deleted note.

**5. A silently reverted rename (BE-06).** The rebase keeps the client's path.
Device A renames a note, device B saves stale, and the rename is undone. If the
old path is now held by another file, the deferred unique index fires, the server
answers 409 `path_conflict`, and the save lands in risk 6.

**6. A folder rename that reverts content (BE-05).** `renameFolderChangeset`
carries the content each member had when the client read it. After a rebase the
rename revision writes that stale content over every current head. One rename
can revert an entire folder.

**7. The parked save (BE-04).** Any permanent failure that is not 401, 403, 404
or 413 marks the entry `conflict`, and `pushQueue` excludes conflict entries
from then on. The user sees one transient line, "Local work is preserved:
&lt;uuid&gt; (path_conflict)", and the text stays in an IndexedDB row with no list,
no retry and no recovery entry. Partial mitigation: a later save of the same
note carries the full current text and does rebase successfully, so a user who
keeps typing recovers by accident.

**8. Quota exhaustion (BE-73).** Usage only ever grows outside an explicit
purge. A normal delete frees nothing. On reaching 5 GiB every save answers 413,
which `submissionAction` maps to `leave`, so the entry stays queued forever with
no user-visible cause.

**9. Local quota exhaustion (BE-10).** The browser keeps every version of every
note forever. When IndexedDB refuses a write, the editor keeps the in-memory
buffer and reports a storage error, which is the right behaviour, but the
condition is reached by ordinary use rather than by anything unusual.

### Is the rebase logic correct?

Within its own contract, yes. `rebaseHeads` rejects a precondition for a file the
changeset does not change and a missing precondition for one it does, refuses to
change operation type (a create that finds a head, or an update that finds none),
and reparents only the first revision of each file so a submitted chain stays
intact (`packages/core/src/files/commit.ts:137-171`). `validateGraph` then proves
identifiers are new, every parent belongs to the same file, and each file forms a
single chain (`packages/core/src/files/graph.ts:45-80`). Digests are recomputed in
the use case and again in storage. The deferred constraint is forced immediate so
a path conflict is a domain result rather than a commit-time failure
(`workspace-store.ts:2102`). The transaction order matches the documentation
exactly.

The three gaps are not in the mechanics but in the contract itself: it ignores
the deleted flag (BE-03), it ignores that the path is also content (BE-06), and
it has no way to tell the client that something was superseded (BE-02).

### IndexedDB transaction correctness

Correct where it matters. Every operation runs inside an explicit Dexie
transaction with an explicit store list. The save transaction covers content,
the checkpoint, the head and the queue entry together, so a queue entry can never
reference missing content, and the integration suite proves an aborted
transaction leaves none of them (`tests/integration/browser-storage.test.ts:430`).
Sequence numbers guard against a late draft write. `checkpoints.add` is used
rather than `put` because a checkpoint is immutable. Failures are mapped to four
typed kinds and the editor keeps its buffer.

Schema migration handling is careful in design and expensive in practice. The
in-progress marker is written in its own transaction before the record migration,
so an interrupted upgrade is either finished or refused; a database written by a
newer application is refused rather than used. The two problems are that
revalidation loads the entire database into memory (BE-09) and that the blocked
upgrade test matches error message substrings (BE-19). Version 3 is
byte-identical to version 2 and exists only to add the four conflict fields to
every queue row, all four of which are dead.

## Scope cut list for v0.1

Generated artifacts, no product change:

| Item                                                                              | Lines             |
| --------------------------------------------------------------------------------- | ----------------- |
| Emit the contract index with shared `$defs` instead of dereferenced (BE-81)       | -28,800           |
| Squash 11 migrations to 1 and drop the 4 dead tables and 9 dead functions (BE-52) | -1,150 SQL        |
| The 6 superseded drizzle meta snapshots that the squash removes                   | -15,000 JSON      |
| Move `validators.ts` out of codegen (BE-84)                                       | -78               |
| **Generated subtotal**                                                            | **about -45,000** |

Removed multi-user features, no product change:

| Item                                                                                                                         | Lines            |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `packages/core/src/sharing/service.ts` plus the share and branch declarations in `files/ports.ts` and the `index.ts` exports | -400             |
| Invitations, members, ownership transfer in `packages/core/src/workspaces/service.ts` and `ports.ts`                         | -300             |
| Branch use cases in `packages/core/src/history/service.ts`                                                                   | -180             |
| Share, branch, invitation and member methods in `packages/storage-server/src/workspace-store.ts` and `identity-store.ts`     | -680             |
| `apps/server/src/public/page.ts`, the `/s/` prefix, the `SharingStore` stubs (BE-89)                                         | -70              |
| Dead conflict, branch, recovery-reason and pinning surface in `packages/sync/src/local-port.ts` and `local-store.ts`         | -650             |
| Viewer downgrade in `packages/sync/src/engine.ts` and its two notices (BE-20)                                                | -60              |
| Multi-user tests in `tests/integration/row-access.test.ts`                                                                   | -800             |
| Conflict resolution tests in `tests/integration/browser-storage.test.ts`                                                     | -300             |
| **Dead feature subtotal**                                                                                                    | **about -3,440** |

Deferrable for v0.1, a product decision:

| Item                                                                                                             | Lines            |
| ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| Remote MCP and the OAuth authorization server, `mcp/server.ts` plus `mcp/authorization.ts` plus its test (BE-21) | -1,767           |
| `apps/mcp-stdio`                                                                                                 | -565             |
| `packages/api-contract/src/mcp-operations.ts`                                                                    | -428             |
| `tests/integration/mcp.test.ts`                                                                                  | -728             |
| Agent tokens: server handlers, contract operations and schemas, core use cases (BE-38)                           | -510             |
| The generated contract lines those operations cost                                                               | -2,176           |
| Write pause and its hook and wiring (BE-29)                                                                      | -284             |
| Metrics collector and the `/metrics` route (BE-25)                                                               | -180             |
| The three uncalled auth operations (BE-86)                                                                       | -2,656 generated |
| **Deferrable subtotal**                                                                                          | **about -9,300** |

Total: about 45,000 generated lines and about 7,600 hand-written lines. Of the
98,700 in-scope lines, roughly 53,000 can go without removing a single feature
the product actually ships. `packages/api-contract` drops from 40,600 to about
8,000. `apps/server` drops about 32 percent.

Keep, even though it looks like over-engineering: the three-role database model,
the immutability triggers and grants, the deferred `live_paths` index, the
mutation receipt, the content-addressed store, the request digest, the
transactional migration guarantee, the archive path-safety checks in
`verify-backup.sh`, and the CI-tested backup and restore round trip.

## Target architecture for v0.1

### Recommendation

Keep 3 apps. Go from 10 packages to 6, and do not touch the layering.

| Package          | From                                                 | Rationale                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`           | `core` minus sharing, branches, invitations, members | The domain rules that both runtimes need. Runs in the browser. Keep the boundary.                                                                                                                                                                                                                                                                        |
| `client-store`   | `sync` + `storage-browser`                           | Merge. `sync` defines the 40-method `LocalStore` port and 771 lines of record types; `storage-browser` implements them and its row types are aliases of those types (`DraftRow = Draft & {...}`, `FileRow = LocalAcceptedFile`). Two packages describe one thing, and the split forces an inverted dependency where `storage-browser` depends on `sync`. |
| `storage-server` | unchanged, minus dead stores                         | Correct as a boundary.                                                                                                                                                                                                                                                                                                                                   |
| `api`            | `api-contract` + `api-client` + `tools/sdk-codegen`  | Merge. One package that owns `openapi.yaml`, emits the server index with shared `$defs`, and emits the client. The boundary check already forbids the server from importing the client and the web from importing the contract; keep those rules as export subpaths.                                                                                     |
| `markdown`       | unchanged                                            | Genuinely reusable and genuinely isolated.                                                                                                                                                                                                                                                                                                               |
| `editor` + `ui`  | merge into `ui`                                      | `editor` declares no workspace dependency at all and is only consumed by `web`. Two packages for one presentation layer.                                                                                                                                                                                                                                 |

### Why not merge further

`core` must stay separate: `tools/check-boundaries.mjs:44-52` proves
transitively that it reaches no Node built-in and no server-only package, which
is what lets the same validation run in the browser and on the server. That is a
real property, cheaply enforced, and worth a package boundary.

`storage-server` must stay separate from `apps/server` so that domain rules
cannot reach a database driver and the migration bundle stays independently
runnable, which is exactly how the Compose command uses it.

### Migration path

1. **Safety first, before any refactor.** BE-01, BE-48, BE-03, BE-04. Add the
   draft staleness check, the Trash screen and the parked-save list. These are
   the launch blockers and they touch code that later steps will move.
2. **Close the deployment defaults.** BE-92, BE-93, BE-94, BE-21. Fix the
   Compose defaults, gate `/metrics`, unmount `/oauth/*` and `/mcp`. One
   afternoon, and it removes 2 of the 3 headline problems.
3. **Delete the dead features.** The 3,440 line list above, in one commit per
   package, contract last. The boundary check and the integration suite will
   catch a mistake immediately. Delete the multi-user tests in the same commits
   as the code they cover.
4. **Squash the migrations** (BE-52). Mechanical, and it removes the journal
   ordering bomb as a side effect. Do this while no real installation exists.
5. **Shrink the contract emit** (BE-81, BE-83). One change in `emit.ts`, verified
   byte for byte by the existing `generated:check`.
6. **Then merge the packages.** Only after 3 to 5, so the merges move less code.
   `sync` plus `storage-browser` first, then the `api` trio, then `editor` into
   `ui`.
7. **Add the missing product surface.** BE-56, BE-57, BE-58: created timestamp,
   server-side sort, Markdown export.

### Trade-offs

**For the merges.** Fewer `package.json` files, fewer build steps, and no more
port types living in a different package from their only implementation. The
`api` merge removes the two TypeScript majors problem (BE-90), because the
generator stops being a separate package with its own toolchain pin.

**Against.** The boundary check currently enforces rules at package granularity.
After a merge, "the web bundle must not contain the contract index" becomes an
export-subpath rule rather than a dependency rule, which is weaker. Mitigation:
keep `tools/check-boundaries.mjs` and extend it to check subpath imports; it
already tracks type positions and computed member access, so the machinery
exists.

**Against deferring MCP.** It is a differentiator, the tool set is well chosen,
and `mcp-operations.ts` is shared correctly between the two adapters. But
shipping an OAuth authorization server with no consent screen is worse than
shipping no MCP. If MCP must ship in v0.1, ship only `apps/mcp-stdio` with a
manually issued agent token, and delete the remote server and OAuth entirely.
That keeps the feature, removes 1,767 lines and removes the P0.

**Against dropping multi-workspace.** It is live, user-visible, and removing it
would touch every primary key. Do not attempt it for v0.1. Note it as the single
largest structural tax and revisit after launch.

## Test gaps

The existing suite is strong where it exists: 467 unit tests, 196 integration
tests against a real digest-pinned PostgreSQL 18.6 with a fresh database per
file under the production three-role model, and a CI-tested backup and restore
round trip. Boundary checks pass 45 of 45. The gaps are concentrated in exactly
the areas where the findings above live.

### Blocking gaps

1. **No test that a stale save does not lose the other device's content.**
   `packages/core/src/files/commit.test.ts:363` asserts the lossy behaviour as
   correct, and `tests/integration/browser-storage.test.ts:395` asserts the
   two-tab fork as correct. The behaviour is tested; the loss is not named.
2. **No test that a draft does not shadow newer server content.** The exact
   sequence of BE-01 is untested.
3. **No test for a stale delete after newer remote edits**, and none for a stale
   edit resurrecting a deleted note.
4. **No test for delete, then find, then restore.** `tests/integration/history.test.ts:100`
   restores a revision of a live file. The journey a user needs does not exist,
   so it cannot be tested.
5. **No test that `/oauth/authorize` requires consent** or that a cross-site
   navigation cannot obtain a code. `tests/integration/mcp.test.ts:277` tests
   only the happy-path PKCE flow.
6. **No test that `/metrics` requires authentication.** Nothing asserts anything
   about that route.
7. **No test that the sign-in answer omits the session token.**
   `withoutSessionToken` has no unit test and no integration assertion.
8. **No test that `bootstrapOwner` cannot create a second account** when one
   exists, and none of the bootstrap-versus-setup race. BE-23 would have been
   caught.
9. **No test that a purge leaves attachment bytes off the disk** (BE-50) and
   **none that a purge leaves a concurrent upload alone** (BE-49).
10. **`workspace_usage.bytes_used` is never asserted after a purge**, which is
    exactly where BE-64 lives.
11. **Playwright never runs in CI.** `verify` omits `test:e2e`, so the browser
    journeys that `AGENTS.md` requires for every P0 journey do not gate a merge.
    Five spec files also carry project skips.

### Weakened assertions to tighten

- `tests/integration/storage.test.ts:553` asserts `total >= 2` recorded
  migrations. With 11 on disk this would pass while 9 were silently skipped. It
  is the assertion that should have caught BE-52.
- `tests/integration/attachments.test.ts:868` asserts only that the reclaim
  results are numbers. It proves no throw, not that nothing was double-reclaimed.
- `tests/integration/row-access.test.ts:254` accepts either a permission error or
  a readable row, so it cannot fail on a policy regression.
- `tests/integration/row-access.test.ts:410` runs `explain` and asserts only that
  the plan is non-empty.
- `tests/integration/support/database.ts:283` returns -1 for a missing row instead
  of throwing, so a query returning nothing degrades into a comparison with -1.

### Modules with no test at all

`packages/storage-browser/src/local-store.ts` (2,248 lines) and `migrations.ts`
(615) have no unit test, only integration coverage.
`packages/storage-server/src/workspace-store.ts` (2,399), `attachments.ts` (522),
`identity-store.ts` (845) and `snapshots.ts` (366) have none, so pure logic like
`titleKey`, `domainFailure` and `postgresFailure` has no fast test.
`packages/sync/src/queue.ts` (388) has no unit test; `engine.test.ts` covers it
indirectly and does not cover the two-tab batch rejection.
`apps/server/src/write-pause.ts` (232), `observability.ts` (222),
`auth/actor.ts` (286) and `auth/better-auth.ts` (448) have no test file,
although `redactUrl`, `checkWriteOrigin`, `bearerSecret` and the trusted-origin
derivation that commit f775aed changed are all exported and security-relevant.
`packages/api-contract`, `packages/api-client` and `tools/sdk-codegen` each
declare a `test:unit` script and contain no test.

### Untested guarantees the documentation promises

- All six generate-time contract guards (a parameter without `style` and
  `explode`, a write body without `additionalProperties: false`, a body operation
  without 413 and 415, more than one request media type, a duplicate
  `operationId`, a non-exact status) are implemented and none is tested. A
  refactor could disable any of them silently.
- No check for an orphan component in the merged contract, which is why
  `AuthRedirect` survived.
- Six contract operations have no test that reaches the server:
  `updatePreferences`, `listAgentTokens`, `createWorkspace`, `updateWorkspace`,
  `deleteWorkspace`, `previewPurge`.
- No sweep asserting that every guarded operation answers 401 without a
  credential.
- No test that the MCP tool schemas resolve against the contract, which is the
  exact failure the silent UUID fallback hides (BE-87).
- Search quality is untested: no assertion on ordering, excerpt content,
  stemming, prefix behaviour, or a Markdown-syntax false positive.
- Backlink staleness is untested for a title link written before its target
  exists, or after a rename or a delete (BE-60).
- Concurrent migration runs, and the journal timestamp ordering, are untested.
- Two writers racing on the same file is untested;
  `tests/integration/storage.test.ts:339` uses four distinct files.
