# Adding a WebSocket message

This page owns the message contract of a WebSocket channel: where a message is
declared, what generation checks, and what the server and the browser do with
a frame. [Adding an API operation](api-contract.md) owns the HTTP side,
including the upgrade operation that opens a channel.

## Why two roots

HTTP response hooks cannot see a frame after an upgrade, so the messages have
their own contract. `packages/api-contract/openapi.yaml` owns HTTP and the
upgrade address. `packages/api-contract/asyncapi.yaml` owns the messages and
the WebSocket binding. See
[decision 0126](../decisions/0126-websocket-messages-use-the-generated-contract.md)
and [decision 0128](../decisions/0128-the-server-validates-every-notice-frame.md).

## Where the pieces live

| Path                                              | Purpose                                   |
| ------------------------------------------------- | ----------------------------------------- |
| `packages/api-contract/asyncapi.yaml`             | The operations and the list of channels.  |
| `packages/api-contract/channels/`                 | One file per channel, with its messages.  |
| `packages/api-contract/components/schemas/`       | The payload schemas, shared with HTTP.    |
| `packages/api-contract/src/messages.ts`           | The frame check of the server, both ways. |
| `packages/api-client/src/generated/socket.gen.ts` | Address, subprotocol, types, and frames.  |
| `tools/sdk-codegen/src/message-contract.ts`       | The checks between the two roots.         |

## Steps

1. **Write the payload schema** under `components/schemas/`. It is a closed
   object with a `kind` member that holds one string constant. Use only the
   keywords that AsyncAPI 3.0 and JSON Schema 2020-12 read the same way. The
   lint refuses a 2020-12 keyword such as `prefixItems`.
2. **List the schema in `openapi.yaml`**, so Hey API writes its type. The
   message contract refuses a payload that the HTTP root does not list, or
   lists with other content.
3. **Add the message to its channel file** under its kind, with the kind as its
   name, and name it in the send or the receive operation of `asyncapi.yaml`.
   The document describes the server: it receives what a client sends.
4. **Run `pnpm contract:lint`**, then **`pnpm generate`**, and commit the
   generated output with the contract.
5. **Handle a client message on the server.** `assertMessageHandlers` stops
   startup when a handler is missing or names no client message.
6. **Test both directions** in `packages/api-contract/src/messages.test.ts`,
   and the served result in `tests/integration/contract.test.ts`.

## What generation refuses

- A channel address that is not the path of exactly one upgrade operation, and
  an upgrade operation with no channel. An upgrade is a GET that answers 101
  and requires the subprotocol header.
- A channel binding and an upgrade operation that name two subprotocol schemas.
- A payload without a constant kind, a kind that is not the message name, two
  messages of one kind, and a message that no operation names.
- An operation without a security scheme, and a scheme that serves none.
- A schema that neither root reaches, and a source file that no root lists.

The pinned Redocly CLI keeps a reference to a schema when it bundles
`asyncapi.yaml`, and writes a channel, a message and a security scheme in full
where one is named. So the check finds a channel by its address, a message by
its name, and a scheme by its content.

## Who validates a frame

The server validates every frame that it receives and every message that it
sends. A refusal names the failed members and copies no value. The browser
reads a frame through `readSyncNoticesMessage`, which checks the kind only,
because the content security policy keeps Ajv out of the browser. Feature code
never opens a socket or builds its address: `tools/check-boundaries.mjs`
refuses a raw `WebSocket` and a socket library outside a named adapter file.
