# apps/server

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of this
directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).
The Fastify HTTP adapter serves the web application, the REST API, and the
authentication routes on one origin. It holds no domain rule.

## What lives here and what does not

- `src/plugins/` holds one cross-cutting Fastify concern per file and no business
  resource: `register.ts` (contract routes and validation), `problem.ts` (RFC 9457
  body), `security-headers.ts`, `static-assets.ts`, `host.ts`, `content-disposition.ts`
  (the name and the kind of a download), and `body-idle-timeout.ts` (the idle bound).
- `src/routes/` holds one controller file per resource. `handlers.ts` returns one
  handler per operation id, the body lives in its area file, and `health.ts` holds
  liveness, readiness, and the probes.
- `main.ts` wires the process to `src/lifecycle.ts`, which owns the order of the
  start and of the stop and holds no signal and no exit.
- `src/auth/` holds the Better Auth adapter, the actor resolver, mail, and the first
  user setup. `src/jobs/` holds background work and `src/cli/` the operator commands.
- A domain rule lives in `packages/core`. Every SQL statement lives in
  `packages/storage-server`. A request shape lives in `packages/api-contract/`.

## Allowed imports

`@notesapp/api-contract`, `@notesapp/core`, `@notesapp/logging`, `@notesapp/markdown`,
`@notesapp/storage-server`. This package is Node only. It may use Node built in modules
and Node only packages such as `fastify`, `pg`, and `sharp`.

## How to add a common thing here

- **A handler for a new operation.** Write the operation in `packages/api-contract/` and
  run `pnpm generate` first. Add the function in the area file under `src/routes/`, then
  return it from `createHandlers`. A missing or an unknown handler stops startup.
- **A background job, or any resource that must close.** Add `src/jobs/<name>.ts` and
  start it from `src/app.ts`. A job takes the store as an argument, so a test can drive
  it. Close every resource in the `onClose` hook, which the drain runs.
- **A readiness check.** Add the probe in `src/routes/health.ts` and list it in
  `src/app.ts`. A stop answers first, and a database probe reads a served pool (0041).

## Testing conventions here

`node --test` through `pnpm test:unit` for a pure module, for example `config.ts` or
`plugins/content-disposition.ts`. A test that needs a database or a listening server is
an integration test under `tests/integration/`, against the real PostgreSQL service. A
handler test proves the status, the media type, the body, and the failure code. A
request that no generated operation can express, such as a forged Host header or a body
that arrives in pieces, uses `app.inject()`.

## Forbidden here

- No route, request shape, or response shape declared by hand. Only the contract creates
  a route, and that includes a probe address. Two ids of one answer share one function,
  so no handler body is copied (record 0040).
- No domain rule in a handler. A handler reads validated input, calls a `packages/core`
  use case with the store, and returns a result.
- No direct SQL or weakened server invariant, and that includes a readiness probe.
- No second origin list and no second decider of the client address (0039, 0043).
- No rejected body, token, or password in a log line. A rejection is logged with the
  request id, the operation, the status, and the reason.
- No handwritten HTTP transport. `better-auth.ts` is the one listed protocol file, and
  it still obeys every other boundary rule.

## Key files

| File                              | Purpose                                        |
| --------------------------------- | ---------------------------------------------- |
| `src/app.ts`                      | Builds the Fastify application                 |
| `src/plugins/register.ts`         | Contract driven routes and boundary checks     |
| `src/plugins/security-headers.ts` | Content security policy and frame rules        |
| `src/plugins/static-assets.ts`    | Precompressed assets, caching, `ETag`          |
| `src/routes/handlers.ts`          | One handler per operation id                   |
| `src/routes/health.ts`            | Liveness, readiness, and the probes            |
| `src/auth/actor.ts`               | Turns a session into a verified actor          |
| `src/lifecycle.ts`                | The order of the start and of the stop         |
| `src/config.ts`                   | Environment reading and refusal messages       |
| `src/served-origins.ts`           | The one list of origins this deployment serves |
| `src/trusted-proxies.ts`          | The one list of proxies this deployment trusts |
| `src/logging.ts`                  | Pino sink for the shared event catalog         |
