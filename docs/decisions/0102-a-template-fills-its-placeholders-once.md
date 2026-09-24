# 0102. A template fills its placeholders once

- Status: Accepted
- Date: 2026-09-25

## Context

Record 0099 copies the text of the template into a new daily note as it is,
and it names no placeholder syntax, so that no second grammar enters the
product (record 0001). The owner asks that a template write the date with the
tokens of the name format of record 0101 when they are typed inside double
braces, as a template of Obsidian does, and that the scheme grow with new
values.

## Decision

- A placeholder is `{{name}}` or `{{name:argument}}`, with space allowed
  inside the braces. `packages/core/src/daily-notes/template.ts` holds one
  table of variables. Each row takes the context of the new note and the
  argument, and a new variable is one more row.
- The variables are `date`, which writes the date of the note as
  `YYYY-MM-DD` or as the format of its argument, and `title`, which writes
  the name of the note. `{{date:dddd, D MMMM YYYY}}` takes every token of
  record 0101.
- A placeholder that is a bare format, such as `{{YYYY-MM-DD}}` or
  `{{dddd}}`, writes the date as well. It counts as a format only when every
  letter outside square brackets belongs to a token, so a word such as
  `{{Monday}}` is not read as tokens.
- The date is the date of the daily note, not the date of the device, so the
  note of an earlier day states that day.
- A placeholder that names nothing stays as it is, so no text of the template
  is lost.
- The fill happens once, when the device makes the note. The stored note is
  portable Markdown (record 0021), and the template note keeps its braces as
  text. Markdown gains no syntax, so record 0001 holds.

This replaces the placeholder bullet of record 0099.

## Consequences

- A daily note starts with its own date, its weekday and its name.
- A time variable needs time tokens, which the name format of a path must not
  take, so it waits for a record of its own.
- `template.test.ts` in `packages/core/src/daily-notes/` holds the rules.
