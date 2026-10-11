# 0209. The API reference comes from the client contract

- Status: Accepted
- Date: 2026-10-08

## Context

Programs use personal keys through the shared API (record 0208). The guide
site has no API reference. A separate list of operations or security rules
can drift from the server. The client generator already bundles the YAML
contract and adds the authentication fragment (record 0019).

## Decision

- `tools/sdk-codegen/src/generate.ts` emits the merged OpenAPI document as
  JSON beside the generated operation index. `pnpm generated:check` checks it.
- `apps/docs/src/api-reference.ts` turns that document into Markdown pages.
  It takes operations, descriptions, parameters, bodies, responses, schemas,
  and effective security requirements from the contract only.
- The existing docs build renders these pages with the shared Markdown
  renderer and page frame. It includes them in navigation, search, Markdown
  copies, agent files, and the sitemap (records 0152 and 0153).
- The site publishes the same JSON document. It sends no API request and
  stores no credential. There is no handwritten API reference or new renderer.
- This extends the guide-only source rule of record 0152. Guide pages keep
  their source and order. Generated pages link the contract as their source.

## Consequences

A contract change updates the API reference through generation and the normal
docs deployment. Unit tests prove security inheritance and page generation.
`tests/integration/docs-site.test.ts` proves coverage against the runtime
operation index and checks the built links, search, and downloadable contract.
The operator API and its cloud callers keep the same interface.
