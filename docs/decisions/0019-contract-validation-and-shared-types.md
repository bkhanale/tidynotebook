# 0019. One contract, generated types, and no type assertions

- Status: Accepted
- Date: 2026-09-11

## Context

The contract already creates every route and validates both the request and
the response at run time, so the client and the server cannot drift. Two things
weaken that. The contract is one file of about 3,500 lines, so a small change
is hard to read and two changes in one release meet in a conflict. And a type
assertion tells the compiler to stop checking: `grep -rn "as [A-Z]"` over the
source that is not generated finds 60 of them, 25 outside the tests, several on
a database row or a parsed record where nothing proves the shape.

## Decision

`packages/api-contract/openapi.yaml` is the one schema that the client and the
server share. The server validates every request and every response at its
boundary with validators compiled from that contract. The typed client and the
handler types are generated from it, and `pnpm generated:check` refuses a
committed output that the contract does not produce.

`packages/core` keeps its own domain types. A handler maps the contract type to
the domain type and back, and the compiler proves the mapping. A row that the
browser reads from IndexedDB is not covered by the contract, so it carries its
own validator in `packages/storage-browser`.

The contract source splits into a root `openapi.yaml` with `paths/`,
`components/schemas/`, `components/parameters/` and `components/responses/`
beside it. Redocly bundles the parts into the one document that the generator
already reads, so the generator does not change.

A type assertion is refused by lint. `typescript/consistent-type-assertions`
runs with the assertion style `never`, and `as const` stays allowed. A value of
an unknown shape reaches a type through a type guard or a parser that fails
loudly, not through an assertion that fails silently.

## Consequences

A contract change touches a small file, so two changes in one release rarely
meet. The bundle step is one more command in the contract lint, and a reader
who wants the whole document runs it. The assertion ban is a one time cost of
60 sites, and after it the compiler knows every shape the code claims. Where a
guard is impossible, the value is parsed and the failure is a refusal, so an
unchecked shape cannot reach the domain.
