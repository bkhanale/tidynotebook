# 001: Initial Implementation Plan

**Goal:** Build notesapp with local offline editing, immutable file history, one-pane Markdown live preview, and full web, API, and MCP access.

**Architecture:** Use a TypeScript monorepo with a modular server, React web client, and local MCP adapter. PostgreSQL holds accepted state and revision history; a private volume holds attachments. IndexedDB holds drafts, checkpoints, and the sync queue, and all application HTTP calls use the OpenAPI-generated client.

**Tech stack:** Use the exact dependency baseline and compatibility exceptions in the design: Node, TypeScript, pnpm, React, Vite, CodeMirror, Fastify, OpenAPI, Hey API, PostgreSQL, Drizzle, Dexie, Better Auth, and the MCP SDK. Verify registry releases at installation; record compatibility evidence before changing a selected version.

**Design:** [001: Initial design](../design/001-initial-design.md). Read both documents before execution.

**Status:** Planned and self-reviewed. No implementation tasks have run.

**Location:** Execute in this repository. Keep this plan and any later plans under `docs/plans`. Do not create a separate repository, worktree, or Obsidian task directory for this work.

## Global Constraints

The following constraints are copied from the design. Each task includes them.

- Offline editing, file version control, an OpenAPI-generated client, and one-pane live Markdown editing are required.
- The server administrator is trusted to read notes.
- Pin direct dependencies and the package manager, and generate a frozen lockfile during implementation.
- Recheck registry versions immediately before that install.
- Do not use prereleases or force incompatible nested dependencies to newer major versions.
- Keep SDK generation in a separate tooling workspace with TypeScript 6.0.3.
- Use strict TypeScript, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- Enforce an acyclic import graph with lint rules and package exports.
- Do not maintain parallel handwritten TypeBox or Zod request definitions.
- Do not write endpoint-specific `fetch`, Axios calls, URL builders, request serializers, response interfaces, or duplicate API wrappers by hand.
- There is no split-screen editor or separate preview workflow.
- Dark mode uses Tokyo Night Night.
- Light mode uses Tokyo Night Day.
- Each accepted checkpoint is immutable.
- There is no automatic last-write-wins rule or silent text merge.
- Export is a separate future feature.
- Until then, do not create E2E spec files, fixtures, browser harness configuration, or CI jobs, and do not run E2E tests.

The last constraint refers to explicit user authorization at the final E2E stage. Approval to execute this plan does not authorize that stage. Do not install Playwright or create its configuration before Task 23. Unit and integration tests belong in the task that implements their capability. Do not impose a test-first sequence.

Use simple technical English without em dashes or en dashes. Use conventional commits. Never force push. Do not publish images, deploy to an external host, push commits, or open a PR without session authorization for that action. Local builds and disposable test services are implementation checks.

## Repository baseline and execution rules

On 2026-09-05, `git fetch origin` succeeded and `git ls-remote --heads origin` returned no branches. The local `main` branch has no commits. There is no remote target SHA to cite. The repository contains only `docs/design/001-initial-design.md` before this plan. No package manager, scripts, CI, source files, or test conventions exist yet.

Task 1 establishes commands; later commands are planned interfaces, not claims that they work today. This is notesapp, so do not apply the Requestly `staging` branch rule. Fetch again before allocating migration IDs or preparing a merge. Let Drizzle generate migration filenames against the then-current migration journal. This plan deliberately assigns no SQL migration sequence numbers.

Use package names `@notesapp/web`, `@notesapp/server`, `@notesapp/mcp-stdio`, `@notesapp/api-contract`, `@notesapp/api-client`, `@notesapp/core`, `@notesapp/storage-server`, `@notesapp/storage-browser`, `@notesapp/sync`, `@notesapp/markdown`, `@notesapp/editor`, `@notesapp/ui`, and `@notesapp/sdk-codegen`. Each package owns `package.json`, `tsconfig.json`, and `src/index.ts` when first created. Feature tests use adjacent `*.test.ts` files; service integration tests use `tests/integration/*.test.ts`.

Each task is a review unit. Tick its steps and heading only after its checks pass. Split a step into small code changes within that task when needed. Commit only the task's reviewed files using the supplied conventional commit message. Do not stage unrelated user changes. Record actual commands and outcomes beneath the task when executed, including any failure that prevents completion.

The default order is Task 1 through Task 24. Task 12 can run after Task 3 while server work continues. Local record and theme modules can be prepared early, but Tasks 10 and 13 require all their listed dependencies before they can pass review. Such scheduling does not authorize sub-agents. Shared contract edits and migrations must remain ordered.

Additional implementation dependencies checked against the npm registry on 2026-09-05 are `sharp` 0.35.4 for bounded server image inspection, `fake-indexeddb` 6.2.5 for Node storage tests, `diff` 9.0.0 for line comparison, and `@types/mdast` 4.0.4 for the parser's public types. Recheck and pin them at installation under the same policy as the design. Use [Sharp's input limits](https://sharp.pixelplumbing.com/api-constructor/), [fake-indexeddb's injected Dexie backend](https://github.com/dumbmatter/fakeIndexedDB), and [jsdiff's bounded comparison API](https://github.com/kpdecker/jsdiff/blob/master/README.md). These packages support existing design features; they add no product scope.

## Shared interface decisions

Task 3 creates and exports these domain types in `packages/core/src/files/model.ts` and `packages/core/src/identity/actor.ts`. IDs are validated UUID strings at transport and storage boundaries. Domain code does not import generated HTTP types.

```ts
type Role = 'owner' | 'admin' | 'editor' | 'viewer';
type Action = 'read' | 'write' | 'history' | 'share' | 'members' | 'purge';
type Actor = {
  accountId: string;
  grants: ReadonlyArray<{ workspaceId: string; actions: readonly Action[] }>;
};
type ContentRef =
  | { kind: 'markdown'; digest: string; text: string }
  | { kind: 'attachment'; digest: string; objectId: string };
type RevisionInput = {
  id: string; fileId: string; parents: readonly string[];
  path: string; deleted: boolean; content: ContentRef;
  clientTime: string; message: string | null; restoredFrom: string | null;
};
type ChangesetInput = {
  workspaceId: string; mutationId: string; deviceId: string;
  expectedHeads: Readonly<Record<string, string | null>>;
  revisions: readonly RevisionInput[];
};
type AcceptedChangeset = {
  mutationId: string; revisionIds: readonly string[]; cursor: string;
};
type DomainError = {
  code: 'forbidden' | 'stale_head' | 'path_conflict' | 'invalid_path' | 'invalid_graph'
    | 'invalid_content' | 'quota' | 'purged' | 'mutation_reused' | 'not_found';
  fileIds: readonly string[];
};
type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };
```

Implementation note (Task 3, accepted): `Actor` also carries a non-exported verified marker, and only `verifyActor(accountId, grants): Result<Actor>` in `@notesapp/core` can create one, so a parsed request object cannot be passed where an `Actor` is required. Task 5's `resolveActor` must build actors through `verifyActor`. `normalizePath(input, kind = 'note')` accepts `'attachment'` for attachment paths. `validateGraph` accepts one linear or merging chain per file per submission; a device with two local branches for one file submits them as separate branch changesets (Task 8). `validateGraph` cannot see a stored root for a file whose parents were not looked up, so Task 6's `expectedHeads[fileId] === null` check is the rule that prevents a second root.

`expectedHeads[fileId] = null` means that the file must not exist in accepted state. Parents in a submitted chain may refer to earlier revisions in that same chain. Revisions of one file cannot parent revisions of another. Acceptance adds the verified actor and server time; clients cannot supply either field. Store content once per workspace digest rather than duplicate text in every revision row.

Task 2 owns HTTP schemas and generated types. Transport adapters explicitly map those types to the domain types above. Task 10 owns local records, which add account, workspace, working-copy identity, and persistence state. No storage table row becomes a public response by automatic serialization.

## Tasks

### [x] Task 1: Establish the toolchain and verification commands

**Depends on:** Repository baseline only.

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.node-version`, `.gitignore`, `tsconfig.base.json`, `.oxlintrc.json`, `.prettierrc.json`, `tools/run-tests.mjs`, `tools/check-boundaries.mjs`, `tools/check-versions.mjs`, and `docs/development/toolchain.md`. Create package manifests and TypeScript configurations as each following task introduces its package. Generate `pnpm-lock.yaml` from installation.

**Interfaces:** Produces root commands `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm test:integration -- <test-name>`, and `pnpm build`. Package `test:unit` runs its adjacent tests with Node's test runner. Root test discovery fails on a requested test name that does not exist; it must not return a false success.

- [x] Verify the design's selected packages against official registry metadata and release notes. Check Node/pnpm engines, peer ranges, TS 7 compilation, the generator's TS 6 compiler API requirement, and Better Auth's nested utility range. Pin compatible stable releases and record exact versions, source links, and reasons for exceptions in `toolchain.md`.
- [x] Add workspace discovery, strict peer installation, exact direct versions, package exports, and strict TypeScript settings. Configure separate app and SDK generator compiler contexts. Keep Node-only dependencies out of browser package dependency lists.
- [x] Add root command routing and test discovery using Node, including forwarded test names and nonzero exit propagation. Add Oxlint rules plus the boundary checker for package cycles, deep imports, browser-to-server imports, and handwritten application HTTP calls outside generated output. Exempt library protocol adapters and PWA asset handling by exact file responsibility, not a broad directory exception.
- [x] Run `pnpm install`, then `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check`. At this stage checks cover the tooling files and configuration. Confirm that an invalid import fixture supplied to the checker is rejected without committing that fixture as application code.
- [x] Commit: `chore: establish strict workspace tooling`.

Execution record (2026-09-05): commits `26044af`, `22eb5fd`, `7b6939b`, `8ca664c`, `520959b`. Four independent review rounds. Final gate: install with frozen lockfile, typecheck, type-aware lint, format check, 39 unit tests, and build all passed. Decisions recorded in `docs/development/toolchain.md`: handwritten relative imports use `.ts` extensions with `allowImportingTsExtensions` and `rewriteRelativeImportExtensions`; core is browser-safe; test files live in package `src` trees or the root `tests` tree; the root `tsconfig.json` is the tooling context. Computed transport access hidden behind a variable remains a code-review item.

### [x] Task 2: Create OpenAPI generation and the HTTP boundary

**Depends on:** Task 1.

**Files:** Create `packages/api-contract/openapi.yaml`, `packages/api-contract/redocly.yaml`, `packages/api-contract/src/operations.ts`, `tools/sdk-codegen/src/generate.ts`, `tools/sdk-codegen/src/check-generated.ts`, `packages/api-client/src/configure.ts`, `apps/server/src/app.ts`, `apps/server/src/http/register.ts`, `apps/server/src/http/problem.ts`, `apps/server/src/config.ts`, `tests/integration/support/server.ts`, and `tests/integration/contract.test.ts`. Generate validators into `packages/api-contract/src/generated/` and SDK files into `packages/api-client/src/generated/`; never edit generated files by hand.

**Interfaces:** Produces `createApp(config: ServerConfig): Promise<FastifyInstance>` and `configureClient(baseUrl: string, token: (() => Promise<string | undefined>) | undefined): void`. Define `ServerConfig` in `apps/server/src/config.ts` with origin, database URL, storage root, auth secret, allowed hosts, and request limits. Produces root commands `pnpm contract:lint`, `pnpm generate`, and `pnpm generated:check`. Initially register only `getHealth` and `getReadiness`.

- [x] Define OpenAPI 3.1.2, JSON Schema 2020-12, stable operation IDs, RFC 9457 errors, and separate request/response fields. Generate Ajv 2020 validators and the Hey API client using the isolated compiler. Use explicit parameter serialization and reject unknown write fields.
- [x] Apply the design's generated-client compatibility decision: pin `typescript` 6.0.3 exactly in `tools/sdk-codegen`, set `output.module.extension` to `.js` in the generator config, give `packages/api-client` a `composite` tsconfig with `exactOptionalPropertyTypes: false` and declaration output, and expose the package only through `dist` exports. Every consumer uses a project reference and keeps `exactOptionalPropertyTypes: true`. Add a test in `tests/integration/contract.test.ts` or a typecheck fixture that proves a consumer still gets an exact-optional error against a generated request type.
- [x] Implement operation registration from the bundled contract, including body/parameter validation, identity hooks, validated responses, request IDs, and generic server errors. Use exact response status/content type mappings. Binary and HTML responses have explicit media types and size/access checks rather than JSON validation.
- [x] Add a health contract test through the generated client against a real listening Fastify server. Check invalid input, unexpected response fields, cancellation, and operation-to-handler coverage. `generated:check` generates into a temporary directory and compares bytes with committed output, so it also works before the first commit.
- [x] Run `pnpm contract:lint`, `pnpm generate`, `pnpm generated:check`, `pnpm test:integration -- contract`, `pnpm typecheck`, and `pnpm build`. Expect generated TypeScript to compile with the app compiler and no duplicate schema source.
- [x] Commit: `feat: add generated API contract and HTTP boundary`.

Execution record (2026-09-06): commits `66f8ae2`, `2f9b51f`, `f4dd77e`. Three independent review rounds; final verdict Ready. Decisions recorded in `docs/development/api-contract.md` and `toolchain.md`: `x-request-id` accepts `^[A-Za-z0-9._-]{1,128}$` and is echoed; `NOTESAPP_LOG_LEVEL` controls Fastify logging and request headers are never logged; HEAD is served by falling back to the GET operation; every response passes a media-type and payload-kind check in the route wrapper and a member check in `preSerialization`; empty query and body slots are closed; generation fails for write bodies without `additionalProperties: false` or without 413/415; an identity hook slot fails startup for a guarded operation with no resolver; `app.inject()` is accepted for transport-level tests; `skipLibCheck` stays only in `apps/server` and `tests/integration` because of `thread-stream` declarations. The 415 request-body path has unit coverage only until the first operation with a request body lands.

### [x] Task 3: Define domain rules and storage ports

**Depends on:** Task 2.

**Files:** Create `packages/core/src/identity/actor.ts`, `packages/core/src/files/model.ts`, `packages/core/src/files/path.ts`, `packages/core/src/files/graph.ts`, `packages/core/src/files/ports.ts`, `packages/core/src/files/path.test.ts`, `packages/core/src/files/graph.test.ts`, and `packages/core/src/identity/actor.test.ts`.

**Interfaces:** Produces the shared types above, `normalizePath(input: string): Result<string>`, `authorize(actor: Actor, workspaceId: string, role: Role, action: Action): Result<void>`, and `validateGraph(revisions: readonly RevisionInput[], known: ReadonlyMap<string, string>): Result<void>`. The `known` map associates each stored parent revision ID with its file ID. Return `invalid_path` for path failures.

Define `WorkspaceTransaction` with `role(accountId: string): Promise<Role | null>`, `receipt(mutationId: string, accountId: string): Promise<{ digest: string; outcome: AcceptedChangeset } | null>`, `heads(fileIds: readonly string[]): Promise<ReadonlyMap<string, string | null>>`, `parents(ids: readonly string[]): Promise<ReadonlyMap<string, string>>`, `isPurged(fileId: string): Promise<boolean>`, and `accept(actor: Actor, input: ChangesetInput, digest: string): Promise<Result<AcceptedChangeset>>`. Define `WorkspaceStore.transact<T>(actor: Actor, workspaceId: string, run: (tx: WorkspaceTransaction) => Promise<T>): Promise<T>`. `accept` enforces persistent final-path and quota invariants and performs the atomic write; it does not start a nested transaction.

- [x] Implement role/action intersection, with viewer read/history, editor write, admin share/members, and owner purge. Prevent owner removal and ownership changes outside owner use cases. Keep verified grants distinct from user-supplied requests.
- [x] Implement NFC relative paths, `.md` validation for Markdown, traversal and null rejection, and stable IDs. Validate zero parents for a root, one for a normal revision, two for an explicit merge, same-file parents, known or earlier chain parents, and no cycles or duplicate IDs.
- [x] Define the transaction port and map expected domain failures to `Result`. Keep operational failures such as an unavailable database separate for the HTTP adapter to map to a server error.
- [x] Run `pnpm --filter @notesapp/core test:unit`, `pnpm typecheck`, and `pnpm lint`. Test role and grant combinations, NFC collisions, malformed paths, foreign parents, repeated IDs, and valid submitted chains.
- [x] Commit: `feat: define file and access domain boundaries`.

Execution record (2026-09-06): commits `9f47677` and `9c34166`. Independent review verdict Ready; the follow-up commit rejects lone surrogates, Unicode format characters, line separators, and segment edge white space in paths, denies out-of-union roles, makes `verifyActor` return `Result<Actor>`, and adds a compile-time proof under `tools/actor-brand/` that a plain object is not an `Actor`. Core has 46 unit tests. Owner removal and ownership transfer rules are deferred to the Task 5 membership use cases, which the plan already assigns there.

### [x] Task 4: Add PostgreSQL persistence and row access controls

**Depends on:** Task 3.

**Files:** Create `packages/storage-server/src/schema.ts`, `packages/storage-server/src/workspace-store.ts`, `packages/storage-server/src/migrate.ts`, `packages/storage-server/drizzle.config.ts`, `compose.test.yaml`, `tests/integration/support/database.ts`, `tests/integration/storage.test.ts`, and `tests/integration/row-access.test.ts`. Generate SQL and the journal under `packages/storage-server/migrations/` using Drizzle, without a preassigned migration number.

**Interfaces:** Implements `WorkspaceStore` from Task 3. Produces `openWorkspaceStore(databaseUrl: string): WorkspaceStore`, root `pnpm db:generate`, and `pnpm db:migrate --profile test`. The migration command requires an explicit profile; the deployment profile reads protected operator configuration. The test database helper returns distinct migration and runtime connection URLs and destroys only its own disposable database.

- [x] Create the design's file, immutable content/revision, changeset, branch, receipt, purge marker, membership, audit, sync, snapshot, link, share, and attachment tables. Create app-owned account identity rows with UUIDs; Task 5 adds the configured Better Auth tables and identity mapping. Use composite workspace foreign keys, indexed parent references, and unique accepted paths that permit deferred atomic path swaps. Pending branch-only files must not occupy accepted paths.
- [x] Implement migration and runtime roles, transaction-scoped identity, forced row policies where required, and non-recursive membership policies. Runtime credentials cannot migrate or bypass row security. Keep public share lookup as a narrow access path; deny anonymous table reads.
- [x] Implement workspace lock acquisition, actor-bound receipt lookup, quota accounting, immutable inserts, transactional indexes/cursors, and sorted file/object lock order. Use decimal cursor strings in HTTP to avoid JavaScript integer truncation. Add database constraints against cross-workspace references and updates to immutable rows.
- [x] Configure test commands to select only the dedicated Compose test database and reject a production database name or URL. Run `docker compose -f compose.test.yaml up -d --wait`, `pnpm db:migrate --profile test`, `pnpm test:integration -- storage`, and `pnpm test:integration -- row-access`. Test actual runtime credentials, rollback, concurrent commits, identity reset on pooled connections, and migrations on an empty database and the preceding schema when one exists.
- [x] Commit: `feat: persist workspace state with transaction and row controls`.

Execution record (2026-09-06): commits `9914c5d`, `0066de9`, `55b09a1`. Two independent review rounds found and closed: raw driver errors escaping `transact`, note bodies reachable through error causes, an `ALTER ROLE` that a non-superuser migration role cannot run, a superuser test role that hid it, a quota bypass through digest reuse and through negative usage deltas, runtime-role escalation of membership, quota, and cursor rows, a missing composite key on attachment content, and trusted client digests. Decisions recorded in `docs/development/database.md`: live paths in a separate table with a deferrable unique constraint; advisory workspace lock; cursor and usage changes through membership-checked `SECURITY DEFINER` functions; `notesapp_member_role` policies for membership writes; `invalid_content` domain error; migrations `0000` and `0001` edited in place because nothing is deployed; Compose test database runs the production role model with `notesapp_migrate`. 24 storage and 20 row-access integration tests.

### [x] Task 5: Implement accounts, OIDC, workspace roles, and settings

**Depends on:** Task 4.

**Files:** Create `apps/server/src/auth/better-auth.ts`, `apps/server/src/auth/actor.ts`, `apps/server/src/http/accounts.ts`, `apps/server/src/http/workspaces.ts`, `apps/server/src/cli/bootstrap.ts`, `apps/server/src/cli/recover-account.ts`, `packages/core/src/workspaces/service.ts`, `tools/sdk-codegen/src/auth-contract.ts`, `tests/integration/support/identity-provider.ts`, and `tests/integration/identity.test.ts`. Modify the OpenAPI source, operation registry, storage schema, and generated files.

**Interfaces:** Produces `resolveActor(request: FastifyRequest): Promise<Actor | null>`. Contract operation IDs are `getAccount`, `updatePreferences`, `listWorkspaces`, `createWorkspace`, `updateWorkspace`, `deleteWorkspace`, `listMembers`, `inviteMember`, `updateMember`, `removeMember`, `transferOwnership`, `listAgentTokens`, `createAgentToken`, and `revokeAgentToken`. Auth operation IDs come from the pinned Better Auth schema fragment and are recorded in the operation registry, without handwritten duplicate request models. Root CLI commands are `pnpm owner:bootstrap` and `pnpm account:recover`.

- [x] Generate and review the configured Better Auth schema migration, and map its verified users to the app's UUID account identities. Configure local accounts, registration disabled, invitation acceptance, personal workspace creation, SMTP password recovery, and operator recovery. Make bootstrap one-time, and take secrets through hidden input or protected files rather than command arguments or logs. Operator recovery must not bypass an installation's OIDC-only policy.
- [x] Configure administrator-defined OIDC with PKCE, state, nonce, issuer/subject account keys, and signature/audience verification. Disable email-only linking. Generate a deterministic auth contract from pinned configuration without contacting a live provider or embedding secrets.
- [x] Add secure cookie sessions, CSRF/origin protection, expiration, and revocation. Add expiring scoped agent tokens stored as hashes. Map cookie sessions and tokens into verified actors. Apply membership writes under the same workspace lock as content commands. Add theme preference storage and owner-only transfer/delete.
- [x] Regenerate the client. Run `pnpm test:integration -- identity`, `pnpm test:integration -- row-access`, `pnpm generated:check`, and `pnpm typecheck`. Cover OIDC failures, invitation replay, login/logout cookies, local recovery, last-owner protection, role downgrade during a write, token scope denial, and account isolation.
- [x] Commit: `feat: add account and workspace identity controls`.

Execution record (2026-09-06): commits `8e54d5a`, `36a75cb`, `b246967`, `4d256ab`. Three independent security-focused review rounds found no authentication bypass, and found and closed: membership writes outside the workspace lock without sync or audit, a deletion audit destroyed by the delete, a mismatched auth fragment and a raw session token in the get-session response, no product path for an invitee without an account, Better Auth tables readable and writable by the runtime role, a stranger bypass in two `SECURITY DEFINER` guards (null comparison), an origin check lost when `acceptInvitation` became unauthenticated, an undeclared 500 on a bodyless DELETE with a JSON content type, and an unbound account-discard function. Decisions recorded in `docs/development/identity.md` and `database.md`: third database role `notesapp_auth` for the Better Auth pool with narrow lookup functions for the application; declarative auth fragment validated on protocol routes; token-plus-password invitation acceptance with server-side account creation; `account_audit_events` for account-scoped audit; cookie writes require `Origin` or `Sec-Fetch-Site`; `NOTESAPP_AUTH_DATABASE_URL`, `NOTESAPP_SMTP_URL`, `NOTESAPP_OIDC_REQUIRED` configuration. 41 identity and 32 row-access integration tests.

### [x] Task 6: Implement accepted revisions and atomic file changes

**Depends on:** Task 5.

**Files:** Create `packages/core/src/files/commit.ts`, `packages/core/src/files/digest.ts`, `packages/core/src/files/commit.test.ts`, `apps/server/src/http/files.ts`, and `tests/integration/revisions.test.ts`. Modify `workspace-store.ts`, the OpenAPI source, and generated files.

**Interfaces:** Produces `commitChangeset(store: WorkspaceStore, actor: Actor, input: ChangesetInput): Promise<Result<AcceptedChangeset>>`. Operation IDs are `listFiles`, `getFile`, `getRevision`, `createFile`, `updateFile`, `deleteFile`, and `commitChangeset`. All single-file write handlers map to the same changeset use case. Read schemas expose selected metadata and Markdown, never storage paths.

- [x] Server-side digest verification is mandatory (Task 4 review finding): content is deduplicated per workspace digest, so a client that reuses a stored digest with different text would otherwise make its revision resolve to the earlier bytes. `accept` verifies Markdown digests and returns the `invalid_content` domain error; `commitChangeset` must reject before storage as well, and HTTP maps `invalid_content` to 422.
- [x] Define SHA-256 content digests over UTF-8 Markdown or original attachment bytes. For a request digest, recursively sort object keys, preserve array order and explicit nulls, exclude transport-only fields, serialize validated values to UTF-8, and hash them with the operation identity and preconditions. Reject non-finite numbers through the schema. Require strong `If-Match` on existing-file HTTP writes and per-file expected heads on batch sync; missing preconditions return 428 and stale heads return 412.
- [x] Implement this transaction order, using the ports from Task 3:

```text
lock workspace, mutation identity, sorted affected files
check current role and grants
read actor-bound receipt
if receipt exists: compare digest; return its prior outcome or mutation_reused
check purge markers, parents, all expected heads, final paths, and quota
insert immutable content/revisions and assign verified actor/server time
advance all heads, update indexes, allocate cursor, store receipt
commit once; return exact accepted revision IDs
```

- [x] Implement create, rename, delete, named checkpoints, and folder changes up to 1,000 files. Store deletion as a revision, revoke associated shares, and remove accepted search entries within the transaction. Reserve control-operation capacity at quota. A full workspace cannot accept new content through a disguised delete.
- [x] Run `pnpm --filter @notesapp/core test:unit` and `pnpm test:integration -- revisions`. Test lost response replay after later heads, changed digest reuse, stale heads, a 1,000-file rename, atomic path swaps, rollback on one conflict, forged actor fields, and quota-safe deletion. Run contract generation and checks.
- [x] Commit: `feat: add immutable revisions and atomic file changes`.

Execution record (2026-09-06): commits `66f63b4` and `b89f000`. One review round found and closed: write-only token 403 response, tombstones carrying new Markdown, `If-Match: *` handling, and denied read disguised as 412. Decisions recorded in `docs/development/files-and-revisions.md`: write responses built from the accepted result returned by the use case; note tombstones must be empty; tag lists accepted in `If-Match`. 344 unit tests and 29 revision integration tests pass.

### [x] Task 7: Implement immutable attachment transfer and cleanup

**Depends on:** Task 6.

**Files:** Create `packages/storage-server/src/attachments.ts`, `packages/core/src/files/attachments.ts`, `apps/server/src/http/attachments.ts`, `apps/server/src/jobs/inspect-image.ts`, `apps/server/src/jobs/attachment-cleanup.ts`, and `tests/integration/attachments.test.ts`. Modify the contract and generated client.

**Interfaces:** Produces operation IDs `uploadAttachment`, `finalizeAttachment`, and `getAttachmentRevision`. Upload returns object identity and verified digest; finalization creates an immutable attachment revision through the file transaction. Authenticated reads return binary content with declared MIME type and immutable revision identity. Produces `reclaimAttachments(now: Date): Promise<number>` as a composition-bound job function.

- [x] Stream uploads to private temporary files, enforce 20 MiB and 40 megapixels, and inspect them with Sharp using an explicit pixel limit and accepted format list. Reject SVG, inconsistent media declarations, and malformed files. Include animation frame dimensions in the resource check. Keep inspection in a bounded child process with a timeout, retain original validated bytes, and never trust the declared MIME type alone.
- [x] Verify the digest before finalization. Make bytes immutable and deduplicate only inside one workspace. Permit note revisions to reference only finalized attachment revisions in their workspace. Replacing an attachment produces a new revision ID.
- [x] Use workspace/object locking for both reference creation and cleanup. Reclaim temporary and finalized unreferenced objects after 24 hours; retain every object referenced by history, branches, or shares. Persist cleanup state so interrupted file deletion is safe to retry.
- [x] Run `pnpm test:integration -- attachments` and `pnpm generated:check`. Test generated multipart serialization, binary response types, truncation, forged MIME, oversize dimensions, duplicate finalization, cleanup races, quota accounting, old revision reads, and denied cross-workspace access.
- [x] Commit: `feat: add versioned attachment storage`.

Execution record (2026-09-06): commit `68cd2c1`. 344 unit tests, 14 attachment integration tests, and 177 total integration tests pass. Verification proves streaming upload, image dimension and format limits in worker subprocess, multipart handling, receipt replay before precondition validation, quota limits, deduplication in workspace, and background reclamation.

### [x] Task 8: Implement branches, history, restore, and permanent deletion

**Depends on:** Task 7.

**Files:** Create `packages/core/src/history/service.ts`, `packages/core/src/history/purge.ts`, `packages/core/src/history/service.test.ts`, `apps/server/src/http/history.ts`, and `tests/integration/history.test.ts`. Modify persistence, the contract, and generated files.

**Interfaces:** Operation IDs are `listHistory`, `createCheckpoint`, `listBranches`, `submitBranch`, `resolveBranches`, `restoreRevision`, `previewPurge`, and `purgeFiles`. Branch input uses `ChangesetInput` plus `conflictGroupId: string`; it preserves submitted IDs and does not advance accepted heads. Merge input includes both tips and expected current heads. Purge preview returns affected IDs and blocking references; purge revalidates them inside its transaction.

- [x] Store divergent checkpoint chains and complete multi-file conflict groups atomically. Support branch-only new files without reserving a live path. Require same-workspace and same-file parents, and retain branches after failed resolution.
- [x] Implement a merge as a new revision with two parents and a restore as a child of the current head with `restoredFrom`. Require explicit final paths and head preconditions. Return historic content and authors through paginated permission-checked reads.
- [x] Add owner-only purge with a content-free permanent marker. Reject attachment purge while retained revisions outside the purge set refer to it. Remove shares and branches before reclaiming bytes, preserve audit/receipt metadata without note content, and reject late writes with 410. Workspace deletion revokes sessions' workspace access and removes its records as a controlled operation.
- [x] Run `pnpm --filter @notesapp/core test:unit` and `pnpm test:integration -- history`. Cover edit/delete conflicts, atomic group resolution, resolution races, restore without rewind or republish, attachment blockers, full-quota purge, and late offline writes after purge.
- [x] Commit: `feat: add conflict history and explicit recovery`.

Execution record (2026-09-06): commit `3c3daa6`. Checks: typecheck, lint, format check, contract lint, generated check, 353 unit tests, 12 history integration tests, plus revisions (29) and attachments (14) regression checks. Fixed lint (await test, unused, any) and removed debug log in history handler.

### [x] Task 9: Implement consistent snapshots and incremental sync reads

**Depends on:** Task 8.

**Files:** Create `packages/core/src/files/snapshot.ts`, `packages/storage-server/src/snapshots.ts`, `apps/server/src/http/sync.ts`, `apps/server/src/jobs/sync-cleanup.ts`, and `tests/integration/snapshots.test.ts`. Modify the contract and generated files.

**Interfaces:** Operation IDs are `startSnapshot`, `getSnapshotPage`, and `getChanges`. Snapshot responses contain token, expiry, immutable revision IDs, cursor, and pagination position. Change responses contain ordered changes, next cursor, and a documented `snapshot_required` error for expired cursors. Reuse `getRevision` for content transfer.

- [x] Capture accepted metadata and the workspace high-water cursor in one repeatable-read transaction. Materialize bounded metadata pages for 15 minutes. Recheck current membership on every page and content read; do not hold a database transaction open across network pages.
- [x] Allocate incremental cursors under the workspace lock used by every relevant write, including membership, deletion, and share revocation. Keep events for 90 days and retain accepted receipts until account/workspace purge. A snapshot cursor covers exactly the captured state.
- [x] Add pagination limits and admission limits per account/workspace. Clean expired snapshots and old events without deleting content history. Reject unsupported sync versions before applying a mutation.
- [x] Run `pnpm test:integration -- snapshots`. Interleave late commits and page reads; prove no skipped event, no mixed current-head content, correct expiry, denied revoked access, and preserved histories beyond the event window. Run `pnpm generated:check`.
- [x] Commit: `feat: add consistent workspace sync snapshots`.

Execution record (2026-09-06): commit `8a01e85`. Checks: typecheck, lint, format, contract lint, generated check, 364 unit tests, 8 snapshots integration tests, plus history (12), revisions (29), storage (24) regression checks.

### [x] Task 10: Implement local drafts, checkpoints, and queue persistence

**Depends on:** Tasks 3 and 9 for final contract mapping.

**Files:** Create `packages/sync/src/local-port.ts`, `packages/storage-browser/src/database.ts`, `packages/storage-browser/src/migrations.ts`, `packages/storage-browser/src/local-store.ts`, `packages/sync/src/checkpoints.ts`, `packages/sync/src/checkpoints.test.ts`, and `tests/integration/browser-storage.test.ts`.

**Interfaces:** Define `Draft = { accountId: string; workspaceId: string; workingCopyId: string; fileId: string; baseRevisionId: string | null; text: string; path: string; deleted: boolean; sequence: number }` and `QueueEntry = { accountId: string; input: ChangesetInput; state: 'pending' | 'sending' | 'conflict'; digest: string | null }`. Define `LocalStore.saveDraft(draft: Draft): Promise<void>`, `checkpoint(draft: Draft, message: string | null): Promise<QueueEntry | null>`, `pending(accountId: string, workspaceId: string): Promise<readonly QueueEntry[]>`, and `acknowledge(accountId: string, result: AcceptedChangeset): Promise<void>`. Define `openLocalStore(serverOrigin: string): Promise<LocalStore>` in browser storage.

- [x] Create versioned Dexie tables for drafts, immutable checkpoints, contents/blobs, accepted metadata, branches, queue, receipts, staged snapshots, cursors, preferences, and recovery state. Partition all private keys by origin/account/workspace. Validate stored records when read or migrated.
- [x] Save drafts within the 150 ms target; save checkpoint content, parents, and queue metadata in one transaction. Checkpoint after 750 ms idle, every 30 seconds of continuous editing, Save, and file leave. Do not coalesce immutable checkpoints. Named unchanged checkpoints remain valid.
- [x] Give each working copy its own ID. Use transactional local head checks to preserve concurrent tab edits as branches. Acknowledge whole changesets atomically and preserve drafts/checkpoints created after submission. Inject clocks and ID sources for tests.
- [x] Run `pnpm --filter @notesapp/sync test:unit` and `pnpm test:integration -- browser-storage`. Inject `fake-indexeddb`'s `indexedDB` and `IDBKeyRange` into Dexie for Node module tests; this does not establish real browser durability. Test aborted transactions, full storage, concurrent working copies, interruption during migration, duplicate acknowledgment, and unchanged checkpoint suppression.
- [x] Commit: `feat: persist local drafts and immutable checkpoints`.

Execution record (2026-09-06): implemented in `e7f6790`, final review after Task 9. Checks: sync unit 14 pass, browser-storage integration 12 pass, typecheck/lint/format clean. No contract change needed; staged snapshot table already reserved for Task 11.

### [x] Task 11: Implement the foreground sync state machine

**Depends on:** Task 10.

**Files:** Create `packages/sync/src/engine.ts`, `packages/sync/src/snapshot.ts`, `packages/sync/src/queue.ts`, `packages/sync/src/lease.ts`, `packages/sync/src/engine.test.ts`, and `tests/integration/sync.test.ts`. Modify the local storage port and adapter together for staged snapshot and lease operations.

**Interfaces:** Produces `createSyncEngine(local: LocalStore, accountId: string, workspaceId: string): { run(signal: AbortSignal): Promise<void>; stop(): void }`. Network operations are direct imports of generated functions from Tasks 5 through 9; do not introduce a handwritten transport wrapper. Extend `LocalStore` with `acquireLease(ownerId: string, expiresAt: number): Promise<boolean>`, `releaseLease(ownerId: string): Promise<void>`, `stageSnapshot(token: string, revisionIds: readonly string[], cursor: string): Promise<void>`, and `activateSnapshot(token: string): Promise<void>`; activation checks all required content exists and preserves local work.

- [x] Verify session/membership, finalize pending assets, submit fixed mutations in parent order, and acknowledge exact results. Serialize all affected files of a batch. Freeze the mutation body and digest on first send; retry that same identity after lost responses.
- [x] Classify network/temporary failures for bounded exponential backoff with jitter. Pause on 401; recover on role loss; preserve conflict groups on 412/path collision; preserve local copies on quota, purge, or invalid graph errors. Submit branches explicitly rather than repeatedly retrying a stale head write.
- [x] Stage snapshots and fetch their immutable revisions. Activate only complete snapshots, then pull ordered changes on start/focus/reconnect and every 15 seconds. Never replace a dirty working copy with a remote head. Renew a transactional worker lease and permit takeover after failure; messages only announce state changes.
- [x] Run `pnpm --filter @notesapp/sync test:unit` and `pnpm test:integration -- sync` against the actual generated client and disposable server/database. Test offline A/B changes, dropped accepted response, lease takeover, later local edits during acknowledgment, purged assets needing upload, expired cursor, and incomplete snapshot restart.
- [x] Commit: `feat: sync offline changes without losing revisions`.

Execution record (2026-09-06): commit `6faeb96`. Checks: 380 unit pass (30 sync), 7 sync integration pass, browser-storage 12 pass, typecheck/lint/format/boundaries/build clean. Deviation: stageSnapshot takes accountId/workspaceId for partition rule.

### [x] Task 12: Build the shared Markdown parser and safe renderer

**Depends on:** Task 3.

**Files:** Create `packages/markdown/src/parse.ts`, `packages/markdown/src/render.ts`, `packages/markdown/src/links.ts`, `packages/markdown/src/policy.ts`, `packages/markdown/src/corpus.test.ts`, and `packages/markdown/test-data/content.md`.

**Interfaces:** Define `SourceRange = { from: number; to: number }` and `NoteLink = { range: SourceRange; label: string; targetId: string | null; source: string }`. Produces `parseMarkdown(source: string): Root` using the upstream mdast `Root` type, `extractLinks(source: string): readonly NoteLink[]`, and `renderMarkdown(source: string): Promise<string>` returning sanitized HTML. Use `/notes/<file-uuid>` for stable note references and `/attachments/<revision-uuid>` for immutable image references in stored Markdown; the UI intercepts these references and uses generated operations to load content.

- [x] Compose CommonMark, GFM, footnotes, math, and fenced code parsing with source offsets. Preserve unknown syntax and front matter as text. Extract ID links and unresolved wiki-link references without fetching targets.
- [x] Disable raw HTML/MDX/plugins, reject unsafe URL schemes, sanitize rendered output, and add fixed resource limits. Keep attachment references as approved internal references resolved by the caller, not arbitrary server fetches. External images remain unloaded until explicit action.
- [x] Build a shared corpus with nested lists, tables, escaping, Unicode, malformed fences, footnotes, unsafe URLs, raw HTML, and unresolved links. Check both source ranges and rendered output rather than relying on broad snapshots.
- [x] Run `pnpm --filter @notesapp/markdown test:unit`, `pnpm typecheck`, and `pnpm lint`. Require safe output, exact source range mapping, and intact original Markdown after parsing.
- [x] Commit: `feat: add shared safe Markdown parsing`.

Execution record (2026-09-06): commits `8b1760e`, `4e5c07d`, `6a4dfb8`, `b06635b`, `0d03776`, `d9d79d0`. Six independent review rounds; final verdict Ready. The sanitizer and URL policy passed about 60 adversarial inputs from the first round unchanged. Resource limits were the repeated finding: micromark parsing is quadratic for several ordinary shapes, so `packages/markdown/src/limits.ts` now runs a source pre-scan before every entry point with measured caps (1 MiB input, 64 KiB line and paragraph, 1,000 delimiter run, 100 nesting levels, 2,000 links, 2,000 table rows, 10,000 table cells, 100 table columns, 5,000 list lines, 15,000 blocks, 2,000 inline delimiters per block and 100,000 per document, and a combined cost score at or below 2.3). Every at-cap shape renders in about one second and every out-of-cap shape is refused in under 100 ms; measurements are recorded in `docs/development/toolchain.md`. Deviations recorded there: corpus as a TypeScript template literal, `MarkdownLimitError` instead of a result variant, math and Mermaid as placeholders until Task 15, external images as placeholders, `#fragment` links blocked until heading slugs exist (Task 18 follow-up), `@types/<name>` accepted by the boundary checker for type-only imports.

### [x] Task 13: Build the Tokyo Night shell and account screens

**Depends on:** Tasks 5 and 11.

**Files:** Create `packages/ui/src/tokens.css`, `packages/ui/src/theme.ts`, `packages/ui/src/controls.tsx`, `packages/ui/src/theme.test.ts`, `packages/ui/THIRD_PARTY_LICENSES.md`, `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`, `apps/web/src/router.tsx`, `apps/web/src/features/accounts.tsx`, `apps/web/src/features/workspaces.tsx`, and `apps/web/src/features/shell.tsx`.

**Interfaces:** Produces `resolveTheme(choice: 'system' | 'light' | 'dark', prefersDark: boolean): 'light' | 'dark'`. Web composition configures the generated client, local store, and sync engine. Screens consume generated account/workspace operations; they do not create a second network layer.

- [x] Add React routing, responsive sidebar/drawer, workspace selector, recent files, file tree, status region, and collapsible outline/backlinks region. Add login/OIDC redirect, invitations, member roles, owner controls, theme settings, and agent token management with one-time secret display.
- [x] Copy Tokyo Night Night/Day tokens and the upstream license. Derive semantic text/control colors that meet WCAG contrast, apply the saved preference before paint, and sync preferences without delaying local changes. Use system fonts or locally served font assets.
- [x] Connect account and workspace loading to generated operations and local snapshot status. Keep unknown or unavailable notes distinct from empty files. Show viewer controls as read-only and clear private screen state when accounts change.
- [x] Run `pnpm --filter @notesapp/ui test:unit`, `pnpm typecheck`, and `pnpm build`. Check theme resolution and contrast calculations with unit tests. Inspect the shell manually for keyboard focus, reduced motion, touch controls, and responsive layout; do not add a browser harness.
- [x] Commit: `feat: add Tokyo Night application shell`.

Execution record (2026-09-06): commit `851471e`. Checks: typecheck, lint, format, 396 unit (16 ui), build with web bundle.

### [x] Task 14: Build one-pane live editing and local save feedback

**Depends on:** Tasks 10, 12, and 13.

**Files:** Create `packages/editor/src/create-editor.ts`, `packages/editor/src/live-preview.ts`, `packages/editor/src/commands.ts`, `packages/editor/src/live-preview.test.ts`, `apps/web/src/features/note-editor.tsx`, and `apps/web/src/features/save-status.tsx`.

**Interfaces:** Produces `createEditor(parent: HTMLElement, initialText: string, onChange: (text: string) => void): EditorView` using CodeMirror's `EditorView`. The web screen connects changes to `LocalStore.saveDraft` and checkpoint scheduling. Editor commands operate on CodeMirror transactions and receive callbacks for navigation; they do not import the API client or storage packages.

- [x] Implement viewport-based marker decorations for headings, emphasis, lists, tasks, and links. Reveal syntax in the active selection and preserve source outside it. Toggle tasks through editor transactions and activate links through modifier click or an explicit touch action.
- [x] Keep one editor instance per open working copy. Preserve undo, IME composition, selection, and Markdown clipboard content across React rerenders and theme changes. Never replace the document just to update a decoration.
- [x] Bind file create/edit/rename/delete, Save, leave-file checkpoint, and the local queue. Show Saving on this device until a transaction commits, Saved on this device after it, and Saved to server only for the acknowledged content. On storage failure keep the buffer and clipboard access and block unsafe reload.
- [x] Run `pnpm --filter @notesapp/editor test:unit`, `pnpm --filter @notesapp/sync test:unit`, and `pnpm build`. Unit-test decoration ranges and editor state transactions. Manually inspect inline editing and composition during development; reserve automated browser journeys for Task 23.
- [x] Commit: `feat: add source-preserving live Markdown editor`.

Execution record (2026-09-06): commit `4c039a3`. Checks: 411 unit (15 editor), typecheck/lint/format/build clean.

### [x] Task 15: Add inline images, tables, math, and Mermaid

**Depends on:** Tasks 7 and 14.

**Files:** Create `packages/markdown/src/math.ts`, `packages/markdown/src/math.test.ts`, `packages/editor/src/widgets.ts`, `apps/web/src/features/attachment-content.ts`, `apps/web/src/diagram/frame.ts`, `apps/web/src/diagram/frame.html`, and `packages/editor/src/widgets.test.ts`. Modify renderer policy, Vite entries, and editor composition.

**Interfaces:** Produces `renderMath(source: string, display: boolean): string` returning sanitized KaTeX markup, and `loadAttachment(revisionId: string, signal: AbortSignal): Promise<{ url: string; dispose(): void }>` in web composition using the generated binary operation and local blobs. Define frame messages as `{ requestId: string; source: string; theme: 'light' | 'dark' }` and `{ requestId: string; ok: boolean; height: number }`; no arbitrary HTML is returned to the parent.

- [x] Add accessible inline widgets for images, tables, math, and diagrams that expose their source region on focus/click. Implement local paste/upload before network transfer and dispose object URLs when widgets close.
- [x] Use direct KaTeX with trust disabled, input/macro limits, and a math-aware sanitization schema. Render Mermaid in a sandboxed frame with strict configuration, no origin privileges or note-controlled settings, bounded graph size/time, and source fallback after failure. Validate message source and request ID.
- [x] Defer rich module loading, retain required modules for later offline precaching, and apply Tokyo Night colors. External images require explicit loading; importing one requires user-supplied bytes without a server URL proxy. Preserve unknown or oversized blocks as editable source in the same pane.
- [x] Run Markdown/editor unit tests and `pnpm test:integration -- attachments`, then `pnpm build`. Test math sanitization, widget source boundaries, failed rendering, fixed frame message schemas, and old attachment revision selection. Check focus entry and source editing manually.
- [x] Commit: `feat: render rich Markdown inside the editor`.

Execution record (2026-09-06): commit `65e4b91`. Checks: 430 unit, attachments 14, typecheck/lint/format/build clean.

### [x] Task 16: Add history and conflict resolution screens

**Depends on:** Tasks 8, 11, and 15.

**Files:** Create `packages/editor/src/unified-diff.ts`, `packages/editor/src/unified-diff.test.ts`, `apps/web/src/features/diff-worker.ts`, `apps/web/src/features/history.tsx`, `apps/web/src/features/conflicts.tsx`, and `apps/web/src/features/purge.tsx`.

**Interfaces:** Define `DiffHunk = { before: readonly string[]; after: readonly string[]; beforeStart: number; afterStart: number }` and `DiffResult = { kind: 'complete'; hunks: readonly DiffHunk[] } | { kind: 'limit' }`. Produces `compareLines(before: string, after: string): DiffResult`. Screens consume generated history/branch/restore/purge operations and locally stored pending checkpoints. The merge result is submitted as a changeset with both tips and current expected heads.

- [x] Add paginated server history, local pending history, named checkpoints, old revision viewing, and restore. Preserve the current draft when opening history. Offer binary revision selection for attachments.
- [x] Run jsdiff line comparison in a worker with a 500 ms timeout and a 10,000-edit limit. Preserve whitespace and line endings and map library changes into `DiffHunk` records. Show one unified inline diff in the main pane. On a limit, show a message and permit explicit whole-version selection or source editing while retaining both branches. Permit hunk selection or editing, display every file in a conflict group, and require final paths for collisions. If heads move again, retain the edited result and return to resolution.
- [x] Add deletion history and owner purge preview/confirmation with blockers and backup retention text. After a purge rejection, preserve local work for explicit creation under a new file ID. Do not label a copied local recovery file as a server restore.
- [x] Run editor unit tests plus `pnpm test:integration -- history` and `pnpm test:integration -- sync`. Verify line diff behavior, restore parentage, atomic resolution, and a retained draft after a second conflict. Inspect the single-pane flow manually.
- [x] Commit: `feat: add file history and conflict recovery UI`.

Execution record (2026-09-06): commit `80240e4`. Checks: 448 unit, history 12, sync 7, typecheck/lint/format/build clean. Extra file `diff-worker-impl.ts` for real worker bundle.

### [x] Task 17: Complete PWA installation, updates, and offline access recovery

**Depends on:** Task 16.

**Files:** Create `apps/web/src/pwa/service-worker.ts`, `apps/web/src/pwa/lifecycle.ts`, `apps/web/public/manifest.webmanifest`, `apps/web/public/icon.svg`, `apps/web/src/features/offline-status.tsx`, `apps/web/src/features/recovery.tsx`, and `tests/integration/offline-lifecycle.test.ts`. Generate required raster install icons during implementation from the repository SVG. Modify Vite configuration and local migration/lease modules.

**Interfaces:** Define `OfflineReadiness = { markdownComplete: boolean; appAssetsComplete: boolean; attachmentsComplete: boolean }`. Produces `isReadyOffline(state: OfflineReadiness): boolean`, requiring Markdown and application assets; attachment completeness is a separate status. Lifecycle operations include `requestUpdate(): Promise<void>` and `signOut(online: boolean, discardPending: boolean): Promise<void>` in web composition.

- [x] Precache the shell, editor, fonts, math, and diagram modules; cache no private API or public share response. Pin the active workspace's Markdown and expose image/history pin actions and completeness. Support an installed offline launch after provisioning, and never depend on Background Sync.
- [x] Request persistent browser storage and handle denial/eviction. Before updates, persist drafts, stop queue writes, close all tab database connections, and complete the migration transaction. Keep old assets while old clients remain active; show blocked-upgrade instructions without losing drafts.
- [x] Implement session expiry pause, viewer downgrade, removed-access recovery bound to the original account, and clipboard/removal actions. Online logout settles or discards work then revokes and clears. Offline logout requires explicit discard, clears private local data, and sets a sign-out marker; process revocation before restoring account content on reconnect.
- [x] Run `pnpm test:integration -- offline-lifecycle`, `pnpm test:integration -- browser-storage`, and `pnpm build`. Module tests cover readiness, blocked migrations, revocation order, marker persistence, and recovery isolation. Actual browser eviction/install behavior remains required evidence in Tasks 23 and 24.
- [x] Commit: `feat: complete offline PWA lifecycle and recovery`.

Execution record (2026-09-06): commit `6a31f79`. Checks: offline-lifecycle 12, browser-storage 12, unit 448, typecheck/lint/format/build clean.

### [x] Task 18: Implement stable links, backlinks, and search

**Depends on:** Tasks 12 and 17.

**Files:** Create `packages/core/src/search/service.ts`, `packages/storage-server/src/search.ts`, `apps/server/src/http/search.ts`, `packages/sync/src/local-search.ts`, `apps/web/src/features/search.tsx`, `apps/web/src/features/backlinks.tsx`, and `tests/integration/search.test.ts`. Modify accepted-revision index updates and the contract.

**Interfaces:** Operation IDs are `searchFiles` and `getBacklinks`. Define `SearchHit = { fileId: string; path: string; revisionId: string; excerpt: string }` in the domain search module. Produces `searchLocal(query: string, files: readonly { fileId: string; path: string; revisionId: string; text: string }[]): readonly SearchHit[]`. Transport maps domain hits into generated response schemas.

- [x] Add workspace-filtered PostgreSQL text search with the `simple` configuration on accepted titles/content. Update indexes in the acceptance transaction. Exclude deleted files, branch tips, and history from normal results.
- [x] Add wiki-link completion that requires selection for ambiguous titles and writes the stable ID syntax from Task 12. Follow-up from the Task 12 review: the Markdown policy blocks author-written `#fragment` links because rendered headings carry no ids yet. When heading slugs are added (here or in Task 15), allow `^#[A-Za-z0-9_-]+$` against `user-content-` namespaced heading ids and add corpus tests. Keep unresolved references visible. Build backlinks from accepted source revisions and check access to both ends before returning metadata.
- [x] Search downloaded accepted content plus current local drafts offline. Prefer a draft over its accepted version for local results and do not mix accounts/workspaces. Add the search dialog, outline, and backlinks panel without changing editor selection.
- [x] Run `pnpm test:integration -- search` and sync/Markdown unit tests. Verify rename-safe links, ambiguity, no private target metadata, deletion index removal, and pending draft search. Run `pnpm generated:check` and `pnpm build`.
- [x] Commit: `feat: add linked notes and workspace search`.

Execution record (2026-09-06): commit `6ab5270`. Checks: search 5, sync 32, Markdown 133, contract 25, generated check, typecheck/lint/format/build clean.

### [x] Task 19: Implement pinned public sharing

**Depends on:** Task 18.

**Files:** Create `packages/core/src/sharing/service.ts`, `apps/server/src/http/sharing.ts`, `apps/server/src/public/page.ts`, `apps/web/src/features/sharing.tsx`, and `tests/integration/sharing.test.ts`. Modify share row access, Markdown attachment resolution, the contract, and generated files.

**Interfaces:** Operation IDs are `createShare`, `updateShare`, `revokeShare`, `listShares`, `getPublicShare`, and `getPublicAttachment`. Public routes are `/s/{token}` and `/s/{token}/attachments/{revisionId}`. Share responses return a URL only to authorized administrators; persisted records contain its token hash.

- [x] Allow admins/owners to publish an accepted revision, explicitly update its pinned revision, set expiry, and revoke. Bind public image access to the pinned revision's attachment allowlist. Do not permit branch publication.
- [x] Render useful sanitized HTML on the server without the editor bundle. Apply the same rich-content policy, theme tokens, and source fallback. Do not resolve private target titles/snippets. Recheck token, expiry, creator role, file state, and attachment membership on every public request.
- [x] Add no-store, noindex, no-referrer, security headers, and token-redacted access logs. Revoke on accepted file deletion, workspace deletion, or loss of sharing permission. Add UI preview and explicit publication update without republishing on save.
- [x] Run `pnpm test:integration -- sharing`, Markdown tests, and `pnpm generated:check`. Test revoked page/image routes, expiry, unpublished later edits, unauthorized historical attachment requests, creator downgrade, script content, and private target metadata.
- [x] Commit: `feat: add pinned public note sharing`.

Execution record (2026-09-06): commit `b1af1c0`. Checks: sharing (10), history (12), search (5), Markdown (133), generated check, typecheck, lint, format check, and build all clean. Migration 0008 updated with `notesapp_purge_files` to clean search index. Problem details instance set to `/s/redacted` for valid URI reference.

### [x] Task 20: Implement remote and local MCP access

**Depends on:** Task 19.

**Files:** Create `apps/server/src/mcp/server.ts`, `apps/server/src/mcp/authorization.ts`, `apps/mcp-stdio/src/main.ts`, `apps/mcp-stdio/src/tools.ts`, `packages/api-contract/src/mcp-operations.ts`, `tests/integration/mcp.test.ts`, and `docs/development/api-and-mcp.md`.

**Interfaces:** The operation-to-tool map covers workspace/file reads, writes, attachments, search, links, history, checkpoints, branches, merge, restore, and sharing. Tool JSON schemas derive from the shared contract. The remote adapter maps validated input to core use cases; stdio calls generated HTTP functions. Root `pnpm mcp:stdio` starts the local process with a server origin and protected token source.

- [x] Use the selected split MCP SDK packages and their Streamable HTTP/stdio adapters. Verify the designed protocol versions and compatibility mode against the installed SDK. Validate Host/Origin and use the parsed Fastify body; add no custom protocol translator.
- [x] Configure OAuth protected-resource metadata, audience binding, PKCE, consent, and explicit registered clients. Keep browser OIDC login separate from resource authorization. Resolve roles and action grants on each tool call, including direct-core remote calls.
- [x] Expose expected revision preconditions and conflict outcomes to agents. Bound file and attachment responses; do not embed arbitrary note instructions as tool authority. Keep stdio diagnostics off stdout and tokens out of logs and process arguments.
- [x] Run `pnpm test:integration -- mcp` using SDK clients against both transports. Verify content-operation coverage, history/restore, stale writes, scope denial, token revocation, unsupported client behavior, and identical core outcomes through HTTP and remote MCP. Run `pnpm build`.
- [x] Commit: `feat: expose notes through authenticated MCP adapters`.

Execution record (2026-09-06): commit `30f0509`. Checks: MCP integration (6), unit tests (458), all integration tests (237), typecheck (14 workspaces), lint (202 files), boundary check (13 packages), format check, and build all clean.

### [x] Task 21: Package Docker deployment, encryption checks, and recovery

**Depends on:** Task 20.

**Files:** Create `Dockerfile`, `.dockerignore`, `compose.yaml`, `.env.example`, `apps/server/src/main.ts`, `apps/server/src/observability.ts`, `tools/ops/check-host.sh`, `tools/ops/backup.sh`, `tools/ops/restore.sh`, `tools/ops/verify-backup.sh`, `tests/integration/operations.test.ts`, and `docs/operations/self-hosting.md`.

**Interfaces:** Root `pnpm start` starts the production server. Compose provides app, PostgreSQL, and a one-shot migration service; the latter is a deployment step, not a persistent worker. `/health` reports liveness and `/ready` checks configured storage/database/migration readiness. Operator scripts take explicit protected configuration paths and fail if target storage or backup identity is inconsistent.

- [x] Build non-root multi-stage images, pin base image digests, keep PostgreSQL private, and serve web/REST/auth/MCP/public routes on one origin behind the operator's HTTPS proxy. Configure migration completion before readiness and fail closed on missing secrets or storage.
- [x] Document and check host encryption for data, WAL, attachments, persistent temporary files, swap, crash output, and backups. Do not claim that a Docker mount proves encryption. Describe external key storage, unlock, rotation, and recovery without automatic replacement keys.
- [x] Implement a persistent write-pause state used by every mutation and cleanup job. During backup, pause writers, wait for active writes, capture PostgreSQL plus its referenced assets, verify the manifest, then resume. Keep seven daily/four weekly encrypted copies on separate storage; restore into an empty target and verify every referenced object digest.
- [x] Add content-free request/operation logs and metrics for save failures, conflicts, usage, auth failures, and backup age. Redact bodies, query text, credentials, cookies, and share URLs. Run `docker compose config`, local amd64/arm64 builds, `pnpm test:integration -- operations`, and a disposable backup/restore check. Do not publish images or deploy externally during this task.
- [x] Commit: `feat: package self-hosted deployment and recovery`.

Execution record (2026-09-06): commit `99e1e5d`. Checks: typecheck, lint and boundaries, format, Compose configuration, amd64 image build, arm64 image build, and operations integration (9) all clean. The operations test includes an encrypted backup and verified restore against disposable PostgreSQL 18.6. The final amd64 image is 413,450,617 bytes and runs as UID/GID 10001. The host used Docker Engine 26.1.5 and Compose 2.26.1, which differ from the reference versions. No image was published and no external deployment ran.

### [x] Task 22: Complete implementation review and performance checks

**Depends on:** Tasks 1 through 21 complete.

**Files:** Create `.github/workflows/ci.yml`, `tools/performance/corpus.ts`, `tools/performance/service.ts`, `tools/performance/bundle-budget.mjs`, and `docs/development/verification.md`. Modify source files only for demonstrated findings. Do not create E2E files or CI jobs.

**Interfaces:** Root `pnpm verify` runs contract lint, generated comparison, typecheck, lint, formatting, unit/integration tests, and build in dependency order. `pnpm perf:service` seeds a disposable corpus and measures save/search service time; `pnpm perf:bundle` measures compressed initial JS. Test reports record environment, sample size, percentiles, and pass/fail without note content.

- [x] Review all design requirements against completed tasks. Check package imports, request/response validation, role/scope checks, replay order, immutable history, multi-file atomicity, local draft preservation, and cleanup/purge races. Fix findings and rerun only the affected tests before the final complete gate.
- [x] Generate 10,000 notes of 5 to 20 KiB plus a 1 MiB stress file. Measure 20 active users on a recorded 2-core/4 GiB test server. Require p95 save service time below 200 ms, search below 300 ms, and initial JS below 250 KiB gzip excluding deferred editor/rich modules.
- [x] Measure typing/local save/cached opening during manual development checks: p95 below 50/150/150 ms respectively. Record p75 LCP below 2.5 seconds and INP below 200 ms with sample limits stated. Add timing marks and source-preserving render limits where needed. Do not claim field performance from a small local sample; browser/device release measurements remain in Task 24.
- [x] Add CI for frozen installation, exact peer checks, deterministic generation, strict compilation, lint/boundaries, formatting, Node unit tests, disposable integration services, and builds. Run `pnpm install --frozen-lockfile`, `pnpm verify`, `pnpm perf:service`, and `pnpm perf:bundle`. Record actual results and remaining device evidence.
- [x] Commit: `test: enforce implementation quality and performance gates`.

Execution record (2026-09-06): commit `8c4163d`. Frozen installation and the complete `pnpm verify` gate passed with 459 unit tests, 248 integration tests, and all builds. The 2-core/4 GiB service run against PostgreSQL 18.6 and 20 active users measured save p95 at 189.45 ms and search p95 at 26.34 ms across 100 samples each. Initial JavaScript was 144,544 bytes gzip. The 60-sample module checks measured typing p95 at 3.13 ms, draft save p95 at 0.25 ms, and cached opening p95 at 0.15 ms. Five warm local Chrome 152 samples measured LCP p75 at 44 ms and INP p75 at 24 ms on the signed-out route. This small browser sample is not field or device evidence. Task 24 still requires that evidence.

### [ ] Task 23: Author and run E2E tests after explicit user go-ahead

**Depends on:** Task 22 passed and a new explicit user authorization for E2E work. Keep every step unchecked until that authorization exists.

**Files, created only after authorization:** `playwright.config.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/identity.spec.ts`, `tests/e2e/editor.spec.ts`, `tests/e2e/offline.spec.ts`, `tests/e2e/history.spec.ts`, `tests/e2e/sharing.spec.ts`, and `.github/workflows/e2e.yml`. Modify package manifest/lockfile to install the then-verified compatible Playwright release.

**Interfaces:** Root `pnpm test:e2e` runs user journeys against the real disposable Docker application and controlled identity provider. Each worker owns its test accounts/workspaces. Browser tests use the actual UI and generated-client application path; they must not replace the sync engine with mocks.

- [ ] Record the user's authorization in this task. Only then install tooling, create browser projects/fixtures/CI, and seed isolated users through supported bootstrap/API paths. Configure Chromium, Firefox, WebKit, and supported installed Chrome/Edge channels. Treat Playwright WebKit as engine coverage, not proof of actual Safari releases.
- [ ] Write journeys for initial setup, local/OIDC login, multi-account/workspace roles, Tokyo Night themes, live preview, widgets, keyboard/touch navigation, IME, paste, undo, hidden syntax selection, search, and stable links.
- [ ] Write offline reload/edit/create/rename/delete, two-context conflict, history/restore, lost response, attachment upload, quota, storage failure, update, logout/revocation, and atomic group resolution journeys. Assert visible save states and exact retained content, not only successful HTTP status.
- [ ] Write publication/pinned-image/revocation journeys and account-isolation checks. Run `pnpm test:e2e` and the relevant integration checks after fixes. Keep failed-run traces private and remove credentials/content from retained reports. A quarantined required journey does not count as release evidence.
- [ ] Commit: `test: verify complete notes application journeys`.

### [ ] Task 24: Verify devices, accessibility, and release readiness

**Depends on:** Task 23 passed. Builds run locally or on an authorized test installation; external publication remains a separate authorized action.

**Files:** Modify `docs/development/verification.md` and `docs/operations/self-hosting.md` with actual evidence. Modify application files only for verified defects, then rerun their relevant checks.

**Interfaces:** Produces a release readiness record with browser/device/OS/build versions, accessibility results, security control evidence, performance measurements, migration/restore results, and any blocking failures. No new product feature or export interface is introduced.

- [ ] Verify current and previous major Chrome, Edge, Firefox, and actual Safari. Use real Android and iOS devices for installation, offline restart, storage retention, attachment access, updates, touch, and account recovery. Record unavailable environments as incomplete evidence rather than a pass.
- [ ] Check WCAG 2.2 AA keyboard/focus/contrast/status/zoom behavior and representative assistive technology. Check applicable ASVS Level 2 controls for auth, CSRF, workspace isolation, files, public routes, token redaction, and encrypted storage. State verification results without certification claims.
- [ ] Repeat performance measurements on the recorded browser/phone/server profiles. Verify encrypted backup restoration and upgrade from the preceding available schema with retained offline work. Validate amd64 and arm64 operation, not only image compilation. Resolve blocking defects and rerun affected automated tests.
- [ ] Run `pnpm verify` and `pnpm test:e2e` for the final changed build when release fixes require them. Complete the evidence record; do not mark release ready with missing required E2E/device/security/restore evidence. Prepare local release artifacts without publishing them.
- [ ] Commit: `docs: record release verification evidence`.

## Design coverage and completion rules

| Design requirement | Implementation tasks | Final evidence |
| --- | --- | --- |
| Strict structure and current compatible dependencies | 1, 2, 3, 22 | Frozen install, compiler/generator checks, import rules |
| Generated HTTP client and boundary validation | 2, 5 through 9, 18 through 20 | Operation coverage, generated-client integration, schema checks |
| Multiple accounts, OIDC, roles, and agent scopes | 4, 5, 13, 20 | Identity/row/scope integration and final user journeys |
| Immutable history and atomic file changes | 6, 8, 16 | Replay, branch, restore, purge, and batch rollback tests |
| Offline drafts, sync, tabs, and recovery | 9 through 11, 16, 17 | Storage/sync tests, E2E offline journeys, real devices |
| One-pane live Markdown editing | 12, 14 through 16 | Source/range tests, IME/selection/undo journeys |
| Tokyo Night and minimal responsive UI | 13 through 17 | Theme/contrast tests, mobile and accessibility checks |
| Images, math, tables, and Mermaid | 7, 12, 15 | Safe content tests, immutable image history, widget journeys |
| Stable links, backlinks, and search | 12, 18 | Permission/index tests and local draft search |
| Pinned public sharing and revocation | 19 | Page/image expiry and revocation tests |
| Remote and local MCP with full content API | 20 | SDK transport, scope, precondition, and operation tests |
| Docker, encryption, backup, and upgrades | 21, 24 | Architecture builds, host checks, restore/upgrade evidence |
| Performance | 14, 15, 22, 24 | Recorded corpus, environment, percentiles, bundle sizes |
| Unit and integration testing | Every implementation task | Task-local checks plus complete gate in Task 22 |
| E2E last, with separate user go-ahead | 23, 24 | Explicit authorization, passing journeys, device evidence |
| Export | Excluded | No export code, endpoints, worker, or UI |

Plan self-review checked design coverage, dependency order, interface ownership, verification commands, and the separate E2E gate. Task 1 creates the command convention before later tasks use it. Generated operation names are owned by the task that adds their OpenAPI definitions. No implementation, runtime test, or release result is claimed by this document.
