# 0043. One decider of the client address

- Status: Accepted
- Date: 2026-09-16

## Context

A reverse proxy is the only supported way to serve this application over
HTTPS, and a proxy replaces the peer address of every request with its own.
Nothing in `apps/server/src` configured that trust, so the attempt limit of
`@fastify/rate-limit` keyed on the address of the proxy and counted the whole
world as one client. Better Auth answered the same question from a second
place: `getIP` of `@better-auth/core` reads `x-forwarded-for` from the request
that `apps/server/src/auth/better-auth.ts` builds, and it believes a header
that carries one address, whoever sent it. A direct caller could therefore
give a new address to each sign-in attempt and pass the attempt limit of the
identity routes. Two components answered "who is the caller" from two values,
which is the fault that [0039](0039-one-list-of-served-origins.md) removed for
the origin.

## Decision

One value grants the trust, and one field carries the answer.

- `NOTESAPP_TRUSTED_PROXIES` names the proxies whose forwarded headers this
  deployment believes. `apps/server/src/trusted-proxies.ts` parses it. An entry
  is an IP address, a range in CIDR form, or one of the names `loopback`,
  `linklocal` and `uniquelocal`. An entry of another shape stops startup.
- The default is an empty list, which trusts nothing. A deployment with no
  proxy in front believes the peer address of the socket and nothing else.
- `apps/server/src/app.ts` gives that list to Fastify as `trustProxy`. Fastify
  walks the forwarded chain from the right and stops at the first hop that the
  list does not hold, so a forged entry in front of a trusted proxy is dropped.
  `request.ip` is the one answer, and the attempt limit keys on it.
- `toRequestHeaders` in `apps/server/src/auth/better-auth.ts` removes every
  `Forwarded` and `X-Forwarded-*` header of the caller and writes one
  `x-forwarded-for` that holds `request.ip`. Better Auth reads the answer of
  this server instead of the header of the caller.
- Better Auth keeps `advanced.trustedProxyHeaders` off. Its base URL is the
  canonical origin of [0039](0039-one-list-of-served-origins.md), so a
  forwarded host must never move it.
- The `Host` allowlist reads the `Host` header, not a forwarded header. The
  proxy must pass the original `Host`, which
  [0039](0039-one-list-of-served-origins.md) already states.

This excludes a boolean that trusts any sender, a count of hops, a forwarded
header that decides the served host, a scheme that a header decides, and a
second component that resolves the client address on its own.

## Consequences

An operator who serves plain HTTP changes nothing. An operator behind a proxy
names the address or the range of that proxy, and the attempt limits then
count each client. A private range is only safe when the proxy is the one
caller that reaches the listening port, and
[Self-hosting](../guide/self-hosting.md) states that.

`apps/server/src/trusted-proxies.test.ts` proves the parse and every refusal.
`apps/server/src/config.test.ts` proves that the default is an empty list.
`tests/integration/proxy-trust.test.ts` drives a real listener and proves that
a forged `X-Forwarded-For` moves neither the recorded address nor the attempt
limit while the list is empty, that a configured range moves both, and that the
identity routes count one client whatever the forged header holds.
