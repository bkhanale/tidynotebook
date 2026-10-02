# 0178. The generator writes the address of a browser download

- Status: Accepted
- Date: 2026-10-02

## Context

The export of a workspace can be as large as the zip format allows
([record 0170](0170-an-archive-job-is-bounded-in-number-in-disk-and-in-time.md)).
`downloadAll` in `apps/web/src/features/export/export.ts` read it through the
generated `exportWorkspace`, so a browser without the File System Access API,
such as Firefox and Safari, held the whole archive in a blob, and a
multi-GiB export could fail there. A browser saves a download to its disk as
it arrives only when it reads the address itself. The rules forbid a request
URL in feature code, and the generated client names an address only inside a
request.

## Decision

- An operation that a browser may read itself states
  `x-notesapp-browser-address: true` in the contract. `tools/sdk-codegen`
  refuses the extension on any operation but a `GET` with no request body and
  no required query or header parameter, and writes
  `packages/api-client/src/generated/addresses.gen.ts`: one typed builder for
  each such operation, `<operationId>Address`, from the path of the contract,
  with each path parameter encoded and the base URL of the client.
- `exportWorkspace` is the one such operation. `downloadAll` asks the new
  `inspectWorkspaceExport`, a `HEAD` of the same address, which plans the
  archive and runs no job, so a refusal reaches the person as a sentence. It
  then hands the address to the browser as an anchor with `download`. That is
  the one download path of an export, and the File System Access path goes.
- A `GET` of the export changes nothing but its job reservation. The session
  cookie is `SameSite=Lax`, so no cross-site request of a page carries it, and
  the export refuses a request that states `Sec-Fetch-Site: cross-site`, so a
  cross-site navigation cannot start a job of the account either. The answer
  is `Content-Disposition: attachment` with `nosniff`, so no browser renders
  it.

This changes what the contract emit produces, so it is a record of its own.
It excludes an address builder for every operation: an address that a feature
can read without the client is an exception for a download, not a second
transport.

## Consequences

- An export of any size saves to the disk of the device in every browser.
- A job that becomes busy between the check and the download fails in the
  download list of the browser, not in the page.
- `tools/sdk-codegen/src/addresses.test.ts` proves the builder and the
  refusals, and `tests/integration/export.test.ts` proves the served answer,
  the check and the cross-site refusal.
