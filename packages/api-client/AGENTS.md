# packages/api-client

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

The typed HTTP client. Every application HTTP call uses an operation that
this package exports. `src/generated/` is written by `pnpm generate` from
`packages/api-contract/openapi.yaml`.

## What lives here and what does not

- `src/generated/` holds the operations, the serializers, and the one fetch
  transport. Never edit a file there.
- `src/configure.ts` is the one handwritten file. It sets the base URL, the
  cookie behaviour, the token provider, and it normalizes a problem answer.
- `src/index.ts` re-exports the generated operations and the configuration.
  No consumer may import a file under `src/generated/` directly.
- No domain rule, no retry policy, and no queue lives here. Those live in
  `packages/core` and `packages/sync`.

## Allowed imports

No workspace package and no runtime dependency.

## How to add a common thing here

- **An operation.** Do not write one here. Add it to
  `packages/api-contract/openapi.yaml` and run `pnpm generate`.
- **A client setting.** Add it in `src/configure.ts`. It may pass a fetch
  implementation and a base URL to the generated client; it must not call a
  transport itself.
- **A problem message.** Extend `normalizeProblem` in `src/configure.ts`, and
  keep the raw code out of the returned text.

## Testing conventions here

`node --test` through `pnpm test:unit` for `src/configure.ts`. The generated
operations are proved by `tests/integration/contract.test.ts`, which calls
each one against a real listening server, and by `pnpm generated:check`.

## Forbidden here

- No hand edit under `src/generated/`.
- No `fetch` call in `src/configure.ts`. It only passes an implementation.
- No deep import of `src/generated/` by any consumer.
- No second export entry. Only `exports["."]`.

## Key files

| File               | Purpose                                 |
| ------------------ | --------------------------------------- |
| `src/index.ts`     | The one public entry point              |
| `src/configure.ts` | Base URL, cookies, tokens, problem text |
| `src/generated/`   | Generated operations, never edited      |
