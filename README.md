# NotesApp

NotesApp is a local-first Markdown workspace with durable browser drafts,
explicit checkpoints, PostgreSQL revision history, offline editing, and manual
conflict resolution.

## Development

Use Node.js 26.8.1 and pnpm 12.3.4. Start the test database, install packages,
and run the complete verification gate:

```sh
tools/test-database/ensure-postgres.sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
```

Use `pnpm build` for production output and `pnpm start` to start the Fastify
application. The server reads deployable browser assets from
`apps/web/dist/web`.

## Documentation

- `docs/development/verification.md` lists all automated gates.
- `docs/development/local-storage.md` explains drafts, queue state, and sync.
- `docs/development/files-and-revisions.md` explains immutable history and
  conflict preconditions.
- `docs/operations/self-hosting.md` explains protected configuration,
  local-network binding, backup, and restore.
