# 0021. Portable Markdown at rest

- Status: Accepted
- Date: 2026-09-11

## Context

A note stores two references that only this application resolves: an image as
`![name](/attachments/<revision-id>)`
(`apps/web/src/features/note-editor.tsx:857`) and a note link as
`/notes/<file-id>` (`packages/markdown/src/links.ts`,
`packages/markdown/src/policy.ts`). Export writes the image bytes to
`attachments/<revision-id>.<ext>` (`apps/server/src/http/export.ts:137`) and
does not rewrite the text, so every exported image is a dead link. See
[design 004](../design/004-portable-markdown-at-rest.md).

## Decision

The stored text of a note is portable Markdown. The rules:

- A reference inside note text is a relative path. No URL scheme of this
  application stays in note text.
- An image is a file in the tree under one `attachments/` folder at the
  workspace root. A note link is a relative `.md` path, which is what
  `relativeNotePath` in `packages/editor/src/completion.ts` already inserts.
- `classifyUrl` accepts a relative path and refuses a resolved path that
  leaves the workspace root.
- The renderer and the live preview resolve a reference against the path of
  the note that holds it, through the typed resolvers that exist.
- A rename or a move of a note, an image, or a folder rewrites every inbound
  relative link in the same changeset
  (`packages/core/src/files/operations.ts`).
- Export copies the tree. Import reads a folder of `.md` files and images into
  the tree. Neither one rewrites a reference.

## Consequences

The link index stores a target path and not a file identifier, so backlinks on
standard links, deferred by
[decision 0004](0004-standard-links-between-notes.md), land with this work. The
attachment kind of the file tree (`packages/core/src/files/ports.ts`) becomes
the one home of an image.

A migration step rewrites the 0.1.0 content from `/attachments/<id>` and
`/notes/<id>` to relative paths, and reports each reference that resolves to nothing.

The rows are in [the 0.2.0 list](../releases/0.2.0.md), and the accepted debt
row of [the 0.1.0 list](../releases/0.1.0.md) names the content that the
migration rewrites. A rename now costs a write per inbound link.
