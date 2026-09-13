# 003: Central logging

Status: active

This design states how a log record is written, and how the next one stays the
same as the last one. It covers the server and the browser.

## The problem

The application has a log transport and no log convention. Fastify supplies
Pino, and `apps/server/src/app.ts` gives it a level and a request serializer
that keeps the method, the URL, the host name and the peer address. That is the
whole of the shared shape. Everything after it is a habit.

Each call site then invents its own record. `apps/server/src/request-log.ts`
writes an object with a `type` field. `apps/server/src/app.ts:394` writes a
`source` field and a sentence. The bridge below it maps a protocol library
record onto four levels and passes the library sentence through. A reader of
the log stream meets three shapes and cannot query across them.

The browser has no logger at all. `apps/web/src/app.tsx:75` writes one
`console.warn` with a problem code. There is no level, no request id, and no
rule about what a browser record may hold.

Privacy rests on the same habit. `redactUrl` in `apps/server/src/request-log.ts`
removes the query string and keeps the path, so the password reset token, which
`apps/server/src/auth/better-auth.ts` serves inside the path, reaches the log at
`info`. That is the first row on the
[GitHub project board](https://github.com/users/bkhanale/projects/2). The
redaction is correct for a search term and silent about a path secret, because
no rule says which fields a record may hold.

Nothing refuses a console call either. `.oxlintrc.json` has no `no-console`
rule. A blanket rule would be wrong today, because
`apps/server/src/jobs/inspect-image-worker.ts` writes ten `console.log` lines
that are its result protocol on stdout, not log output.

## Goals

One record shape, so a reader queries one set of fields. A repeatable pattern,
so a new log line is one small addition and not a new invention. Privacy by
construction, so a field reaches a record only when it was declared in advance.
One API in both runtimes, so a contributor learns it once.

## The options

**Keep Pino and write a style guide.** This costs one page and no code. It
fails because a page holds nothing. The shapes already differ while the intent
is written down in the comments of `request-log.ts`. The browser still has no
logger, and privacy stays a thing that somebody must remember at each call.

**A wrapper inside `apps/server`.** This is cheap and it fixes the server: one
module owns the shape, and the reset token redaction lives in one place. It
leaves the browser out, so the web keeps its console calls and its own rules.
It also binds the shape to Pino, because the wrapper sits in the package that
holds the transport, so nothing else can reuse the shape later.

**A shared browser-safe package with sink adapters.** This costs one more
package and a migration of every call site. In exchange the shape is a value
that a test can read, both runtimes call the same function, and the transport
becomes an adapter that the shape does not know about.

## The chosen direction

The third option. `packages/logging` holds the shape, and it is browser safe
with no runtime dependency.

The package exports a typed event catalogue. The catalogue is a union of event
names, and each name carries a fixed level and an allow-listed field shape. The
level belongs to the event, not to the call site, so the same event never
arrives at two levels. There is no free-form message.

Every record has the same shape: the event name, the level, the time, the
request id, the actor id when one is bound, and the declared fields of that
event. `bind(context)` returns a child that carries those ids, so a handler
binds once and the ids reach every record below it. `emit(event, fields)` drops
a field that the catalogue does not declare, so a caller cannot widen a record
by accident.

A sink is an adapter. `apps/server` keeps Pino behind the server adapter, and
the request line and the URL redaction move there, next to the redaction of a
secret path segment. `apps/web` writes to the console at warn and at error, and
in a production build only. The tests use an in-memory buffer and read the
records back as values.

## What the checks hold

A unit test reads the catalogue and refuses a secret-shaped field. It names
token, password, secret and cookie, and it also refuses note text and a path
that carries user content, because those are the fields that a reset token and
a search term travel in.

`no-console` becomes an oxlint error everywhere. Two overrides stay: the sink
adapters, which are the one place that a console call belongs, and
`apps/server/src/jobs/inspect-image-worker.ts`, whose stdout is a protocol that
its parent parses.

`tools/check-boundaries.mjs` gains one rule: only `packages/logging` and its
server adapter may import Pino. No package declares Pino today, because Fastify
carries it, so the rule holds the boundary from the first line of the adapter.

The existing `request.log` and `app.log` calls in `apps/server/src/app.ts` and
`apps/server/src/http/register.ts`, and the request line in
`apps/server/src/request-log.ts`, become catalogued events in the same work.

## Decisions

- [0020. Central logging through one module](../decisions/0020-central-logging-through-one-module.md)
