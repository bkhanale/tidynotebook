# Adding an API operation

`packages/api-contract/openapi.yaml` is the only source of the notesapp HTTP
interface. A change to the interface is one change that contains the
specification, the generated output, the handler, and the tests. Do not split
these across commits, and never edit a file under a `src/generated/` directory.

## Layout

| Path                                      | Purpose                                                 |
| ----------------------------------------- | ------------------------------------------------------- |
| `packages/api-contract/openapi.yaml`      | The authoritative OpenAPI 3.1.2 document.               |
| `packages/api-contract/redocly.yaml`      | Strict specification rules for `pnpm contract:lint`.    |
| `packages/api-contract/src/generated/`    | Operation index and compiled Ajv 2020-12 validators.    |
| `packages/api-contract/src/operations.ts` | Registry lookups over the generated index.              |
| `packages/api-client/src/generated/`      | Typed operations, serializers, and the fetch transport. |
| `packages/api-client/src/configure.ts`    | Base URL, cookies, token provider, error normalization. |
| `apps/server/src/http/register.ts`        | Route registration and boundary validation.             |
| `apps/server/src/http/handlers.ts`        | One handler per operation id.                           |
| `tools/sdk-codegen/`                      | The generator and the generated output check.           |

## Steps

1. **Write the operation in `openapi.yaml`.** Give it a stable `operationId` in
   `camelCase`. The id never changes and is never reused. Add a summary, a
   description, and a tag that the document declares.
2. **Declare every parameter completely.** Set `in`, `required`, `style`,
   `explode`, a description, and a schema. The generator rejects a parameter
   that does not state `style` and `explode`, because a client and the server
   must not disagree about serialization.
3. **Separate input and output members.** A member that only a client sends is
   `writeOnly`. A member that only the server produces is `readOnly`. A write
   body sets `additionalProperties: false`, so an unknown member is rejected
   instead of ignored.
4. **Declare every response.** Each operation needs a success status, `400`, and
   `500`. Use `application/problem+json` with the `ProblemDetails` schema for
   every error, and give the failure a stable `code`. The boundary answers only
   with a status that the operation declares; any other status becomes a generic
   `500` problem.
   One status may carry one media type. A status with more than one media type
   is a startup error today.
5. **Run `pnpm contract:lint`.** The Redocly rules are strict, so a missing
   description or an undefined security scheme fails here.
6. **Run `pnpm generate`.** This bundles the contract, rewrites
   `packages/api-contract/src/generated/`, and rewrites
   `packages/api-client/src/generated/`. Commit the result.
7. **Add the handler.** `createHandlers` in `apps/server/src/http/handlers.ts`
   returns one function per operation id. A missing handler and an unknown
   handler both stop startup, so the server cannot drift from the contract.
   A handler returns a status, a media type, and a body. It does not repeat the
   contract shape, because the boundary validates the body against the declared
   response schema before it is sent.
8. **Add tests in the same change.** `tests/integration/contract.test.ts` calls
   the generated operation against a real listening server. Cover the success
   path, one rejected input, and any new failure code. The operation coverage
   test then also proves the one-to-one mapping.
9. **Run the gate.** `pnpm generated:check`, `pnpm typecheck`, `pnpm lint`,
   `pnpm format:check`, `pnpm test:unit`, `pnpm test:integration -- contract`,
   and `pnpm build` must all pass.

## Rules that the boundary enforces

- Request path, query, header, and body values are validated with the compiled
  2020-12 validators before a handler runs. Fastify's own validator and
  serializer compilers are replaced, because the default pair reads draft-07.
- An unknown query parameter is rejected. Headers stay open, because a proxy
  and a browser add headers that no contract describes.
- Responses are validated in every environment. An invalid response becomes a
  `500` problem that carries the request id and never the rejected body.
- Only the contract creates routes. Fastify's automatic `HEAD` route is off, so
  an operation that needs `HEAD` must declare it.
- Every response carries an `x-request-id` header. A caller may supply that
  header; the server echoes it when it is a UUID and generates one otherwise.

## Client rules

Every application HTTP call uses a generated operation. Handwritten `fetch`
calls, URL builders, request serializers, and duplicate response interfaces are
rejected by `tools/check-boundaries.mjs`.
`packages/api-client/src/configure.ts` is the one handwritten file that may set
the base URL, cookie behaviour, the bearer token provider, and shared error
normalization.

`packages/api-client` compiles with `exactOptionalPropertyTypes: false`, because
the bundled vendor transport inside the generated output does not compile with
it. That relaxation stays inside the package: every consumer reads the emitted
declarations through a project reference and keeps
`exactOptionalPropertyTypes: true`. `tools/check-exact-optional.test.mjs`
fails when a consumer stops enforcing it.

## Media types

`apps/server/src/http/register.ts` holds the media type handling table. A
`json` media type is validated against the declared response schema. The `html`
and `binary` rows are the documented hook for a later task: those responses
carry bytes, so that task adds size, access, and caching checks there instead of
JSON validation. No operation returns them yet.
