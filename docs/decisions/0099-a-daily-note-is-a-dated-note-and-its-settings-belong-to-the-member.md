# 0099. A daily note is a dated note and its settings belong to the member

- Status: Accepted
- Date: 2026-09-24

## Context

[Issue 138](https://github.com/bkhanale/notesapp/issues/138) asks for one note
for each day, a template for a new daily note, a choice to open the note of
today at start, and a calendar that opens the note of a date. The product has
two kinds of file and no field on a note, and the save model of record 0022
makes a new note a local draft that the first checkpoint sends. Two settings
already exist: the theme follows the account (`account_preferences`), and the
note order is a device choice (record 0093). A template is a note of one
workspace, so an account setting cannot name it. A device setting would let a
second device make a daily note without the template.

## Decision

- A daily note is an ordinary note at `Daily notes/YYYY-MM-DD.md`, dated in
  the calendar of the device. No file kind, flag or index marks it.
  `packages/core/src/daily-notes/path.ts` holds the one path rule and its
  parse. A note that a person moves or renames away from that path is no
  longer the note of its date.
- To open a date is to open the live note at its path. When there is none,
  the device makes a local draft at that path, with the text of the template
  copied once, as it is. The template has no placeholder syntax, because a
  second grammar would break record 0001. The save model does not change.
- The settings are a template, as the identifier of a note, and a choice to
  open the note of today at start. They belong to one member of one workspace:
  the table `daily_note_settings` keyed by the workspace and the account.
  `getDailyNoteSettings` and `updateDailyNoteSettings` read and write them,
  and `packages/core/src/daily-notes/settings.ts` holds the rules. An update
  refuses a template that is not a live note of the workspace with
  `not_found`. A row goes with its membership, and a purge of the template
  clears the reference. The browser keeps the last answer for a start with no
  connection. The server is the source.
- A template in Trash reads as no template until a restore brings it back,
  and the stored reference stays.
- The calendar is the frame page `daily`, named Daily notes (record 0091). It
  holds the one primary action, Open today's note, a month of days that marks
  each day with a note, and the two settings. The sidebar footer has a row
  for it, and the palette has Open today's note and Go to Daily notes.
- The note of today opens at start when the setting is on and the first page
  of the frame is the note list. An address of a note or of another page opens
  what it names. This happens once for each load of the application.

## Consequences

- A daily note is portable Markdown at rest (record 0021): an export, a search
  and a link treat it like any other note.
- A setting follows the person to every device and never changes the choice
  of another member.
- A device with no connection that does not hold the template text refuses to
  make the note, rather than make it without the template.
- `path.test.ts` and `settings.test.ts` in `packages/core/src/daily-notes/`,
  the unit tests of `apps/web/src/lib/daily-note*.ts` and `calendar-month.ts`,
  and `tests/integration/daily-notes.test.ts` hold the rules.
