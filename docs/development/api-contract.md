# Adding an API operation

`packages/api-contract/` is the only source of the HTTP interface. The source
is a root document, `openapi.yaml`, beside one file for each path item and one
file for each component. Redocly bundles them into the one document that the
generator reads. See
[decision 0019](../decisions/0019-contract-validation-and-shared-types.md) for
that layout, and the guide of the package for the naming rule and where each
kind of addition goes.

A change to the interface is one change that holds the specification, the
generated output, the handler, and the tests. Do not split them across commits,
and never edit a file under a `src/generated/` directory.

See [decision 0011](../decisions/0011-contract-emit-and-one-migration.md) for
why the contract emits shared definitions. A WebSocket message follows
[Adding a WebSocket message](message-contract.md).

## Where the pieces live

| Path                                   | Purpose                                     |
| -------------------------------------- | ------------------------------------------- |
| `packages/api-contract/openapi.yaml`   | The root document that lists the files.     |
| `packages/api-contract/paths/`         | One file for each path item.                |
| `packages/api-contract/components/`    | One file for each component, by section.    |
| `packages/api-contract/redocly.yaml`   | The strict rules of `pnpm contract:lint`.   |
| `packages/api-contract/src/generated/` | The operation index and its validators.     |
| `packages/api-client/src/generated/`   | The typed operations and the transport.     |
| `packages/api-client/src/configure.ts` | The one handwritten client configuration.   |
| `apps/server/src/plugins/register.ts`  | Route registration and boundary validation. |
| `apps/server/src/routes/handlers.ts`   | One handler per operation id.               |
| `tools/sdk-codegen/`                   | The generator and the generated check.      |

## Steps

1. **Write the operation.** Put the path item in its own file under `paths/`
   and add its row to `paths` in the root. Give the operation a stable
   `camelCase` operation id. The id never changes and is never reused.
2. **Declare every parameter completely**, including the serialization style. A
   client and a server must not disagree about serialization, so the generator
   refuses a parameter that leaves it unstated, and startup refuses a
   combination the boundary does not serve.
3. **Separate input and output members.** A member only a client sends is write
   only. A member only the server produces is read only. A write body object
   refuses an unknown member rather than ignoring it, and generation fails when
   it does not.
4. **Declare every response**, including the failure statuses that the
   generator requires for the shape of the operation. Every error uses the
   problem media type with a stable code. One status carries one media type.
5. **Run `pnpm contract:lint`**, then **`pnpm generate`**, and commit the
   generated output with the contract. Generation refuses a source file that
   the root document does not list, and a component that no operation reaches.
   Redocly cannot see either one, because a file the root does not list never
   reaches the bundle.
6. **Add the handler.** `createHandlers` returns one function per operation id.
   A missing handler and an unknown handler both stop startup, so the server
   cannot drift from the contract. A handler returns a status, a media type,
   and a body. It does not repeat the contract shape, because the boundary
   validates the body against the declared schema before it is sent.
7. **Add tests in the same change.** `tests/integration/contract.test.ts` calls
   the generated operation against a real listening server: the success path,
   one rejected input, and every new failure code. The coverage test then
   proves the one-to-one mapping.
8. **Run the gate.** See [Verification](verification.md).

## What the boundary enforces

The rules below exist so that a handler can trust its input and a caller can
trust its answer. The exact behaviour is in
`apps/server/src/plugins/register.ts`.

- **Input is validated before a handler runs**, with compiled validators built
  from the contract. The framework's own validator and serializer compilers are
  replaced, because the default pair reads an older JSON Schema draft.
- **The path and query schemas are closed**, and they exist even when an
  operation declares no member of that kind, so an operation with no query
  parameter rejects every query parameter. Headers stay open, because a proxy
  and a browser add headers that no contract describes.
- **Only the query slot converts a value.** A query value arrives as text on
  the wire, so the query validator converts it to the declared type. A body and
  a header carry typed values already, so their validators reject a string
  where a number is declared.
- **An operation accepts only what it declares.** A body on an operation that
  declares none is a bad request, not a size failure. Another media type is an
  unsupported media type.
- **Answers are checked twice.** The route wrapper checks the media type and
  the kind of the answer before the framework writes it, because no later
  schema check could read the members of a pre-serialized string, a byte
  buffer, or a stream. A hook then validates the members against the declared
  schema.
- **An undeclared answer is a server failure, not a leak.** It becomes a
  problem document that carries the request identifier and never the rejected
  body. The rejection is logged once with the operation, the status, and the
  reason, and never with the body.
- **Only the contract creates routes**, with one exception: the framework
  serves `HEAD` for every `GET` route and drops the body, reusing the `GET`
  validators.
- **Every answer carries a request identifier.** A caller may supply one. A
  value outside the declared pattern is rejected by the normal header
  validation, and that problem carries a generated identifier rather than the
  rejected value.
- **An operation that names a security scheme needs an identity resolver**, and
  one that names a protocol needs its adapter. Both are startup errors when
  missing. The resolver runs before any input is read, so an actor is known
  first.

## Protocol operations

A maintained protocol library can serve part of the surface. Such an operation
is marked in the contract and is different in three ways.

- It has no entry in the handler map, so a handler for it stops startup.
- Its route comes from the adapter, not from the contract loop. The adapter
  states an exact list of method and path pairs, and startup fails when a
  protocol operation is not in that list. A library release that adds an
  endpoint therefore cannot widen the surface without a reviewed change.
- Its routes live in an encapsulated scope with a raw body parser, so the
  library receives the bytes the client sent. The declared request slots and
  the answer are still validated, and the identity hook runs only when the
  operation names a security scheme, which no Better Auth operation does.

The adapter still owns the error surface: it rewrites a refused answer into the
problem shape, so every path of the deployment answers problem details.

## The authentication fragment

`tools/sdk-codegen/src/auth-contract.ts` writes the OpenAPI fragment of the
authentication endpoints from the pinned Better Auth configuration. It contacts
no provider, reads no secret, and produces the same bytes on every run.
`pnpm generate` therefore bundles the contract, merges the fragment and sorts
the result so the merged document is byte stable, and then bundles again for
the runtime index.

Only the two endpoints that answer with a redirect stay out of the fragment:
they are browser navigation, not calls a generated client makes.
[Accounts and identity](identity.md) lists the mounted routes.

## Client rules

Every application HTTP call uses a generated operation.
`tools/check-boundaries.mjs` rejects a handwritten request, a URL builder, and
a duplicate response interface. `packages/api-client/src/configure.ts` is the
one handwritten file that may set the base URL, the cookie behaviour, and the
shared error normalization. See [Toolchain](toolchain.md) for the compiler
relaxation that the generated transport needs and the test that contains it.
