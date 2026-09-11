# 0010. One command palette

- Status: Accepted
- Date: 2026-09-10

## Context

Three separate ways to find a note existed: a header search dropdown, a
`Cmd+O` quick open, and a command list. Each had its own matching rules and
its own keyboard behaviour.

## Decision

`Cmd/Ctrl+K` opens one dialog. It lists recent notes, matches names first and
content second, and offers actions: New note, Toggle theme, Shortcuts, Open
history, and Toggle Read mode. The header search dropdown and the `Cmd+O`
quick open are removed. A search icon in the header opens the same dialog at
every width. `Cmd+O` stays as an alias.

## Consequences

- One matching rule set lives in `apps/web/src/features/palette-items.ts`,
  which is a pure module with unit tests.
- A new action is one entry in that module.
- The header keeps one search control at every screen width.
