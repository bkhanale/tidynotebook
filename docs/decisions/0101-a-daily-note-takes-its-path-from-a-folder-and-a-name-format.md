# 0101. A daily note takes its path from a folder and a name format

- Status: Accepted
- Date: 2026-09-25

## Context

Record 0099 fixed the path of a daily note at `Daily notes/YYYY-MM-DD.md`. The
owner asks for the folder and the name to be settings, as Obsidian has them: a
name format of date tokens such as `YYYY`, `MM` and `dddd`, where a `/` in the
format makes folders, for example `YYYY/MM/YYYY-MM-DD dddd`. The path is the
one fact that makes a note the note of its date, so every device and every
surface must write and read it by one rule.

## Decision

- The settings of record 0099 gain a folder and a name format. The folder is a
  folder path, and an empty folder is the top of the workspace. The defaults
  are `Daily notes` and `YYYY-MM-DD`, the fixed path of record 0099.
- The format takes a subset of the tokens of moment.js, which Obsidian uses:
  `YYYY`, `YY`, `Q`, `MMMM`, `MMM`, `MM`, `M`, `DD`, `D`, `Do`, `dddd`, `ddd`,
  `dd` and `d`. Text inside square brackets is literal. Any other character is
  literal, and a `/` separates folders. A week token is not supported, because
  a week and a day of the week cannot name a date alone in this subset.
- The names of months and days are always English. A path that followed the
  language of a device would give two devices two notes for one date.
- A format must state a year, a month and a day of the month, so two dates
  never share one path. The formatted path of every date must pass the path
  rules of `files/path.ts`. An update that breaks either rule answers
  `invalid_path`.
- A path is the note of a date when that date, formatted again, gives the same
  path. That one comparison holds the padding, the weekday, the ordinal and
  the quarter, and it needs no second parser of names.
- `packages/core/src/daily-notes/format.ts` holds the format and its parse,
  and `packages/core/src/daily-notes/calendar.ts` holds the day arithmetic that
  the weekday tokens and the calendar of the sidebar share.
- A change of the folder or the format moves no note. A note at the old path
  stays an ordinary note, and the calendar marks the days of the new path.

This refines record 0099.

## Consequences

- A person keeps daily notes in any folder and in any layout of folders that
  a date can name.
- Literal text that holds a token letter needs square brackets, as it does in
  Obsidian: `[Journal] YYYY-MM-DD`.
- `format.test.ts`, `calendar.test.ts` and `path.test.ts` in
  `packages/core/src/daily-notes/`, and `tests/integration/daily-notes.test.ts`
  hold the rules.
