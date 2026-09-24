# Running the local application

This page states how a contributor starts the real application with temporary local data.

Run the launcher from the repository root:

```sh
pnpm dev:app
```

`tools/dev-app.mjs` builds the client and server and starts the shared test PostgreSQL service. `tests/integration/support/dev-app.ts` creates one disposable database through `tests/integration/support/database.ts` and calls the owner code in `apps/server/src/cli/bootstrap.ts`. The command prints the local address and sign-in details after the server starts.

Press Ctrl+C to stop the server and remove this run's database and file storage. The shared PostgreSQL service stays up for tests. Each new run creates a new owner and fresh storage. Use `pnpm dev:app --port <port>` when the normal local port is busy.
