# 0169. The server compresses a large JSON read

- Status: Accepted
- Date: 2026-10-02

## Context

Record 0013 puts delivery in the application, because a deployment may have
no proxy. `apps/server/src/plugins/static-assets.ts` serves precompressed
files, but no JSON answer is compressed, so a full read of a large note and a
full page of the file list go out at their whole size
([issue 264](https://github.com/bkhanale/notesapp/issues/264), measured in the
[performance audit](../audits/2026-10-02/performance.md#server)). The Caddy
profile of `docker-compose.yml` compresses, and a bare deployment does not.

## Decision

- `apps/server/src/plugins/compression.ts` compresses the JSON answer of a
  `GET` of a contract operation when its body reaches
  `compressionThresholdBytes`. It takes Brotli at a low quality, or gzip,
  in the order of `acceptedEncodings` of `static-assets.ts`, and it writes
  `Vary: Accept-Encoding`. The work runs in the thread pool of `node:zlib`.
- An answer that sets a cookie, a write, an answer that is already encoded and
  an answer that is not JSON stay as they are. A write can carry a new secret,
  such as the token of a published link, beside text that the caller chose.
- The entity tag of `getFile` stays the tag of the revision. It is the
  precondition of a write, so it names the state of the note and not its
  bytes. The server serves no range of a JSON answer, and a cache keys each
  coding apart by `Vary`.
- A proxy in front sees an encoded answer and does not encode it again.

This excludes compression in a proxy alone, because record 0013 promises a
deployment that needs no proxy, and a per operation list, which would drift
from the contract.

## Consequences

- A large read costs a few milliseconds of a worker thread of the server and
  sends a fraction of its bytes.
- A read cannot be cut into parts by a range request.
- `apps/server/src/plugins/compression.test.ts` proves the rule of each answer,
  and `tests/integration/revisions.test.ts` proves a served read, its headers,
  its tag and a plain read.
