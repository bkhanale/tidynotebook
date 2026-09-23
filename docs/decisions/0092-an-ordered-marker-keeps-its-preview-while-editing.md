# 0092. An ordered marker keeps its preview while editing

- Status: Accepted
- Date: 2026-09-23

## Context

Record 0089 makes a nested ordered list show its depth through decimal,
lower-alpha and lower-roman labels. The live preview returns to the numeric
Markdown marker while the selection touches any part of the item line
(`packages/editor/src/live-preview.ts`). The label therefore changes while a
person writes the item and changes back after Enter moves the caret away.

## Decision

The live preview keeps the rendered ordered marker while a person edits the
text of its item. It reveals the numeric Markdown marker only when the
selection touches that marker. This record refines the ordered-marker reveal
rule of record 0089. Other Markdown markers keep the general reveal rule, and
the task box keeps the control rule of record 0033.

## Consequences

- A nested list keeps its final hierarchy while a person writes it.
- A person can still select and edit the numeric Markdown marker directly.
- `packages/editor/src/live-preview.test.ts` holds both selection cases.
