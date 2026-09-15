# 009: Backlinks on standard links

Status: active

This design states how a person sees the notes that link to the note they read.
It answers
[GitHub issue 73](https://github.com/bkhanale/notesapp/issues/73) on the
[GitHub project board](https://github.com/users/bkhanale/projects/2).

## The problem

[Decision 0004](../decisions/0004-standard-links-between-notes.md) removed the
backlinks screen from 0.1 and promised backlinks in 0.2 on standard links.
Issue 73 repeats that promise and asks for a note that shows its inbound links.

The first fact of this design is that most of the promise is already kept. The
work landed with item 3 of
[plan 009](../plans/009-portable-markdown-at-rest.md), which carries the status
`complete`, and the code sits in the tree. The honest question is therefore not
"how do we build backlinks". It is "what part of backlinks is still wrong, and
is that part worth the cost of a fix".

## What the code holds today

The chain is whole, from the stored text to the screen.

`extractLinks` in `packages/markdown/src/links.ts` walks the syntax tree of one
note and reports every link node and every link reference definition whose
destination resolves to a note. It resolves the destination against the path of
the note that holds it, through `classifyUrl` in
`packages/markdown/src/policy.ts`. A relative path that ends in `.md` gives a
`targetPath`. A legacy `/notes/<id>` destination gives a `targetId` and no
target path. An external address, a bare fragment, a query, and an attachment
reference are all refused, so none of them reaches the index. Every report
carries the source offsets of the node.

`updateAcceptedIndexes` in
`packages/storage-server/src/workspace-store/portable-links.ts` runs inside the
commit of a changeset. For each accepted head it deletes the old rows and
inserts one row per distinct target path. The table is `note_links`, created by
`packages/storage-server/migrations/0003_fat_ezekiel.sql`. A row names the
workspace, the source file, the source revision, the source path, and the
target path. The table carries row level security by workspace membership, and
a secondary index on the workspace and the target path.

`listBacklinks` in `packages/core/src/files/backlinks.ts` is the use case. It
checks the role and the read action, refuses a deleted or headless target, and
reads at most 100 rows through the `backlinks` port method of
`packages/core/src/files/ports.ts`. The server side of that port is in
`packages/storage-server/src/workspace-store/search-repository.ts`.

The operation `listBacklinks` sits in `packages/api-contract/openapi.yaml`, the
handler in `apps/server/src/routes/backlinks.ts`, and the panel in
`apps/web/src/features/editor/backlinks.tsx`. The note surface mounts it as a
collapsible section named "Links to this note" in the right aside of
`apps/web/src/features/editor/note-editor.tsx`. A browser journey in
`tests/e2e/portable-markdown.spec.ts` proves that an imported note appears as a
backlink, and `tests/integration/portable-markdown.test.ts` proves the same
through the store.

So the acceptance of issue 73 is met. A note shows its inbound links.

## What is still wrong

Four faults remain. They differ a lot in cost and in value.

**The panel lies when it cannot read.** The panel calls the generated operation
once and catches every failure into an empty list, which renders the sentence
"No notes link here." With no connection, a note with ten inbound links states
that it has none. This is the only read surface of the product that gives a
confident wrong answer instead of no answer. The note tree in
`apps/web/src/shell/files.tsx` keeps its local rows when the server read fails.
The Trash in `apps/web/src/features/trash/trash.tsx` reads the local store
beside the server. The command palette in
`apps/web/src/shell/command-palette.tsx` answers from the device and marks the
answer as offline. Backlinks does none of this.

**The panel never reads again.** Its effect depends on the workspace and the
file only. A note that gains an inbound link while it sits open keeps its old
list until the person leaves and returns.

**The panel does not exist on a small screen.** The aside that holds the
outline and the backlinks is hidden below the large breakpoint, and the browser
journey skips the phone and the tablet projects for that reason. Two of the
five projects of the browser matrix can never prove this surface.

**The list truncates in silence.** The use case asks for 100 rows and the
contract caps the array at 100 items. A note with more inbound links shows 100
of them and says nothing.

The first fault is a defect against the offline-first promise of
`docs/development/local-storage.md`. The other three are smaller.

Two documents are also out of date, because they still describe the state
before plan 009. `docs/development/files-and-revisions.md` states that no index
of links is kept. `docs/guide/notes-and-folders.md` states that there is no
backlinks panel in this release. Both sentences are now false.

## Where the index lives

This is the one architectural question. The server already holds an index. The
question is what the browser holds.

**Option A. The server index alone, as today.** A read is one equality seek on
`note_links_target_idx` and at most 100 rows. The cost does not grow with the
workspace, so 10,000 notes read as fast as 10. The write cost is bounded by the
changeset, because only the accepted heads are reindexed. The cost of this
option is the fault above: the panel has no answer with no connection, and the
best it can honestly do is say so.

**Option B. A browser index in place of the server index.** Drop `note_links`
and derive everything on the device. This option fails on three counts. The
rename rewrite of `expandMovedReferences` needs the index inside the server
transaction, and it cannot ask a browser. A second device that never opened the
workspace holds nothing. A published page under
[decision 0031](../decisions/0031-the-reader-path-is-a-closed-read-only-boundary.md)
has no browser store at all. So the server index stays whatever else happens.

**Option C. A stored mirror of the index in IndexedDB.** Add a `noteLinks`
object store beside the thirteen stores of
`packages/storage-browser/src/database.ts`, and maintain it wherever
`acceptedFiles` and `contents` change: the local save, the snapshot activation,
and each ordered change. The read is then as cheap as the server read. The cost
is a second index with its own consistency problem. It has three write paths,
each of which can drift, and a wrong backlink is worse than a missing one. It
also needs a schema version, a rebuild path for every existing profile, and a
rule for a profile whose snapshot is still staging. This is the expensive
option, and its only gain over option D is read latency on a surface that is
already collapsible chrome.

**Option D. Derive the answer on the device, with no stored index.** The
browser already holds every accepted note body. `stageSnapshot` in
`packages/sync/src/snapshot.ts` pages every file of the workspace and stores
each revision body, and `listSearchFiles` in
`packages/storage-browser/src/local-store/files.ts` already walks every
accepted row, loads its body, and overlays the current draft. The command
palette calls exactly that read and then `searchLocal` in
`packages/sync/src/local-search.ts`, a pure function with no stored index. A
backlink read can take the same read and a sister pure function. It adds no
object store, no schema version, and no migration. It uses the one extractor,
so the device and the server agree on what a link is by construction.

Option D also answers two of the smaller faults for free. The derivation walks
the whole workspace, so it knows the true count and the panel can state it. The
overlay includes the current draft, so a link the person typed and has not
saved yet appears, which the server index cannot show.

The cost of option D is the cost of one derivation, and the next section prices
it.

The recommendation is option A plus option D. The server index stays the
authority and the only index at rest. The device derives its own answer, and
the panel merges the two the way the palette merges search results.

## The cost of the derivation, and its soundness

A full parse of the workspace is not affordable. `extractLinks` runs a complete
remark parse. Over 10,000 notes of a few kilobytes each, that is tens of
megabytes of parsing, which is seconds of work, and the note surface would
stall. So the derivation needs a filter that is cheap and that loses nothing.

A sound filter exists. A link that resolves to a target path must hold the last
segment of that path in its destination, because `relativeTarget` in
`packages/markdown/src/policy.ts` builds the resolved path by appending the
segments of the destination. So a body that does not hold the name of the
target in any spelling cannot hold a link to it. The filter is therefore a
substring scan for the name of the target, and only a body that matches goes to
the parse. A scan of that size is the same class of work the palette already
does on each query, so the read cost is already proven affordable.

Three spellings break a naive scan, and each has an answer.

The resolver decodes the destination, so a destination can hold a percent
escape that the raw name does not show. `portableRelativePath` in
`packages/markdown/src/rewrite.ts` writes the escape for a percent sign, a
space, and a round bracket, so the scan looks for the canonical encoded name
too. A hand written or imported file can escape any character, so any body that
holds a percent sign at all goes to the parse without a scan. A body with no
percent sign cannot hide a name behind an escape, so nothing is lost.

The resolver normalizes each segment to the composed Unicode form, and
`packages/core/src/files/path.ts` stores every path in that form. A body can
hold the decomposed spelling, which resolves to the same path. The scan
therefore looks for both forms of the name.

A common name such as `index.md` matches many bodies, so the parse cost
returns in the worst case. The derivation runs after the first paint of the
note, it is cancelled when the person leaves the note, and it states a partial
answer rather than blocking. If a browser journey shows a stall, the work moves
into a worker, in the shape of `apps/web/src/features/history/diff-worker.ts`.
The worker is not built first, because a filter that already removes almost
every body makes it unnecessary in the normal case.

A unit test in `packages/sync` must hold all four spellings: the plain name,
the encoded name, the decomposed name, and a body that hides a name behind an
escape. Without those four cases the filter is a guess.

## What a rename does

This is the question that decides whether backlinks survive real use, and most
of it is already settled.

A note link is a relative path, so a move of either end changes the correct
text of the link.
[Decision 0021](../decisions/0021-portable-markdown-at-rest.md) answered this
by rewriting the text. When the target moves, `expandMovedReferences` in
`packages/storage-server/src/workspace-store/portable-links.ts` reads the
inbound rows of the old path, loads the head text of every source, rewrites
each destination with `rewriteRelativeReferences`, and appends a new revision
of every source to the same changeset. When the source moves, the same rewrite
adjusts its own destinations so they still resolve from the new folder. Then
`updateAcceptedIndexes` rebuilds the rows. One changeset carries the move and
every repair, so no reader ever sees a half moved workspace.

That answer is right and this design keeps it. The alternative was priced and
refused when 0021 was written, and it is worth restating, because it is the
option a reader will ask about.

**The refused option: leave the text alone and let the index carry the move.**
Keep the old destination in the note and record the history of each path, so a
lookup can follow a moved target. The read stays correct and a rename costs one
row. The cost is fatal to the product goal: the exported file then holds a dead
link, and
[decision 0021](../decisions/0021-portable-markdown-at-rest.md) exists to make
an exported note open correctly in any other Markdown application. A note that
only this application can resolve is the state that 0004 and 0021 both left
behind. So the rewrite stays.

Three consequences of the rewrite are open, and this design answers them.

**A rename writes history into notes the person did not touch.** Every inbound
source gains a revision with the message "Keep links after move." Record 0021
accepted this cost in one line. It is the right cost, because the alternative
above is worse, but the person should not meet it as a surprise in the History
of an unrelated note. The message is already distinct, so History can group or
mark an automatic repair. That is a separate surface question and it is named
as an open question below.

**A rename of a hub is refused with the wrong words.** The rewrite refuses when
the changeset would carry more than 1,000 files, and it refuses with the
failure `invalid_graph`. The web text for that failure, in
`apps/web/src/lib/parked-saves.ts`, is "This save does not fit the saved
history of the note." The person renamed a folder. The sentence names a cause
that is not theirs, and it offers nothing to do next, which breaks the rule of
one message for one cause. This failure needs its own reason in
`packages/core`, its own row in the problem table of
`apps/server/src/plugins/problem.ts`, and its own sentence.

**A rename made offline is repaired late.** The rewrite runs on the server when
the changeset is accepted, so between a local rename and the acceptance the
local bodies still hold the old destination. A derived local answer therefore
misses an inbound link across a local rename until the queue drains. The
rewrite cannot move to the device: only the server sees every source of every
device inside one transaction. So this is a real limit of option D and not a
defect of it. The panel states the answer it has, and the answer becomes right
when the queue drains. This is the same contract the palette already gives for
a local search result.

## Where the surface goes

[Decision 0004](../decisions/0004-standard-links-between-notes.md) removed a
backlinks screen. That is not an argument for a screen in 0.2. A screen takes
the person away from the note they read, and inbound links are a reason to stay
and look sideways.

The panel that exists fits the two records that govern the note surface.
[Decision 0025](../decisions/0025-the-live-preview-is-the-one-note-surface.md)
makes the live preview the one surface that a person reads and writes on. A
backlinks panel renders a list of note names and no Markdown, so it is not a
second reader of a note and it does not reopen the question that 0025 closed.
[Decision 0015](../decisions/0015-the-note-surface-is-the-design.md) says the
chrome recedes and the note is the design. A quiet collapsible aside beside the
outline is receded chrome, and the person can close it.

So the panel stays. The open part is the small screen, and it has four options.

**Leave it to the large breakpoint.** No work. The cost is that a person on a
phone or a tablet has no inbound links at all, and that the browser matrix can
never prove the surface on two of its five projects.

**Put the aside into the shell drawer below the breakpoint.** The drawer
exists. The cost is a scope mismatch: the drawer holds the workspace file tree,
and the outline and the backlinks belong to one open note. It also makes a
feature reach into the shell, which the structure of
[decision 0018](../decisions/0018-directory-structure-by-layer.md) allows only
through the shared providers.

**Open the aside as a sheet from the note header below the breakpoint.** The
editor feature keeps both the panel and the control, so the scope stays right
and no boundary moves. The cost is one more control on a small header and a
second place that has to trap focus and answer Escape.

**Add a command palette action that lists the inbound links.** The palette is
workspace scoped and query driven under
[decision 0010](../decisions/0010-one-command-palette.md) and
[decision 0028](../decisions/0028-command-palette-uses-p.md). A note scoped
list is a different shape, and the count then never reaches the reading
surface.

The third option is the one that fits. It is a product call and not an
architectural one, so it is named as an open question rather than fixed by a
record.

## Should this be built

Issue 73 as written should close. Its acceptance is met, its code is in the
tree, and a browser journey proves it.

The offline fault should be built, and it is small. It is one pure module in
`packages/sync` beside `local-search.ts`, one merge in the panel, four unit
tests for the filter, and one browser journey with the network down. It adds no
table, no migration, no contract change, and no package. The value is that the
one surface of this product that states a confident falsehood stops doing so.

The cheap answer, which is to catch the failure and say "Backlinks need a
connection", is honest but it gives the person nothing. It costs about ten
lines. The derivation costs perhaps five times that and gives a real answer
from a store the device already holds. The product calls itself offline-first
and already answers search from that store. So the derivation is the right
answer and not only the affordable one.

## Open questions

1. **Does the backlinks panel reach a phone and a tablet in 0.2?** The design
   recommends a sheet that the note header opens, owned by the editor feature.
   The owner decides whether that ships in 0.2 or waits. Until it ships, the
   browser journey keeps skipping two projects, and that skip is a known gap
   rather than an oversight.
2. **Does the panel state the true count?** The derivation knows the real
   number and the server answer stops at 100. The panel can state the count
   from the device without any contract change. Whether the server answer also
   carries a total is a contract question for a later row.
3. **Does History mark an automatic link repair?** The revision message is
   already distinct. Whether History groups it, marks it, or leaves it as a
   normal version is a surface question for the History area.
4. **Does a legacy identifier link ever appear as a backlink?** The index
   stores a target path only, so a note that still holds `/notes/<id>` after
   the data migration of plan 009 has no inbound row. The migration reports
   each reference that resolves to nothing, in
   `portable_markdown_migration_report`. Whether a person ever sees that report
   is an open product question that belongs with the migration row.

## Decisions

- [0037. Backlinks are derived on the device and merged with the server index](../decisions/0037-backlinks-are-derived-on-the-device.md)
- [0038. An empty state names what is missing, and a failed read names the failure](../decisions/0038-an-empty-state-is-not-a-failed-read.md)
- Kept: [0004. Standard links between notes](../decisions/0004-standard-links-between-notes.md)
- Kept: [0021. Portable Markdown at rest](../decisions/0021-portable-markdown-at-rest.md)
- Kept: [0025. The live preview is the one note surface](../decisions/0025-the-live-preview-is-the-one-note-surface.md)
- Kept: [0018. The directory structure follows ports and adapters](../decisions/0018-directory-structure-by-layer.md)
