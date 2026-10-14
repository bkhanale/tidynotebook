# 0227. A tool calls the contract as the actor of its grant

- Status: Accepted
- Date: 2026-10-14

## Context

The rules of an operation live in more than its use case: the contract checks
the request and the answer, a locked account keeps a fixed list (record 0201),
the limits count at the boundary (record 0193), and the log has one shape. A
tool that called the use cases directly would need a copy of each rule. The
text of a note is a CRDT document (record 0076), so a write sends document
work and not plain text. See [design 026](../design/026-a-remote-mcp-server.md).

## Decision

- Each tool states its scope and the contract operations that it calls, in
  one registry in `apps/server/src/mcp/`. A tool calls only those operations,
  through the request pipeline of the same process, as the actor of the grant.
- The adapter gives each tool call a delegation that names the account, the
  grant and the operations of the tool. The identity adapter resolves it to
  the shared actor of record 0208 and refuses any other operation. A session
  operation refuses it.
- No request from the network can present a delegation, and no delegation
  outlives its tool call or appears in a log.
- The tool list shows every tool, with its annotations. A write tool called
  with a read grant gets the `403` challenge of record 0225, so a client can
  ask the person for more access.
- A tool names a note by its workspace identifier and its file identifier.
  The list and search tools return both with the path and the name.
- A write tool on a note names the version that the client read. It reads
  the head and refuses when the head is another version, so it never changes
  work that the client did not see, and a repeated call refuses. The tool error
  asks the client to read the note again.
- An edit replaces exact text that occurs once, or the whole text. The tool
  makes the update through `packages/note-document` and sends it through
  `updateFile` with that version. Move to Trash sends the observed state of
  that head through `deleteFile`. A create refuses a path that holds a note.
- No tool removes a note for good, publishes a link, or changes an account, a
  workspace, a member, a key or a grant. Move to Trash is the only removal.
- Each tool has an input schema and an output schema, and the annotations of
  the specification: read only, destructive for Move to Trash, and closed
  world.
- A grant and an account each have a request bound through the counters of
  record 0121. A tool answer has a size bound, and a long note continues
  through an offset.
- A tool error states what happened and what the person can do next, in the
  words of the copy rules, with no identifier and no code.

## Consequences

- A rule of an operation holds for a tool with no copy, and a new tool is a
  registry row and a mapping.
- A unit test proves that each tool names existing operations and a scope, and
  that the write operations need `notes:write`. Integration tests prove that a
  delegation cannot reach another operation, that a locked account keeps its
  list, that a write refuses a head that moved, and that a repeated call
  writes nothing.
