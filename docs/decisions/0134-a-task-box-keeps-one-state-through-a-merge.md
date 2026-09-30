# 0134. A task box keeps one state through a merge

- Status: Accepted
- Date: 2026-09-30

## Context

A toggle of a task box replaces the one character between its brackets. The
toggle stayed on its device until the next boundary of record 0022, which is
a pause of seconds. A person who toggled the box on a second device in that
time wrote a second replacement of the same character. The document keeps
both insertions, so the box read `[x ]`, `[ x]` or `[xx]`. That is no task
box, and the person can no longer toggle it. Two writers that replace one
character both win in the document, whatever the order of the saves.

## Decision

- A toggle of a task box is a boundary of record 0022. The editor
  checkpoints at once, and a toggle during a checkpoint gets the next one.
- When the server accepts a save that wrote into a task box whose states come
  from more than one editor, it keeps the last character that this save wrote
  in the box and deletes the other characters of the box, in the same accept
  step. The two states can meet on the server or on a device before it saves,
  so every save of text work asks. The save that the server accepts last sets
  the box, which is the toggle that the person made last.
- `packages/core/src/files/task-boxes.ts` finds a box with more than one
  state, and `packages/note-document` reads the editor of each character. A
  box that one editor wrote alone stays exactly as the person wrote it.

This refines records 0022 and 0081. Every other part of those records stands.

## Consequences

- A person who toggles a box on two devices sees the state of the last toggle
  on both, and each toggle is one version in History.
- A device can show a box with two states for a moment, until the server
  answers the save that it sent at the toggle.
- `tests/integration/sync.test.ts` proves two concurrent toggles, and the unit
  tests beside the rule and the byte operation prove each case.
