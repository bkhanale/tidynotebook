# 0004. Standard links between notes, no wiki syntax in v0.1

- Status: Accepted
- Date: 2026-09-10

## Context

The editor, the render policy, and the link index each carried `[[Title]]`
support. Wiki syntax is not CommonMark, so an exported file does not open
correctly in another Markdown application. The stated goal is that nothing
is stored that cannot be exported as plain Markdown files.

## Decision

`[[Title]]` support is removed from the editor, the renderer policy, and the
index. A link to another note is a standard Markdown link to its path.
Autocompletion offers the note list when the person types `](`, and a
`[[`-style trigger inserts a standard link. Backlinks and the link index
return in v0.2, built on standard links.

## Consequences

- An exported note opens correctly in any CommonMark reader.
- `extractLinks` in `packages/markdown` reports standard links only.
- The backlinks screen is removed from v0.1.
