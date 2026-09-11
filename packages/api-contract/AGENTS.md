# packages/api-contract

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

`openapi.yaml` is the only source of the notesapp HTTP interface. This
package also exposes the generated operation index and the compiled Ajv
2020-12 validators that the server boundary uses.

## What lives here and what does not

- `openapi.yaml` is authoritative. `redocly.yaml` holds the strict rules that
  `pnpm contract:lint` applies.
- `src/generated/` holds the operation index and the compiled validators.
  Never edit a file there. `pnpm generate` writes it and
  `pnpm generated:check` compares it.
- `src/operations.ts` gives the registry lookups. `src/schema.ts` compiles a
  schema and describes an issue.
- No route, no handler, and no client code lives here. The generator lives in
  `tools/sdk-codegen`.

## Allowed imports

No workspace package. Only `ajv` and `ajv-formats`.

## How to add a common thing here

- **An operation.** Add it in `openapi.yaml` with a stable `camelCase`
  `operationId`, a summary, a description, and a declared tag. Give every
  parameter `in`, `required`, `style`, `explode`, a description, and a
  schema. Declare the success status, `400`, and `500`, plus `413` and `415`
  when the operation has a request body.
- **A schema.** Set `additionalProperties: false` on a write body object.
  Mark a client only member `writeOnly` and a server only member `readOnly`.
  Reference it from an operation, because an orphan component fails
  generation.
- **A failure code.** Use `application/problem+json` with `ProblemDetails`
  and give the failure a stable `code`.

## Testing conventions here

`node --test` through `pnpm test:unit`. `src/validators.test.ts` proves that
a compiled validator accepts the declared shape and refuses the neighbouring
undeclared one. `tests/integration/contract.test.ts` calls each generated
operation against a real listening server and proves the one to one mapping
between the contract and the handler map.

## Forbidden here

- No edit under `src/generated/`.
- No operation without `additionalProperties: false` on a write body.
- No parameter without `style` and `explode`. No cookie parameter.
- No status with more than one media type.
- No reuse or change of an `operationId` that already shipped.
- No orphan component. `tools/sdk-codegen/src/orphans.ts` refuses one.

## Key files

| File                | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `openapi.yaml`      | The authoritative OpenAPI 3.1.2 document  |
| `redocly.yaml`      | The strict rules of `pnpm contract:lint`  |
| `src/index.ts`      | The one public entry point                |
| `src/operations.ts` | Registry lookups over the generated index |
| `src/validators.ts` | Compiled request and response validators  |
| `src/generated/`    | Generated output, never edited by hand    |
