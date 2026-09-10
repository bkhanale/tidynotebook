# Contributing

Thank you for your interest in NotesApp. This page is the complete setup and
landing path. Read [AGENTS.md](AGENTS.md) for the full rule set and
[docs/development/architecture.md](docs/development/architecture.md) for the
current picture of the system.

## Requirements

| Tool           | Version                                 |
| -------------- | --------------------------------------- |
| Node.js        | 26.8.1                                  |
| pnpm           | 12.3.4                                  |
| Docker Engine  | any version that runs Docker Compose v2 |
| Docker Compose | v2                                      |

`pnpm lint` checks these versions against `engines` and `packageManager` in
`package.json`. A different version fails the gate.

## Setup

```bash
pnpm install --frozen-lockfile
tools/test-database/ensure-postgres.sh
pnpm verify
```

`ensure-postgres.sh` starts the disposable PostgreSQL service from
`compose.test.yaml` and applies the migrations. It is safe to run again, and
it is safe to run while another checkout uses the same service.

`pnpm verify` runs the complete gate: contract lint, generated file
comparison, typecheck, lint, format, unit tests, integration tests and all
builds. It must pass before a change is ready.

## Browser tests

Install the browser runtimes once, then run the matrix:

```bash
pnpm exec playwright install
pnpm test:e2e
```

Run the matrix when navigation, persistence, keyboard behavior or editor
rendering changes. `pnpm test:e2e:headed` opens an interactive Chromium run.
Reports go to `playwright-report` and `test-results/playwright`.

## Useful commands

| Command                 | Result                                                |
| ----------------------- | ----------------------------------------------------- |
| `pnpm build`            | Builds all packages, the server, and the web app      |
| `pnpm typecheck`        | Checks all TypeScript projects                        |
| `pnpm lint`             | Checks versions, source rules, and package boundaries |
| `pnpm format`           | Applies Prettier formatting                           |
| `pnpm test:unit`        | Runs unit tests                                       |
| `pnpm test:integration` | Runs the PostgreSQL and IndexedDB integration tests   |
| `pnpm generate`         | Regenerates the API client from the contract          |

Select a subset with a name, for example
`pnpm test:integration -- browser-storage`.

## Workflow

There are no pull requests. Work lands directly on `main`.

1. Create a worktree on a short-lived branch:

   ```bash
   git worktree add ../notesapp-wt/my-change -b my-change main
   cd ../notesapp-wt/my-change
   pnpm install --frozen-lockfile --prefer-offline
   ```

2. Do all edits, commits and untracked work inside that worktree. Never edit
   the main checkout while a worktree is open.
3. Run `pnpm verify` and the browser tests that your change touches.
4. Rebase and land:

   ```bash
   git rebase main
   git -C ../../notesapp merge --ff-only my-change
   git worktree remove ../notesapp-wt/my-change
   git branch -d my-change
   ```

If the rebase changed anything, run the checks again before you merge. Never
force push.

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): summary`. Common types are `feat`, `fix`, `refactor`, `perf`,
`test`, `docs`, `chore`, `ci`. Add `!` after the type for a breaking change.

```text
fix(sync): keep a queued save after a refused precondition
```

Write the summary in the imperative and in Simplified Technical English. Do
not use an em dash or an en dash anywhere. Keep each commit small and
complete on its own.

## Tests

- Every fixed defect gets a regression test that fails before the fix and
  passes after it.
- Every P0 user journey has a browser test that uses the public interface and
  checks the server result.
- Do not weaken an assertion, add a fixed delay, or skip a failing test to
  make a suite pass. If a test asserts behavior that your change replaces,
  update the test to assert the new behavior and say so.

## Code rules

The gate enforces these. The detail is in
[docs/development/architecture.md](docs/development/architecture.md) and
[docs/development/toolchain.md](docs/development/toolchain.md).

- Keep package boundaries strict. Domain code imports no transport, database,
  browser or React code.
- Call generated API client operations. Do not write a request URL or a direct
  `fetch` in feature code.
- Style with Tailwind utilities. `apps/web/src/tailwind.css` is the only
  application CSS source.
- Add a new API operation to `packages/api-contract/openapi.yaml` first, then
  run `pnpm generate`. See
  [docs/development/api-contract.md](docs/development/api-contract.md).
- Validate at domain boundaries. Do not weaken a server invariant to hide a
  client defect.

## Reporting a security problem

Do not open a public issue. See [SECURITY.md](SECURITY.md).
