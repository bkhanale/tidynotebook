# apps/server

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

The Fastify HTTP adapter. It serves the built web application, the REST API,
and the authentication routes on one origin. It holds no domain rule.

## What lives here and what does not

- `src/plugins/` holds one cross-cutting Fastify concern per file and no
  business resource: `register.ts` (contract routes and boundary validation),
  `problem.ts` (RFC 9457 body), `security-headers.ts`, `static-assets.ts`, `host.ts`.
- `src/routes/` holds one controller file per resource. `handlers.ts` returns
  one handler per operation id, and the body of a handler lives in its area
  file: `files.ts`, `history.ts`, `search.ts`, `sync.ts`, `accounts.ts`,
  `attachments.ts`, `export.ts`, `workspaces.ts`, `zip.ts`.
- `src/auth/` holds the Better Auth adapter, the actor resolver, mail, and
  the first user setup. `src/jobs/` holds background work. `src/cli/` holds
  the operator commands.
- A domain rule lives in `packages/core`. A SQL statement lives in
  `packages/storage-server`. A request shape lives in `openapi.yaml`.

## Allowed imports

`@notesapp/api-contract`, `@notesapp/core`, `@notesapp/storage-server`,
`@notesapp/markdown`.

This package is Node only. It may use Node built in modules and Node only
packages such as `fastify`, `pg`, and `sharp`.

## How to add a common thing here

- **A handler for a new operation.** Write the operation in
  `packages/api-contract/openapi.yaml` and run `pnpm generate` first. Add the
  function in the area file under `src/routes/`, then return it from
  `createHandlers` in `src/routes/handlers.ts`. A missing handler and an
  unknown handler both stop startup.
- **A background job.** Add `src/jobs/<name>.ts` and start it from
  `src/app.ts`. A job takes the store as an argument, so a test can drive it.
- **A readiness check.** Add the probe in `src/routes/handlers.ts` next to
  `databaseProbe`, `migrationProbe`, `storageProbe`, and
  `configurationProbe`, and add it to `evaluateReadiness`.

## Testing conventions here

`node --test` through `pnpm test:unit` for pure modules such as `config.ts`
and `request-log.ts`. Everything that needs a database or a listening server
is an integration test under `tests/integration/`, which uses the real
PostgreSQL service. A handler test must prove the status, the media type, the
body, and the failure code. A request that no generated operation can
express, such as a forged Host header, uses `app.inject()`.

## Forbidden here

- No route, request shape, or response shape declared by hand. Only the
  contract creates routes.
- No domain rule in a handler. A handler reads validated input, calls a
  `packages/core` use case with the store, and returns a result.
- No direct SQL. Every statement belongs to `packages/storage-server`.
- No weakened server invariant to hide a client defect.
- No rejected body, token, or password in a log line. A rejection is logged
  with the request id, the operation, the status, and the reason.
- No handwritten HTTP transport. `better-auth.ts` is the one listed protocol
  file, and it still obeys every other boundary rule.

## Key files

| File                              | Purpose                                        |
| --------------------------------- | ---------------------------------------------- |
| `src/app.ts`                      | Builds the Fastify application                 |
| `src/plugins/register.ts`         | Contract driven routes and boundary checks     |
| `src/plugins/security-headers.ts` | Content security policy and frame rules        |
| `src/plugins/static-assets.ts`    | Precompressed assets, caching, `ETag`          |
| `src/routes/handlers.ts`          | One handler per operation id, readiness probes |
| `src/auth/actor.ts`               | Turns a session into a verified actor          |
| `src/config.ts`                   | Environment reading and refusal messages       |
