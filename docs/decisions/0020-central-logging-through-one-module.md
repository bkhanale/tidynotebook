# 0020. Central logging through one module

- Status: Accepted
- Date: 2026-09-11

## Context

Fastify supplies Pino as a transport, and no document or check states what a
record holds. `apps/server/src/request-log.ts`, `apps/server/src/app.ts:394`
and the protocol bridge below it write three different shapes. `apps/web` has
no logger and one `console.warn` in `src/app.tsx:75`. `redactUrl` clears the
query string only, so the reset token in the path reaches the log.
`.oxlintrc.json` holds no `no-console` rule. See
[design 003](../design/003-central-logging.md).

## Decision

Every log record in this repository is written through `packages/logging`. The
package is browser safe and has no runtime dependency.

- A typed event catalogue owns the event names. Each event carries its level
  and its allow-listed field shape.
- There is no free-form message. A call names an event.
- `emit(event, fields)` drops a field that the catalogue does not declare.
- `bind(context)` attaches the request id and the actor id once, and every
  record below it carries them.
- A sink is an adapter: Pino in `apps/server`, the console in `apps/web` at
  warn and error in a production build, an in-memory buffer in the tests.
- A unit test refuses a catalogue field whose name is secret shaped: token,
  password, secret, cookie, note text, or a path with user content.
- `no-console` is an oxlint error everywhere, with an override for the sink
  adapters and for `apps/server/src/jobs/inspect-image-worker.ts`, whose stdout
  is a result protocol.
- `tools/check-boundaries.mjs` allows an import of Pino in `packages/logging`
  and its server adapter only.

## Consequences

The repository gains one package, and every existing `request.log` and
`app.log` call becomes a catalogued event. A new log line is one catalogue
entry plus one `emit`, so the pattern repeats.

The reset token row on the
[GitHub project board](https://github.com/users/bkhanale/projects/2) is a redaction of
a secret path segment. That redaction lands inside the server adapter, or ahead
of it in `apps/server/src/request-log.ts`, because the P0 does not wait for the
package.

The lint gate refuses a console call outside the adapters, and the boundary
check refuses a Pino import outside them.
