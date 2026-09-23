# 0091. Every signed in page opens in the workspace frame

- Status: Accepted
- Date: 2026-09-23

## Context

Record 0064 makes the frame header the context of the route. Two pages that a
signed in person reaches stood outside that frame. `apps/web/src/router.tsx`
registered `/settings` beside `/w/:workspaceId`, so Settings had no sidebar, no
breadcrumb and a Back control of its own. The catch-all route drew Page not
found on a bare page, and an unknown address under a workspace reached it too.
Export, Import, the offline choices and the pending count of Settings already
act on one workspace, but they read the stored choice and not the address.
The shell named the last breadcrumb part by matching the address, and an
address it did not know read All notes. See
[issue 140](https://github.com/bkhanale/notesapp/issues/140).

## Decision

- Every page that a signed in person opens is a child of `/w/:workspaceId`, so
  it has the frame of record 0064. Settings is `/w/:workspaceId/settings` and
  reads the workspace from the address. Its account sections do not change.
- An unknown address under a workspace is the Page not found child of the
  frame.
- An address that names no workspace, such as `/`, `/settings` or an unknown
  one, opens the same path under the chosen workspace.
  `addressInWorkspace` in `apps/web/src/lib/workspace-choice.ts` states that
  address. A signed out person goes to sign in first.
- Each child route names its page in its `handle`. The shell reads the deepest
  one, and `apps/web/src/lib/breadcrumb.ts` turns it into the last part. The
  route table is the one list of pages, so a page with no name has no last
  part and does not read as another page.
- Sign in, the account load and the workspace load stay outside the frame.
  No workspace is known yet, so there is no frame to draw.

## Consequences

- The Back control of Settings goes. The breadcrumb and the sidebar are the
  way back.
- A link to `/settings` from before this record still opens Settings.
- A signed out person who opens an unknown address signs in and then reads
  their notes, and not a bare Page not found.
- The unit tests of `workspace-choice.ts` and `breadcrumb.ts` hold the address
  rule, the name of each page and the page with no name.
- This refines record 0064.
