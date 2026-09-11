# tools/sdk-codegen

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

The generator. It lints the contract, merges the authentication fragment,
and writes `packages/api-contract/src/generated/` and
`packages/api-client/src/generated/`. It is the only workspace that produces
the HTTP boundary instead of using it.

## What lives here and what does not

- `src/generate.ts` is the entry point of `pnpm generate`.
  `src/check-generated.ts` is the entry point of `pnpm generated:check`.
- `src/auth-contract.ts` holds the authentication protocol fragment that
  `openapi.yaml` does not describe. `src/contract-index.ts`,
  `src/definitions.ts`, `src/emit.ts`, and `src/paths.ts` write the output.
- `src/orphans.ts` walks the merged document from the paths and the document
  security and reports every component that nothing reaches.
- No application code lives here. No handler and no screen.

## Allowed imports

`@notesapp/api-contract` only, plus `@hey-api/openapi-ts` and
`@redocly/cli`.

## How to add a common thing here

- **A contract rule.** Add the check in the file that owns the shape, and
  fail generation with a message that names the operation and the member.
  A refused shape must never reach the generated output.
- **A generated file.** Write it from `src/emit.ts` and add it to the set
  that `src/check-generated.ts` compares, so a stale committed file fails
  `pnpm generated:check`.
- **A Redocly rule.** Add it in `packages/api-contract/redocly.yaml`, not
  here.

## Testing conventions here

`node --test` through `pnpm test:unit`. `src/orphans.test.ts` is the pattern:
it builds a small document in the test file and proves that the walk reports
the unreachable component and accepts the reachable one. Generation itself is
proved by `pnpm generated:check`, which is part of `pnpm verify`.

## Forbidden here

- No generated output that a rule refused. Fail instead.
- No hand edit of a file under a `src/generated/` directory.
- No non deterministic output. The same contract must give the same bytes.
- No application dependency. This workspace is the only one outside the
  generated transport rule, so it must not import application code.

## Key files

| File                     | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `src/generate.ts`        | Writes the contract index and the client      |
| `src/check-generated.ts` | Compares the committed output with the source |
| `src/auth-contract.ts`   | The authentication protocol fragment          |
| `src/orphans.ts`         | The orphan component check                    |
| `src/emit.ts`            | File emission                                 |
