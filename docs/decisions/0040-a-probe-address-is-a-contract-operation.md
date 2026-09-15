# 0040. A probe address is a contract operation

- Status: Accepted
- Date: 2026-09-16

## Context

`apps/server/src/app.ts` registered `/health` and `/ready` by hand, beside the
contract operations at `/api/health` and `/api/ready`. A hand registered route
carries no operation id, so `apps/server/src/plugins/register.ts` returned from
its response check at once and never compared those answers with a declared
schema. The rule in `apps/server/AGENTS.md` says that only the contract creates
a route, so the two addresses that an operator probes were the two addresses
that nothing held. `docker/healthcheck.mjs` reads one of them, and a load
balancer and an orchestrator usually probe a fixed path at the root of an
origin, so an operator's probe configuration depends on both.

## Decision

Every address that the server answers is an operation of the contract.
`packages/api-contract/paths/health.yaml` and
`packages/api-contract/paths/ready.yaml` declare the root addresses, next to
the two files that declare the API addresses.

- An alias address gets its own `operationId`, because one operation id names
  one address. The four ids are `getHealth`, `getRootHealth`, `getReadiness`
  and `getRootReadiness`. The root ids say which address they serve.
- The root document lists one file for each path. `tools/sdk-codegen/src/contract-layout.ts`
  refuses two rows that name one file, so an alias cannot share a path file.
- Both ids of one answer name one function.
  `createServiceHandlers` in `apps/server/src/routes/health.ts` builds the
  liveness answer once and the readiness answer once, and binds each to its two
  ids. A copied handler body is refused, because the two answers must stay
  equal, including the refusal that a draining process gives.
- A probe operation declares `security: []`, so it stays outside the session
  requirement of the document, exactly as the API probe operations do.

This excludes a route that the contract does not declare, and it excludes an
alias that reuses an operation id that already shipped.

## Consequences

The response check now covers all four addresses, so an answer that leaves the
contract is refused and logged under its operation id. The generated client
gains two operations that the web application never calls; they are the ones
that the integration tests use to compare the two addresses. An operator
changes nothing, because the addresses and their answers do not move.

`tests/integration/contract.test.ts` proves that the two addresses of each
answer agree and that the response check refuses an undeclared member of each
root operation. `tests/integration/shutdown.test.ts` proves that both readiness
addresses report the stop. The one to one map between the contract and the
handler map, which the same file proves, now covers the two new ids.
