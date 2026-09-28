# 0128. The server validates every notice frame

- Status: Accepted
- Date: 2026-09-28

## Context

Record 0126 generates the message boundary of the sync notice stream. The
trial of [issue 188](https://github.com/bkhanale/notesapp/issues/188) with the
pinned tools found three facts that the record does not settle.

- The content security policy in `apps/server/src/plugins/security-headers.ts`
  has no `unsafe-eval`, so Ajv cannot compile a validator in the browser. Ajv
  standalone output keeps a CommonJS import of its runtime for a string length,
  also in module mode.
- The pinned Redocly CLI keeps a reference to a schema component when it
  bundles `asyncapi.yaml`. It writes a channel, a message and a security scheme
  in full at each place that names one.
- The strict rule `operation-2xx-response` refuses the upgrade operation,
  because the success of an upgrade is 101.

## Decision

- The server validates every message that it receives and sends with
  `packages/api-contract/src/messages.ts`, from the payload schemas that Hey
  API also types. No validator enters the browser bundle.
- The browser reads a server frame through `readSyncNoticesMessage` in
  `packages/api-client/src/generated/socket.gen.ts`, which checks the kind
  only. This is the trust of the generated HTTP client, which reads an answer
  that the server validated before it sent it.
- A channel is one file under `packages/api-contract/channels/` that holds its
  messages, as a path item file holds its operations. The operations stay in
  `asyncapi.yaml`. `tools/sdk-codegen/src/message-contract.ts` finds a channel
  by its address, a message by its name, and a security scheme by its content.
- One reviewed entry of `packages/api-contract/.redocly.lint-ignore.yaml`
  exempts the 101 answer of `openSyncNotices` from `operation-2xx-response`.
- The upgrade is the protocol operation `sync-notices`. Until plan 016 turns
  notices on, `apps/server/src/routes/sync-notices.ts` answers 503
  `notices_unavailable` after the identity and request checks, and
  `getSyncProtocol` offers no subprotocol.

This excludes Ajv standalone code in the browser, a second validator
generator, a relaxed content security policy, and a message component file
that the bundler would copy into each operation.

## Consequences

- A defect in a server message is caught at the server, before any frame
  leaves it. A client can still act on a frame of a defective server, as it
  can on an HTTP answer.
- `tools/sdk-codegen/src/dialect.test.ts` proves the shared dialect with the
  pinned lint. `packages/api-contract/src/messages.test.ts` proves both
  directions. `tests/integration/contract.test.ts` proves the served upgrade
  and the client entry against the server boundary.
