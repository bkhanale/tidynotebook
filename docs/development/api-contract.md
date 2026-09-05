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
   must not disagree about serialization. The boundary serves `form` with
   `explode: true` for a query parameter and `simple` for a path or header
   parameter. Any other combination, and any cookie parameter, stops startup
   with a named error. A later task that needs another form adds its parsing in
   the same change that declares it.
3. **Separate input and output members.** A member that only a client sends is
   `writeOnly`. A member that only the server produces is `readOnly`. A write
   body object must set `additionalProperties: false`, so an unknown member is
   rejected instead of ignored. Generation fails when it does not.
4. **Declare every response.** Each operation needs a success status, `400`, and
   `500`. An operation with a request body must also declare `413` and `415`;
   generation fails when it does not. Use `application/problem+json` with the
   `ProblemDetails` schema for every error, and give the failure a stable
   `code`. The boundary answers only with a status and a media type that the
   operation declares; any other status becomes a generic `500` problem, and an
   undeclared media type becomes a `500` `invalid_response`.
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
   A request that no generated operation can express, such as a forged Host
   header, an unknown path, or a body on an operation that accepts none, uses
   the framework's in-process `app.inject()` utility. That utility builds no
   URL, serializes no body, and sends no traffic, so it is not a handwritten
   HTTP call. It is the only accepted way to reach those rules, and
   `tools/check-boundaries.mjs` rejects a real transport call anywhere in the
   `tests/` tree.
9. **Run the gate.** `pnpm generated:check`, `pnpm typecheck`, `pnpm lint`,
   `pnpm format:check`, `pnpm test:unit`, `pnpm test:integration -- contract`,
   and `pnpm build` must all pass.

## Rules that the boundary enforces

- Request path, query, header, and body values are validated with the compiled
  2020-12 validators before a handler runs. Fastify's own validator and
  serializer compilers are replaced, because the default pair reads draft-07.
- The path and query schemas are closed, and they exist even when an operation
  declares no member of that kind. An operation without a query parameter
  therefore rejects every query parameter. Headers stay open, because a proxy
  and a browser add headers that no contract describes.
- An operation that declares no `requestBody` accepts no request body. A
  request that carries one is rejected with a `400` `invalid_request`, because
  the size limit of a body the operation never accepts is not the useful
  answer. An operation that does declare a `requestBody` accepts only the media
  type it declares; any other media type is a `415`
  `unsupported_media_type`.
- Responses are checked twice, in every environment. The route wrapper checks
  the answer of a handler before the framework writes it: the media type must
  be one the operation declares for that status, and a `json` answer must be an
  object or an array. A pre-serialized string, a byte buffer, and a stream are
  rejected there, because no later schema check could read their members. The
  `preSerialization` hook then validates the members against the declared
  schema.
- An undeclared status, an undeclared media type, a body of the wrong kind, and
  an undeclared member all become a `500` `invalid_response` problem that
  carries the request id and never the rejected body. The rejection is logged
  once at error level with the request id, the operation, the status, the media
  type, and the reason, and never with the body.
- Only the contract creates routes, with one exception: Fastify serves `HEAD`
  for every `GET` route and drops the body, as RFC 9110 expects. That route
  reuses the `GET` operation's validators.
- Every response carries an `x-request-id` header. A caller may supply that
  header. The server echoes a value that matches the declared pattern
  (`^[A-Za-z0-9._-]+$`, 1 to 128 characters) and generates a UUID when the
  header is absent. A value outside that pattern is rejected by the normal
  header validation with a `400` problem, and that problem carries a generated
  id rather than the rejected value.
- An operation that names a security scheme needs an identity resolver. Until
  Task 5 supplies one, an operation that declares a non-empty `security` list
  stops startup with a named error. The resolver runs as a `preValidation`
  hook, so an actor is known before any input is read.

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

## Logging

`NOTESAPP_LOG_LEVEL` selects the structured log level: `fatal`, `error`, `warn`,
`info`, `debug`, or `silent`. It defaults to `info`, and `silent` disables the
logger.

Request headers are never logged. The request serializer records the method,
the URL, the host name, and the peer address only, so redaction here is by
omission: an `Authorization` header and a `Cookie` header cannot reach a log
record, and no redaction list has to stay in step with the header names that a
later task adds. A log record names an operation, a status, and a request id;
it never carries note content, a credential, or a rejected value. A change that
starts logging headers must add redaction in the same change.

## Media types

`apps/server/src/http/register.ts` holds the media type handling table. A
`json` media type is validated against the declared response schema. The `html`
and `binary` rows are the documented hook for a later task: those responses
carry bytes, so that task adds size, access, and caching checks there instead of
JSON validation. No operation returns them yet.
