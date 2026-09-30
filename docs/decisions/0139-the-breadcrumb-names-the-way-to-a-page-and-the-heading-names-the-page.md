# 0139. The breadcrumb names the way to a page, and the heading names the page

- Status: Accepted
- Date: 2026-10-01

## Context

Record 0064 ends the breadcrumb with the name of the page, and record 0091
takes that name from the route table. Every page but the note also opens with
a heading of the same name, and record 0138 puts the back control on that
heading. A person read the name twice, one line apart: "Personal / Trash",
then "Trash". The note has no heading, because its name is the last part of
the breadcrumb (record 0069). The owner asked for one name on 2026-10-01.

## Decision

- The heading names the page. The breadcrumb names the way to it: the
  workspace, the folders of a note, and the page above, from `pageParents`
  in `apps/web/src/lib/breadcrumb.ts`. `leafOf` names the note alone, and a
  page that is not the note has no last part.
- `parentPartOf` in the same module turns the page above into a part. It is
  the note for History and Review, Settings for Accounts, and no part for a
  page above which the workspace part already names.
- A separator stands between two parts and never after the last one.

## Consequences

- One name for a page on the screen, in its heading. The breadcrumb of
  History and of Review goes back to the note in one step.
- Below the medium width the breadcrumb shows only its last part, so a page
  that is not the note shows none there, and its heading follows the header.
- `breadcrumb.test.ts` holds the parts of every page and the lone note name.
- This refines records 0064, 0091 and 0138.
