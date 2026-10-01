# 0149. One template engine fills a note at the caret

- Status: Accepted
- Date: 2026-10-01

## Context

[Issue 220](https://github.com/bkhanale/notesapp/issues/220) asks for a
template that any note can take, not only a new daily note. The palette must
offer Insert from template, list only the notes of one template folder, and
write the filled text at the caret. The engine of record 0102 lives in
`packages/core/src/daily-notes/template.ts`, and its date tokens live in
`daily-notes/format.ts`, so a second caller would import a daily note rule or
copy it. Record 0102 also left a time variable for a record of its own.

## Decision

- `packages/core/src/templates/template.ts` is the one engine. Daily notes and
  Insert from template both call `fillTemplate`. A new variable is one more row
  of its table, and every caller gets it.
- The tokens move to `packages/core/src/dates/`, with the calendar. One reader
  of a format takes a vocabulary. A daily note path and a bare placeholder such
  as `{{dddd}}` read the date tokens of record 0101 alone, so no stored path
  and no template text changes its meaning.
- The argument of `{{date:...}}` and `{{time:...}}` also reads the time tokens
  `HH`, `H`, `hh`, `h`, `mm`, `m`, `ss`, `s`, `A` and `a`. `{{time}}` writes
  `HH:mm`. A bare placeholder never reads a time token, because a word such as
  `{{had}}` would become a time.
- Insert from template fills with the date and the time of the device and the
  name of the open note. A daily note keeps the date of its day, as record
  0102 says, and takes the time at which the device makes it.
- The template folder is a setting of one member of one workspace, as the
  daily note settings are (record 0099): the table `template_settings`,
  `getTemplateSettings` and `updateTemplateSettings`, and the rules in
  `packages/core/src/templates/settings.ts`. The default is `Templates`. An
  empty folder or a folder that the path rules refuse is `invalid_path`.
- A template is a live note below that folder, also in a subfolder.
  `isTemplatePath` is the one test. The daily note template stays any note.
- The palette action does not run at once: it turns the palette into a list
  of templates, with the one search field and the one keyboard model of the
  palette (record 0010). A choice closes the palette, and the open note reads
  the text, fills it, and writes it over the selection in one transaction.
- The text is filled once, and the note stores plain Markdown (record 0021).
  Markdown gains no syntax, so record 0001 holds.

This refines record 0102 and moves its engine.

## Consequences

- A person makes a monthly list from one note: `{{date:MMMM YYYY}}` writes the
  month and the year of the day they insert it.
- The browser keeps the last answer of each member setting through one hook,
  `apps/web/src/shell/member-settings.ts`, which the daily note settings read
  too.
- `template.test.ts` and `settings.test.ts` in `packages/core/src/templates/`,
  `format.test.ts` in `packages/core/src/dates/`, the unit tests of
  `apps/web/src/lib/templates.ts` and `palette-items.ts`, and
  `tests/integration/template-settings.test.ts` hold the rules.
