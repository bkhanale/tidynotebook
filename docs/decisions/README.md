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

| Record                                                   | Decision                                              |
| -------------------------------------------------------- | ----------------------------------------------------- |
| [0001](0001-one-markdown-grammar.md)                     | One Markdown grammar                                  |
| [0002](0002-widgets-only-where-text-cannot-express.md)   | Widgets only where text cannot express the result     |
| [0003](0003-read-mode-uses-the-shared-renderer.md)       | Read mode is the second consumer of the renderer      |
| [0004](0004-standard-links-between-notes.md)             | Standard links between notes, no wiki syntax in v0.1  |
| [0005](0005-workspace-is-an-implicit-container.md)       | Workspace becomes an implicit container               |
| [0006](0006-trash-replaces-purge.md)                     | Trash replaces the purge screen                       |
| [0007](0007-keep-the-save-model.md)                      | Keep the save model and close its gaps                |
| [0008](0008-remove-the-remote-integration-surface.md)    | Remove the remote integration surface for v0.1        |
| [0009](0009-export-first-import-later.md)                | Export first, import later                            |
| [0010](0010-one-command-palette.md)                      | One command palette                                   |
| [0011](0011-contract-emit-and-one-migration.md)          | Shared contract definitions and one initial migration |
| [0012](0012-package-layout-stays-for-v0-1.md)            | The package layout stays for v0.1                     |
| [0013](0013-delivery-and-headers-belong-to-the-app.md)   | Delivery and headers belong to the application        |
| [0014](0014-browser-tests-are-the-interface-gate.md)     | Browser tests are the interface gate                  |
| [0015](0015-the-note-surface-is-the-design.md)           | The note surface is the design                        |
| [0016](0016-themes-are-data-in-one-registry.md)          | A theme is data in one registry                       |
| [0017](0017-save-feedback-on-the-save-button.md)         | Save feedback lives on the Save button                |
| [0018](0018-directory-structure-by-layer.md)             | The directory structure follows ports and adapters    |
| [0019](0019-contract-validation-and-shared-types.md)     | One contract, generated types, and no type assertions |
| [0020](0020-central-logging-through-one-module.md)       | Central logging through one module                    |
| [0021](0021-portable-markdown-at-rest.md)                | Portable Markdown at rest                             |
| [0022](0022-autosave-and-automatic-versions.md)          | Autosave and automatic versions                       |
| [0023](0023-one-auto-expiring-trash.md)                  | One auto-expiring Trash                               |
| [0024](0024-remove-conflict-and-recovery-surfaces.md)    | Remove the conflict and recovery surfaces             |
| [0025](0025-the-live-preview-is-the-one-note-surface.md) | The live preview is the one note surface              |
| [0026](0026-slim-the-save-and-delete-surfaces.md)        | Slim the save and delete surfaces, do not remove them |

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
[design 006](../design/006-the-one-markdown-surface.md).
