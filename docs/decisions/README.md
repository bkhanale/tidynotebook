# Architecture decision records

Each record states one architectural choice, why it was made, and what it
costs. A record is short and it does not change after it is accepted. When a
later choice replaces an earlier one, add a new record and set the status of
the old one to `Superseded by NNNN`.

## The rule

**A new architectural choice gets a record before the code.** A change that
moves a boundary, adds or removes a package, changes the save model, adds a
second parser or renderer, changes the contract emit rules, changes the
database migration policy, or changes what the verification gate proves, is
architectural. Write the record, then write the code, and name the record in
the commit body.

A change inside one package that keeps every boundary is not architectural
and needs no record.

## How to add one

1. Copy [0000-template.md](0000-template.md) to `NNNN-short-title.md` with
   the next free number.
2. Fill in Context, Decision, and Consequences. Keep the file under 40 lines,
   or under 60 when the record states a structure that a reader has to follow.
3. Set `Status: Accepted` and the date.
4. Add the row to the index below.

## Index

| Record                                                            | Decision                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| [0001](0001-one-markdown-grammar.md)                              | One Markdown grammar                                       |
| [0002](0002-widgets-only-where-text-cannot-express.md)            | Widgets only where text cannot express the result          |
| [0003](0003-read-mode-uses-the-shared-renderer.md)                | Read mode is the second consumer of the renderer           |
| [0004](0004-standard-links-between-notes.md)                      | Standard links between notes, no wiki syntax in v0.1       |
| [0005](0005-workspace-is-an-implicit-container.md)                | Workspace becomes an implicit container (superseded)       |
| [0006](0006-trash-replaces-purge.md)                              | Trash replaces the purge screen                            |
| [0007](0007-keep-the-save-model.md)                               | Keep the save model and close its gaps                     |
| [0008](0008-remove-the-remote-integration-surface.md)             | Remove the remote integration surface for v0.1             |
| [0009](0009-export-first-import-later.md)                         | Export first, import later                                 |
| [0010](0010-one-command-palette.md)                               | One command palette                                        |
| [0011](0011-contract-emit-and-one-migration.md)                   | Shared contract definitions and one initial migration      |
| [0012](0012-package-layout-stays-for-v0-1.md)                     | The package layout stays for v0.1                          |
| [0013](0013-delivery-and-headers-belong-to-the-app.md)            | Delivery and headers belong to the application             |
| [0014](0014-browser-tests-are-the-interface-gate.md)              | Browser tests are the interface gate                       |
| [0015](0015-the-note-surface-is-the-design.md)                    | The note surface is the design                             |
| [0016](0016-themes-are-data-in-one-registry.md)                   | A theme is data in one registry                            |
| [0017](0017-save-feedback-on-the-save-button.md)                  | Save feedback lives on the Save button                     |
| [0018](0018-directory-structure-by-layer.md)                      | The directory structure follows ports and adapters         |
| [0019](0019-contract-validation-and-shared-types.md)              | One contract, generated types, and no type assertions      |
| [0020](0020-central-logging-through-one-module.md)                | Central logging through one module                         |
| [0021](0021-portable-markdown-at-rest.md)                         | Portable Markdown at rest                                  |
| [0022](0022-autosave-and-automatic-versions.md)                   | Autosave and automatic versions                            |
| [0023](0023-one-auto-expiring-trash.md)                           | One auto-expiring Trash                                    |
| [0024](0024-remove-conflict-and-recovery-surfaces.md)             | Remove the conflict and recovery surfaces                  |
| [0025](0025-the-live-preview-is-the-one-note-surface.md)          | The live preview is the one note surface                   |
| [0026](0026-slim-the-save-and-delete-surfaces.md)                 | Slim the save and delete surfaces, do not remove them      |
| [0027](0027-track-work-on-the-github-board.md)                    | Track work on the GitHub board                             |
| [0028](0028-command-palette-uses-p.md)                            | The command palette uses P                                 |
| [0029](0029-selected-folder-is-the-create-parent.md)              | The selected folder is the create parent                   |
| [0030](0030-published-links-are-hashed-tokens-over-a-scope.md)    | A published link is a hashed token over a read-only scope  |
| [0031](0031-the-reader-path-is-a-closed-read-only-boundary.md)    | The reader path is a closed read-only boundary             |
| [0032](0032-whole-file-actions-are-store-operations.md)           | A move and a deletion are each one store operation         |
| [0033](0033-a-task-box-is-a-control-not-a-marker.md)              | A task box is a control, not a marker                      |
| [0034](0034-the-open-note-selects-its-folder.md)                  | The open note selects its folder                           |
| [0035](0035-the-sidebar-width-belongs-to-the-person.md)           | The sidebar width belongs to the person                    |
| [0036](0036-the-browser-gate-runs-in-parallel-workers.md)         | The browser gate runs in parallel workers                  |
| [0037](0037-backlinks-are-derived-on-the-device.md)               | Backlinks are derived on the device and merged             |
| [0038](0038-an-empty-state-is-not-a-failed-read.md)               | An empty state is not a failed read                        |
| [0039](0039-one-list-of-served-origins.md)                        | One list of served origins                                 |
| [0040](0040-a-probe-address-is-a-contract-operation.md)           | A probe address is a contract operation                    |
| [0041](0041-readiness-reads-the-served-pool.md)                   | Readiness reads the pool that the deployment serves from   |
| [0042](0042-the-listening-socket-is-not-the-public-origin.md)     | The listening socket is not the public origin              |
| [0043](0043-one-decider-of-the-client-address.md)                 | One decider of the client address                          |
| [0044](0044-the-worker-stays-out-of-the-first-load.md)            | The worker stays out of the first load                     |
| [0045](0045-the-build-names-the-precache.md)                      | The build names the precache and its cache                 |
| [0046](0046-the-reader-carries-its-credentials-in-the-address.md) | The reader carries its credentials in the address          |
| [0047](0047-the-published-page-always-answers-a-page.md)          | The published page always answers a page                   |
| [0048](0048-publish-is-a-command-and-the-links-are-a-list.md)     | Publish is a command and the links are one workspace list  |
| [0049](0049-a-workspace-is-an-explicit-container.md)              | A workspace is an explicit container that a person chooses |
| [0050](0050-every-workspace-with-queued-work-keeps-syncing.md)    | Every workspace with queued work keeps syncing             |
| [0051](0051-an-account-always-keeps-one-workspace.md)             | An account always keeps one workspace                      |
| [0052](0052-three-planes-and-one-elevation-scale.md)              | Three planes and one elevation scale                       |
| [0053](0053-the-divider-is-derived-from-the-palette.md)           | The divider is derived from the palette                    |
| [0054](0054-motion-is-a-named-scale-in-one-module.md)             | Motion is a named scale in one module                      |
| [0055](0055-the-note-is-one-centred-column.md)                    | The note is one centred column                             |
| [0056](0056-the-default-theme-has-no-opinion.md)                  | The default theme has no opinion                           |
| [0057](0057-a-control-fill-states-its-hover-in-the-palette.md)    | A control fill states its hover in the palette             |

Records 0001 to 0015 record the decisions D1 to D15 of
[the v0.1 revamp plan](../plans/003-v0.1-revamp.md). Record 0016 records the
theme registry described in [Themes](../development/themes.md). Record 0017
records how the save state reaches the person. Records 0018 and 0019 record the
target structure and the type rules that the
[architecture review](../audits/2026-09-11/architecture-review.md) asked for.
Record 0020 records the one way to write a log record, and it follows
[design 003](../design/003-central-logging.md). Record 0021 records the
portable form of the stored note text, and it follows
[design 004](../design/004-portable-markdown-at-rest.md). Records 0022 to 0024
and 0026 record [design 005](../design/005-streamline-save-and-delete.md), the
streamlined save and delete workflow. Record 0022 supersedes 0007 and 0017, and
record 0023 supersedes 0006. Record 0026 keeps the safety net and slims the save
and delete surfaces instead of removing them, and it supersedes records 0023 and 0024. Record 0025 makes the live preview the one note surface and supersedes
record 0003, and it follows
[design 006](../design/006-the-one-markdown-surface.md). Record 0027 moves the
work list to the GitHub board and removes `docs/releases/`, and it is described
in [work tracking](../development/tracking.md). Record 0028 replaces the
shortcut choice of record 0010, so the link command and the command palette
have separate keys. Record 0029 makes the temporary selected folder the parent
for each create action, and it follows
[design 007](../design/007-nested-folder-creation.md). Records 0030 and 0031
open the first path that serves a person with no account, and they follow
[design 008](../design/008-published-read-only-links.md). Record 0030 states
what a published link is: an opaque token that is hashed at rest, a scope of one
note or one folder, an optional password through the hasher of the account path,
an optional expiry, and immediate revocation. Record 0031 states how the server
serves that link without an actor, and it gives the sanitized renderer that
record 0025 kept its first production reader. Record 0032 makes a move and a
deletion each one operation of the local store, because the path and the
deletion state of a note live on every working copy of that note and an action
that wrote only one of them was reverted by the next save of any other.
Records 0033 to 0035 answer the client report of 2026-09-15. Record 0033 makes
a task box the one construct that keeps its control under the caret, so a
person can tick an item on the line they are writing. Record 0034 makes the
open note select its folder and stops a background read of the note list from
moving that selection, so a create action lands where the person is reading,
and it refines record 0029. Record 0035 gives the sidebar four named widths and
a collapsed state that belong to the person. Record 0036 opens the browser
gate to parallel workers, because each worker already owns its whole stack,
and it refines record 0014. Records 0037 and 0038 follow
[design 009](../design/009-backlinks-on-standard-links.md), which reads the
backlink surface that item 3 of
[plan 009](../plans/009-portable-markdown-at-rest.md) already delivered. Record
0037 keeps the server table as the one link index at rest and derives the
answer of the device from the note bodies it already holds, so no second index
enters the browser. Record 0038 splits an empty answer from a failed read
across every read surface of the web application, because the backlink panel
reported no inbound link whenever it could not reach the server. Record 0039
gives the deployment one list of served origins, which the operator names as
full origins, because the cookie write check, the trusted list of the identity
routes, and the Host allowlist each answered the question from a different
value. Records 0040 and 0041 answer issue 24 and finding 11 of the
[architecture review of 2026-09-11](../audits/2026-09-11/architecture-review.md).
Record 0040 makes every address that the server answers an operation of the
contract, so the root probe addresses that an operator configures are covered
by the response check. Record 0041 makes readiness read the pool that the
deployment already serves from, so a probe that an orchestrator repeats forever
opens no connection of its own. Records 0042 and 0043 answer issue 25, the
optional TLS profile. Record 0042 gives the listening socket its own
configuration, because a proxy separates the public address from the address
that the process binds, and it refines the last bullet of record 0039. Record
0043 gives the client address one decider: one named list grants the trust, it
is empty by default, and Better Auth reads the answer of this server instead of
a header of the caller. Record 0044 answers issue 85. It keeps the installed
worker out of a load that started without it: registration waits for the `load`
event, the worker claims no client, and the precache takes at most half of the
connections of one host. It refines record 0013. Record 0045 answers issue 34 and
finding ENG-13 of the
[tooling audit of 2026-09-10](../audits/2026-09-10/tests-tooling-docs.md). It
gives the build step of this repository the precache of the worker and the name
of the cache that holds it, so no second bundler and no Workbox runtime enter
the tree, and a cache follows the bytes of its build. It refines record 0013.
Record 0046 answers issue 74. It settles where the token and the reading
ticket of a published link sit, because a picture inside a server built page
sets no header and the reader path sets no cookie. It refines record 0030.
Record 0047 answers issue 77. It gives the address that a person opens one
answer for every state of a link, because a problem document shows an error
code and one status cannot carry two media types.
Record 0048 answers issue 78. It puts the publish action in the command palette
and in the folder row menu, and it makes the links of a workspace one list
beside Trash, because the note surface of record 0015 takes no new control and
the list of record 0030 is scoped to a workspace. It refines record 0030.
Records 0049 to 0051 follow
[design 010](../design/010-workspaces-as-an-explicit-container.md), which
reopens the container question that record 0005 closed. Record 0049 supersedes
record 0005: a person keeps personal notes and work notes apart, so the
workspace becomes a control in the sidebar instead of a hidden path segment.
Records 0050 and 0051 close the two invariants that record 0005 had made
unreachable. Record 0050 keeps a sync engine running for every workspace that
still holds queued work, because a person who switches away must not leave a
save on the device. Record 0051 makes the domain rule and the database function
both refuse the delete of the last workspace of an account.

Records 0052 to 0055 follow
[design 011](../design/011-depth-and-hierarchy.md), which reads why the
interface is tidy and still flat. Record 0052 names the three planes of the
interface and makes elevation a named scale built from the scrim of the
palette, because the frame header had taken the highest plane of the screen.
Record 0053 derives the divider from the component edge and the page
background, because the decorative edge of a palette has no minimum and every
divider of the product used it. Record 0054 states the motion of the
application in one module, because Tailwind gives a duration no theme
namespace and a bare number in a class is a value that no rule can hold.
Record 0055 makes the note name, the note text and the note footer one centred
column and holds them to one measure, and it refines record 0015.

Records 0056 and 0057 answer the theme audit of 2026-09-17. Record 0056 makes
the default family a neutral one, because every family in the registry was a
taste and a person with no preference met a preference on the first screen. It
refines record 0016. Record 0057 makes a control fill state its hover in the
palette, because a hover made with a brightness filter moved every light
palette toward its page and cost nine variants the contrast minimum of the
button label. It follows the derived value of record 0053.
