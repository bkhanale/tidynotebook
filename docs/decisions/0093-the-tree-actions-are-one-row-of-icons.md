# 0093. The tree actions are one row of icons

- Status: Accepted
- Date: 2026-09-23

## Context

Records 0064 and 0069 give the sidebar a New note row, then a Folders label
with a New folder action that appears on hover, then the tree. Issue 139 asks
for an order of the notes that a person chooses: the name, the creation date
or the update date. The tree also has no way to open or close every folder at
once, so a deep tree takes one select per folder. Two more actions do not fit
beside a label, and a second row of actions would push the tree down again.

## Decision

The sidebar holds one row of icon-only actions between the workspace switcher
and the tree, in this order: New note, New folder, Sort notes, and Expand all
folders or Collapse all folders. The row replaces the New note row and the
Folders label. The row is always visible, and each action is a compact ghost
control with a `label` and a title.

- Sort notes is a menu of six alternatives, and the one in force is
  `selected`: Name, from A to Z or from Z to A. Date created, the newest or
  the oldest first. Date updated, the newest or the oldest first. Each
  direction is its own row, so one select sets the whole order.
  `apps/web/src/lib/note-order.ts` holds the orders in one table, the
  comparison of each one and the parse of the stored value.
- The order applies to the notes inside each folder of the tree. A folder has
  no date, so folders stay first and in name order from A to Z, in every
  order. The All notes page keeps its groups by recency.
- The order is a device choice, like the width of record 0035 and the open
  folders. It is stored in browser settings, it is one choice for every
  workspace, and it never reaches the account.
- The expand action is one toggle. It collapses every folder when any folder
  of the tree is open, and it opens every folder when none is.
  `apps/web/src/lib/folder-expansion.ts` holds that rule.
- The tree region takes the accessible name Folders, so a screen reader still
  names the region without a visible label.

This refines the sidebar part of records 0064 and 0069.

## Consequences

- A person sorts the tree and opens or closes it from one row, without a
  pointer as well, because each action is a button in the tab order.
- The New note action loses its visible word. Its name and its title carry it.
- The name order compares names without case, so `apple` and `Banana` read
  in alphabet order. Folders take the same comparison.
- `note-order.test.ts`, `note-list.test.ts` and `folder-expansion.test.ts`
  hold each rule.
- This answers [issue 139](https://github.com/bkhanale/notesapp/issues/139).
