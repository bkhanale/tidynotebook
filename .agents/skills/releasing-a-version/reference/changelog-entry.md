# The changelog entry

The entry is the one record of a release. The GitHub release body is generated
from it by `node tools/release-notes.mjs X.Y.Z`, so the entry is the only place
where the words of a release are written.

## Contents

- The shape
- The words
- A worked example
- What the gate refuses

## The shape

```
## X.Y.Z - YYYY-MM-DD

<One paragraph. It states what the release gives a person.>

### <Section>

- <One item. One idea.>
```

- The heading holds the bare version, a space, a hyphen, a space, and the date
  of the release day. No `v`, no name, no link.
- The summary paragraph comes first. It is never a heading.
- A section heading is one of `Added`, `Changed`, `Deprecated`, `Removed`,
  `Fixed`, `Security`, in that order. Leave out a section that holds nothing.
- Each item is a list item that starts with `- `. Wrap the prose at 80
  columns. The notes tool joins each wrapped line back into one line.
- A new entry goes above the previous entry, under the header of the file.

## The words

Write every line for the person who reads the release, in ASD-STE100
Simplified Technical English.

- One idea in one sentence. The active voice. The present tense.
- Name the thing that a person sees: the note, the folder, Trash, History,
  Save, Publish, Read, Write. Keep one term for one thing.
- State the result, not the code. No file path, no package name, no identifier,
  no commit, no issue number, no error code.
- A count takes the whole phrase: `1 note`, `3 notes`. Never `note(s)`.
- Sentence case for a heading and a label. A product name and a key name keep
  their own case.
- No em dash and no en dash.
- A bold lead is allowed for a large item in a minor release, for example
  `- **One typeface.** The application is set in Geist.`

## A worked example

```
## 0.3.3 - 2026-09-19

This patch release simplifies the Trash delete flow and keeps the Publish
action quiet at rest.

### Changed

- Trash uses Delete for the remove action. The page states that Delete removes
  a note for good.
- The Publish action in the note header stays quiet at rest. It gains a fill
  only when a pointer or the keyboard reaches it.
```

That entry renders this release body:

```
This patch release simplifies the Trash delete flow and keeps the Publish action quiet at rest.

### Changed

- Trash uses Delete for the remove action. The page states that Delete removes a note for good.
- The Publish action in the note header stays quiet at rest. It gains a fill only when a pointer or the keyboard reaches it.
```

## What the gate refuses

`node tools/release-check.mjs before X.Y.Z` reads the entry and refuses:

- an entry that is not the newest one in the file;
- a date that is not the day of the release;
- a version that is not above the previous entry;
- an entry that opens with a heading instead of the summary paragraph;
- a section heading outside the six names above;
- a missing status line in `README.md`.
