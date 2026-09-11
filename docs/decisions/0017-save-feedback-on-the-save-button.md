# 0017. Save feedback lives on the Save button

- Status: Accepted
- Date: 2026-09-11

## Context

Plan item UI-01 asked for a persistent save and sync chip in the header, and
UI-05 asked for a connection state in the header at every width. The chip was
built and tried. The owner read it as a second control next to Save that says
what Save already says, so it added noise and no help.

## Decision

The Save button carries the save state. `resolveSaveButton` in
`apps/web/src/features/save-state.ts` selects one of four labels: `Save`,
`Saving`, `Saved on this device`, and `Saved`. The button accepts a press only
in the `Save` state, so the label and the action agree. The note footer
(`note-footer.tsx`) shows the relative time of the last version, and the
sidebar shows one connection sentence (`shell.tsx`). The header holds no save
chip and no sync chip. The note screen keeps `data-save-state` on its root, so
automation still reads one state without reading copy.

## Consequences

The person reads the result on the control they pressed, and the screen holds
one save word at a time. Plan items UI-01 and UI-05 are satisfied by these
three places, not by a header chip, so the plan rows close with this record as
their evidence. A phone user reads the state on the button, which is always
visible, but must open the drawer to read the connection sentence. The gate is
`apps/web/src/features/save-state.test.ts`, which holds the state table and
the labels.
