# 0171. A wiki link becomes a standard link at the border

- Status: Accepted
- Date: 2026-10-02

## Context

Record 0004 stores standard links between notes. The list after `[[` inserts
one, but a typed, pasted or imported `[[Note]]` stays text, and the links of
an Obsidian vault do not work (issue 241, audit finding 5). The import of
`apps/server/src/routes/import.ts` refuses a picture outside `attachments/`,
where a vault keeps none. See
[design 022](../design/022-markdown-of-other-tools.md).

## Decision

- Record 0004 stands: no surface reads the wiki form. A wiki link becomes a
  standard link when it enters a note and its target resolves, and keeps its
  text when it does not.
- `packages/markdown/src/wiki-links.ts` is the one converter. It reads the
  parse tree, so code, math, a link and an escaped `\[[` stay as they are. It
  writes `[[Note]]`, `[[Note|label]]`, `[[Note#Heading]]`, `[[folder/Note]]`
  and `![[image.png]]` as a link or a picture, an embed of a note as a link.
- A target resolves as in Obsidian: a path from the folder of the note, then
  from the root, then a bare name among all notes, case aside. Of several
  matches, the one in the folder of the note wins, then the shortest path. A
  tie stays text.
- The destination is `portableRelativePath` of `rewrite.ts`, which encodes
  `%`, a space, `(`, `)`, `#`, `?`, `<` and `>`. `noteLinkLabel` escapes the
  label. The list after `[[` writes the same link.
- The border is four places: the list after `[[`, the closing brackets that a
  person types, a paste of text (with the notes of the device), and an import.
- An import leaves out every entry with a segment that starts with a dot, and
  `__MACOSX`. A picture outside `attachments/` moves to
  `attachments/<its path>`, and the standard links to it follow. A note whose
  conversion grows past `markdownLimits` keeps its text.

This refines records 0004 and 0009.

## Consequences

- A vault of notes and pictures imports with working links and pictures, and
  an export holds standard links only.
- An embed of a note is a link, not the note drawn inside another.
- `wiki-links.test.ts` holds the forms, the resolution and each refusal,
  `completion.test.ts` the list and the typed brackets, `paste.test.ts` the
  paste, and `tests/integration/export.test.ts` a vault import.
