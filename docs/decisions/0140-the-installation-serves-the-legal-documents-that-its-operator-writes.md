# 0140. The installation serves the legal documents that its operator writes

- Status: Accepted
- Date: 2026-10-01

## Context

Record 0120 names the terms and the privacy notice by an address and a
version, and `readLegalDocuments` in `apps/server/src/config.ts` accepts only
an external address. An operator who opens registration must therefore host
two documents on another server before record 0114 lets the `open` policy
start. The product ships no starting text, and nothing stops an operator from
publishing a template that still holds a blank. The owner asked on 2026-10-01
for everything that opens sign-up, the terms and the privacy notice included.

## Decision

- The operator names each document by an address, as before, or by a
  Markdown file: `NOTESAPP_TERMS_FILE` and `NOTESAPP_PRIVACY_FILE`. One
  document takes one of the two, and the version stays required.
- The server reads a named file once at startup and renders it with
  `renderMarkdown` of `packages/markdown`, the one renderer. It serves the
  result at `/legal/terms` and `/legal/privacy` of the application origin, as
  one server-built document with no script, as record 0031 builds the
  published page. `apps/server/src/routes/legal-document.ts` writes it.
- The address of a served document is that path on the application origin,
  so the sign-up form and the consent step link it with no change.
- `docker/legal/` holds a template of each document that states what this
  product stores, for how long, and which service it sends data to. A blank
  of the template is a marker in double braces. The server refuses to start
  while a named file still holds one.
- The operator still writes the words and answers for them. The product does
  not choose a jurisdiction, a legal person, or a legal basis.

## Consequences

- An installation opens registration with no second web server.
- A template that nobody completed cannot reach a person.
- A change of a file reaches a person at the next start. The version still
  decides who accepts again, so a fixed typo needs no new consent.
- `config.test.ts` proves the refusals, `legal-document.test.ts` the page, and
  `tests/integration/legal-documents.test.ts` the served answer.
- This refines record 0120.
