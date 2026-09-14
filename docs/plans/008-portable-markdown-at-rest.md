# Plan 008: Portable Markdown at rest

Status: active

> The live item is [GitHub issue 71](https://github.com/bkhanale/notesapp/issues/71) on the project board.

This plan turns [design 004](../design/004-portable-markdown-at-rest.md) and
[decision 0021](../decisions/0021-portable-markdown-at-rest.md) into ordered
work.

## Decisions

- [0021. Portable Markdown at rest](../decisions/0021-portable-markdown-at-rest.md)
- Kept: [0004. Standard links between notes](../decisions/0004-standard-links-between-notes.md)
- Kept: [0009. Export first, import later](../decisions/0009-export-first-import-later.md)
- Kept: [0019. Contract validation and shared types](../decisions/0019-contract-validation-and-shared-types.md)

## Items

1. Make Markdown policy and link extraction resolve safe relative paths.
2. Store pasted image references as relative file paths.
3. Store path targets in the link index. Rewrite inbound references with a
   move in one changeset. Refuse the move if the existing 1,000 file changeset
   cap cannot hold it.
4. Copy stored paths during export. Add a contract operation that imports a
   portable folder without a text rewrite.
5. Add a migration command that rewrites old application references and
   reports references that have no target.
6. Add unit, integration, and browser regression coverage.

## Verification

Run the Markdown, storage, export, import, and migration tests. Run
`pnpm verify`, then run the full browser matrix.
