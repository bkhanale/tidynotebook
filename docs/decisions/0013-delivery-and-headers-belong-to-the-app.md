# 0013. Delivery and headers belong to the application

- Status: Accepted
- Date: 2026-09-10

## Context

`apps/server` serves the built web application, the REST API, and the
authentication routes on one origin. There is no reverse proxy in the shipped
deployment, so no other component can add caching rules or security headers.

## Decision

The Fastify static handler serves precompressed assets with `Cache-Control`,
`ETag`, and the security headers: a content security policy, `nosniff`, a
referrer policy, and frame rules. Source maps are not served. The service
worker precaches the application shell only, and diagram chunks load on
demand. The diagram frame stays sandboxed, and its scripts become a self
contained bundle so the sandboxed origin can load them.

## Consequences

- `apps/server/src/http/static-assets.ts` and `security-headers.ts` own these
  rules, and both have tests.
- A deployment needs no proxy configuration to be safe.
- `tests/integration/web-delivery.test.ts` checks the served headers.
