# 0039. One list of served origins

- Status: Accepted
- Date: 2026-09-16

## Context

The deployment answers two different questions about an origin, and it answers
them from two different places. `checkWriteOrigin` in
`apps/server/src/auth/actor.ts` compares the `Origin` header of a cookie
authenticated write with one configured value. `buildAuth` in
`apps/server/src/auth/better-auth.ts` builds the Better Auth trusted list from
the configured host list, and it adds a scheme and the port 3000 to each host
that carries none. The shipped defaults therefore trust origins that no
operator named, and the two checks disagree with each other. The Host allowlist
in `apps/server/src/app.ts` reads that host list as a third answer. A host name
carries no scheme and no port, so a host list cannot answer the origin question
at all.

## Decision

One deployment holds one list of served origins.
`apps/server/src/served-origins.ts` builds that list, and every check reads it.

- The operator names full origins. `NOTESAPP_ORIGIN` is the one canonical
  origin. `NOTESAPP_ADDITIONAL_ORIGINS` is an optional comma list of more
  origins. Each entry carries its scheme, and it carries its port when that
  port is not the default port of the scheme.
- The parser adds no scheme and no port. It refuses an entry that carries a
  path, a query, a fragment, or a credential, and it refuses an entry that
  repeats a served origin.
- Every served origin uses the scheme of the canonical origin. One cookie
  policy serves the whole list, so a list that mixes the two schemes stops
  startup.
- The cookie write check and the Better Auth trusted list read the list itself,
  so the two accept the same set. The Host allowlist reads the host name of
  each entry, because a `Host` header carries no scheme.
- The canonical origin keeps the roles that need exactly one value: the base
  URL of the identity routes, the secure cookie flag, and the default listening
  port.
- `NOTESAPP_ALLOWED_HOSTS` is gone. A deployment that still sets it stops at
  startup with a message that names the two origin values.

This excludes one deployment that serves both HTTP and HTTPS, a trusted origin
that the operator did not name, and a Host check on the port. The port of a
`Host` header is not reliable behind a reverse proxy, so the Host allowlist
stays a host name projection of the one list.

## Consequences

An operator who serves one origin changes nothing. An operator who named a
second host must name it again as a full origin, and the startup refusal tells
them so, because a silent narrower trust list would lock them out at the next
sign-in instead. A reverse proxy in front of the deployment names its public
origin in `NOTESAPP_ORIGIN`, so the proxy work needs no new value here.

`ServerConfig` loses its host list and holds `servedOrigins`. The readiness
configuration probe reads that field.
`apps/server/src/served-origins.test.ts` proves the parse, every refusal, and
that the write check accepts each served origin and refuses its neighbour.
`tests/integration/served-origins.test.ts` drives a real listening server and
compares the answer of the cookie write check with the answer of the trusted
list for the same origins, so the two cannot drift apart again.
