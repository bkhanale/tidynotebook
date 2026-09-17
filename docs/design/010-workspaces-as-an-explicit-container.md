# 010: Workspaces as an explicit container

Status: complete

This design states how a person keeps separate areas of notes in one account,
and how they move between those areas. It reopens the choice that
[record 0005](../decisions/0005-workspace-is-an-implicit-container.md) closed.

## The problem

A person keeps personal notes and work notes in one account. Today the two sets
sit in one tree. A folder separates them by name only. Every surface of the
product reads the whole tree: the note list, the command palette, the search
answer, the backlink panel, the Trash, and the published link list. A work note
therefore appears while the person reads personal notes, and a personal note
appears while they work.

A folder cannot fix this. A folder is a path prefix. Nothing in the product
scopes a read to a prefix, and adding a prefix filter to every read surface
would put the same rule in eight places.

The product already has a container that every read is scoped to. It is the
workspace. The storage schema, the row access policies, the sync cursor, the
quota record and the API path all name it. Record 0005 took that container off
the screen, because the product served one person and had no second actor. The
reason is sound and the conclusion no longer follows. Isolation is not sharing.
One person wants two containers for their own notes.

## What the code already does

Six facts decide most of this design. Each one was read in the source.

**Many workspaces per account is the shipped model.** The contract declares
`listWorkspaces`, `createWorkspace`, `updateWorkspace` and `deleteWorkspace` in
`packages/api-contract/paths/api_workspaces.yaml` and
`packages/api-contract/paths/api_workspaces_workspaceId.yaml`. The use cases
live in `packages/core/src/workspaces/service.ts` with their unit tests. The
handlers live in `apps/server/src/routes/workspaces.ts`. No operation and no
rule has to be added for a second workspace to exist.

**Creation cannot leak a workspace to a stranger.** The runtime role holds no
insert right on the workspace table. The one way to create a workspace is
`notesapp_create_workspace` in
`packages/storage-server/migrations/0000_initial.sql`, which reads the account
of the transaction and makes that account the owner. A handler cannot forget
the check, because the handler cannot perform the insert.

**A session learns a new workspace at once.** `createIdentityAdapter` in
`apps/server/src/auth/actor.ts` reads the memberships of the account on every
request and builds the grants from them. A workspace created in one request is
usable in the next one. No session has to be renewed.

**The browser store is already scoped.** Every table of
`packages/storage-browser/src/database.ts` uses a compound key that starts with
the server origin, the account and the workspace. Two workspaces on one device
cannot mix, and no migration is needed to hold a second one.

**The personal workspace already exists and is already named.**
`apps/server/src/auth/setup.ts` links the first account with the workspace name
`Personal`, and `notesapp_link_account` marks that row personal.

**One engine serves one workspace.** `useWorkspaceSync` in
`apps/web/src/app.tsx` builds a sync engine from the account and the workspace
in the address. The engine holds the single worker lease of
`packages/storage-browser/src/local-store/preferences.ts`, which is one row for
the whole browser profile.

So the work is the web client, one control in `packages/ui`, and the two
invariants that a second workspace makes reachable.

## The first question: what the switcher is

**Option A. A dropdown at the top of the sidebar.** The trigger names the open
workspace. The list names every workspace of the account. A pinned row at the
end creates one. The dropdown sits above the New note action, so it reads as
the container of everything below it. The cost is one more control in the
narrow drawer, where vertical space is already short.

**Option B. A control in the header.** The header is one row of 48 px with
three fixed zones: the toggles and the product mark on the left, the search
affordance in the centre, the overflow menu on the right. A fourth element
competes with the search affordance for width, and below the small breakpoint
the product name already hides. The cost is a header that breaks at the
narrowest width the product supports.

**Option C. A screen of its own.** A person leaves their notes, picks a
workspace, and comes back. This is what the product had before record 0005
removed it. The cost is two navigations for one switch, every time.

Option A wins. It costs the least space where space is short, and it puts the
container above the things it contains.

## The second question: what happens to a workspace you leave

This is the question that a second workspace makes real, and it is the one that
can lose work.

A save is durable the moment it reaches IndexedDB. It reaches the server when
the sync engine sends its queue. Today one engine runs, for the workspace in
the address, because there is only one workspace. With a switcher, a person can
write in one workspace, switch to another, and close the tab. The queue of the
first workspace then waits on the device until the person opens that workspace
again. Nothing is lost, and nothing is safe either: a device that is wiped, or
a person who never returns to that workspace, never sends those saves.

**Option A. Only the open workspace syncs.** No new code. The limit is real and
it is silent. A person who switches away has no way to learn that their last
paragraph is still on the device.

**Option B. Every workspace of the account syncs, always.** The rule is simple
to say. The cost grows with the number of workspaces: each one polls the change
feed on its own interval, so ten workspaces make ten requests where one is
needed, forever, including the nine that hold nothing to send.

**Option C. The open workspace syncs, and so does any workspace that holds
queued work.** The set of running engines is the open workspace together with
every workspace whose local queue is not empty. A workspace with nothing to
send runs nothing. A workspace with something to send keeps running until the
queue drains, then stops. The invariant is that no local write waits for a
person to navigate.

Option C costs one new read of the local store: which workspaces of this
account hold a queue entry. The queue table already carries an account wide
index, so the read needs no schema change.

Option C also needs one rule written down that today is an accident. The worker
lease is one row for the browser profile, not one row per workspace. Several
engines in one tab share that row safely, because they share one owner
identifier and the compare and set only refuses a different owner. That is
true today by luck. Under option C it becomes load bearing, so it becomes a
stated rule with a test.

Option C wins. It holds the invariant and it pays only for the workspaces that
have something to pay for.

## The third question: the last workspace

`deleteWorkspace` in `packages/core/src/workspaces/service.ts` refuses a caller
who is not the owner. `notesapp_delete_workspace` refuses the same caller
again. Neither refuses the owner who deletes their only workspace.

Today no screen can reach that call, so the gap is unreachable. A delete action
in the switcher makes it reachable. An account with no workspace then reaches
the branch in `apps/web/src/app.tsx` that reports that the account has no notes
area, and no action on that screen creates one.

**Option A. The client hides the delete action for the last workspace.** The
rule then lives in a screen. A second caller of the operation, now or later,
does not have it.

**Option B. The domain rule refuses it.** `deleteWorkspace` counts the
workspaces of the account inside the same transaction and refuses when the
count is one. The client also hides the action, because a control that always
fails is a bad control, but the guarantee does not depend on the client.

**Option C. The database refuses it.** `notesapp_delete_workspace` counts the
memberships of the calling account and raises. The guarantee is the strongest,
and the refusal arrives as an exception rather than as a typed result, so the
server would have to map a database error back to a domain refusal.

Option B is the rule, with option C as the second lock. The domain rule answers
the person with a typed refusal, and the database function refuses the same
call, so no future caller of the store can get past it. This matches how the
product already treats a workspace deletion: the owner check is written twice,
once in the use case and once in the function.

## The fourth question: the personal workspace

The workspace that is created with the account carries a personal flag. Two
readings are possible.

**The flag means default.** It names the workspace that a new device opens
first. It says nothing about what a person may do.

**The flag means protected.** The personal workspace cannot be renamed and
cannot be deleted.

The second reading has no reason behind it. A person who renames Personal to
Life has done nothing wrong. The flag stays what it is: the workspace the
account started with, and the fallback when no other choice is known. The last
workspace rule already stops the harmful case, and it does not care which
workspace is the last one.

## What stays out

**Search across workspaces.** Search is a per workspace operation and its SQL
function takes one workspace. Isolation is the point of the feature, so an
answer that reaches across it would undo the feature. A person who wants a note
from the other workspace switches to it.

**The command palette across workspaces.** The same reason. The palette gains
one action that switches workspace, and its note search stays inside the open
one.

**Sharing a workspace with a second account.** The role matrix holds one role
and the product has one account. Nothing here adds a second actor.

**Moving a note between workspaces.** A note carries a revision graph, a
history, published links and attachments, all keyed by the workspace. Moving
one is a separate design.

## Decisions

- [0049. A workspace is an explicit container that a person chooses](../decisions/0049-a-workspace-is-an-explicit-container.md)
- [0050. Every workspace with queued work keeps syncing](../decisions/0050-every-workspace-with-queued-work-keeps-syncing.md)
- [0051. An account always keeps one workspace](../decisions/0051-an-account-always-keeps-one-workspace.md)
