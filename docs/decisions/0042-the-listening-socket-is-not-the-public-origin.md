# 0042. The listening socket is not the public origin

- Status: Accepted
- Date: 2026-09-16

## Context

`apps/server/src/main.ts` read the listening port from the public origin. It
took `new URL(config.origin).port` and used port 3000 when that value was
empty, and it read `NOTESAPP_HOST` straight from the environment. A deployment
that names a public port, for example `https://notes.example.com:8443`, made
the process bind 8443 inside its container, although the public port belongs to
the proxy in front. The last bullet of
[0039](0039-one-list-of-served-origins.md) gave the canonical origin that role.
A proxy separates the two addresses, so one value cannot hold both. The two
values also skipped `apps/server/src/config.ts`, which is the one place that
reads the environment and states a refusal.

## Decision

The socket that the process listens on is its own configuration, and it is read
and validated with every other value in `apps/server/src/config.ts`.

- `NOTESAPP_HOST` names the interface. The default is every interface.
- `NOTESAPP_PORT` names the port. The default is 3000. A value outside 1 to
  65535 stops startup.
- `config.listen` holds the pair. `main.ts` reads that field and derives
  nothing.
- A deployment whose `NOTESAPP_ORIGIN` carries a port and that names no
  `NOTESAPP_PORT` stops at startup. The message names the listening value,
  because the port of the public origin was the listening port before this
  record and a silent move to 3000 would take the installation off the network.

This refines the last bullet of [0039](0039-one-list-of-served-origins.md): the
canonical origin keeps the base URL of the identity routes and the secure
cookie flag, and it no longer decides the listening port.

This excludes a listening port that follows the public origin, and it excludes
a listening address that no schema checks.

## Consequences

An operator who runs the image changes nothing, because the image sets both
values. An operator who runs the server directly with a public port in the
origin sets `NOTESAPP_PORT` once, and the startup refusal names it.

`apps/server/src/config.test.ts` proves the default pair, the accepted values,
the refusal of a port outside the range, and the refusal of an origin port with
no listening port. `tests/integration/proxy-trust.test.ts` starts a real
listener from `config.listen`.
