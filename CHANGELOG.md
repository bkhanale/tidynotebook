# Changelog

All notable changes to this project are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.3.2 - 2026-09-19

This patch release makes the live preview and the published page render the
same Markdown.

### Added

- Alert block quotes show their tone and title in the live preview and on a
  published page.

### Fixed

- An external picture over HTTPS loads when it reaches the screen. The request
  sends no referrer.
- A soft line break joins one paragraph. A hard line break stays on a new line.
- A table inside a list or a quote keeps its columns and indentation.
- A reference image resolves through its definition in the live preview.
- A Mermaid diagram can recover from a slow load or a render failure.
- Strikethrough needs two tildes. One tilde stays as text in every Markdown
  surface.

## 0.3.1 - 2026-09-18

This patch release corrects the note loader, the folder tree marks, and the
note name field. It also gives the product one neutral mark.

### Changed

- The install icon and the application mark use one neutral N with an
  underline. The application renders all installed icons from the one vector
  source.

### Fixed

- The note screen shows no text from another note. A loader result reaches the
  editor only when it names the open account, the open workspace, and the open
  note.
- The note name field no longer requests stored personal data. It tells the
  browser that the name is application content.
- The All notes row, a selected folder, and the open note no longer touch the
  marked row below them as one band. One spacing step now separates each pair.

## 0.3.0 - 2026-09-18

This release gives the interface one face, one accent, one edge and one recipe
for every control, so it reads as a finished product on every device. It
closes the seven interface rows of the 0.3.0 milestone. The fixed rows that
this milestone also lists shipped in 0.2.1 and 0.2.2 and are recorded there.

### Added

- **One typeface.** The application is set in Geist, with Geist Mono for code
  and keyboard hints. Both are served by the application itself, so the
  product looks the same on every device and makes no request to a third
  party.
- **A header that knows where you are.** The frame header shows the workspace,
  the folder and the open note as a breadcrumb, the actions of the open screen
  (History, Publish and a menu of the rest for a note), Search with its key
  hint, and your account. The wordmark now appears on the sign in screen only.
- **Key caps.** Every keyboard hint draws one cap for each key, with the
  Command, Shift and Option signs on an Apple device and Ctrl, Shift and Alt
  elsewhere.
- **A design guide and a design gate.** `docs/development/design.md` states the
  system every screen follows, and `pnpm lint` refuses a control that leaves
  it: an icon off the grid, a label in capitals, a dashed edge, an off scale
  size or radius, a colour class that names no token, a hand written control.

### Changed

- The default theme paints the one action of a screen in ink and keeps its
  blue for a link, the focus ring, the caret and the selection. The app mark
  and the avatars are monochrome. A screen has one primary button.
- The sidebar is a column of rows: the workspace switcher, Search, New note,
  the Folders label with its New folder action, the tree without guide lines
  or rings, and the footer rows with the sync state as a dot.
- Every button, row, field and keyboard hint reads one recipe, with one focus
  treatment. A field and a secondary button wear the soft divider as their
  edge. The dark component edge marks a checkbox, a task box and a drop
  target only.
- The note surface: muted list markers, a drawn task box, a quiet quote bar,
  a code block as one card, a link with a soft underline, a table with one
  rule, no active line fill, and no rules around the name or the word count.
  The heading ramp stops under the note name.
- The command palette gives every action the same icon as the sidebar and the
  menus. The account menu gives every row an icon.
- Empty states have no box. A notice takes a tone surface and a mark. Settings
  is a page of sections with a segmented appearance control. The undo bar of
  the trash is one toast primitive. The published page reads the same classes
  as the application.
- Icons are drawn at a stroke of 1.5 and render at 16 px in a control and
  20 px in an empty state. Six unused icons are gone.

### Removed

- **The browser test suite.** The Playwright journeys, their configuration and
  their CI job are retired. The gate is `pnpm verify`: the unit tests beside
  each module, the integration tests against a real database and server, the
  design gate, typecheck, lint, format and the build. See decision record 0066.

## 0.2.2 - 2026-09-18

This hotfix repairs the installed application update flow.

### Fixed

- Update now recognizes the sync lease of the current tab. It no longer says
  that another tab blocks the update when the current tab holds the lease.
- Update now stores the open draft and stops all sync work before it closes
  local storage.
- The page now waits for the new service worker to become active before it
  reloads. The update notice also follows a worker while it installs.

## 0.2.1 - 2026-09-18

This intermediate release separates notes into workspaces, gives the interface
clear depth, and fixes the main faults found after 0.2.0. It closes 10 rows of
the 0.2.1 milestone.

Before an existing installation starts this release, set
`NOTESAPP_DATABASE_DIR`, `NOTESAPP_STORAGE_DIR` and `NOTESAPP_SECRETS_DIR`.
These values no longer have defaults. Each value must point at the directory
that holds the installation data now. Do not point an upgrade at new empty
directories. The database migrations run in the application container, as
before.

### Added

- **Workspaces.** Keep personal notes and work notes in separate workspaces.
  The workspace control in the sidebar lets you switch, make, rename and
  delete a workspace. Search, Trash, History and published links each show the
  workspace that is open. An account always keeps one workspace, and a save
  continues to sync when you switch to another workspace.
- **A clear interface depth.** The application uses three surface planes,
  named elevation and motion, stronger dividers and one centred note column.
  The note name is the main heading of the note screen again.
- **A neutral default theme.** A new preference starts with the neutral
  Default family. A stored theme choice does not change.

### Changed

- The database, stored files and secrets must use host directories that the
  operator names. Compose stops with a clear message when one of the three
  directory values is missing. This keeps service-owned data outside the
  checkout and keeps repository commands able to read the checkout.
- A menu opens on the screen instead of inside the box that holds its trigger.
  A row menu can stay visible at the edge of a long folder tree.

### Fixed

- Renaming a saved note now creates a version, so the new name reaches the
  server and the other devices.
- A deep folder name keeps usable space, and a menu near the edge of the
  screen is no longer cut off.
- A table now follows the same centred measure as the other note content.
- A published page loads the style for mathematics and serves its font files
  with the correct type.
- An offline application no longer answers a published link with the private
  application screen.
- History tells a failed picture read apart from a version that has no
  picture.
- A failed server start closes the resources that it opened and gives the
  operator one message that names the settings to check.
- Database connection waits and an idle import body now stop after their
  bounds, so they do not hold a request without limit.
- Rows, empty states and note side regions now have names that assistive
  technology can tell apart.

### Security

- The page form and the unlock operation of one published link now share one
  attempt bucket, so changing the operation does not give more password
  attempts.

## 0.2.0 - 2026-09-16

This release opens the first path that serves a reader with no account, brings
tables and backlinks to the note surface, and puts the deployment behind an
optional TLS front. It closes 56 rows of the 0.2.0 milestone.

An installation that runs 0.1.0 or 0.1.1 must set two values before it starts.
See Changed below for `NOTESAPP_PORT` and for the origin list that replaces
`NOTESAPP_ALLOWED_HOSTS`. The server stops at startup with a message that names
each value, so no installation starts with a stale setting. The migrations run
in the application container, as before.

### Added

- **Published read-only links.** Publish a note or a folder and share one
  address. A link takes an optional password and an optional expiry, and you
  revoke it at any moment. Publish sits in the command palette and in the menu
  of a folder row, and Published links lists what the workspace publishes,
  beside Trash.
  The reader gets a sanitized page with no account, no cookie and no write.
- **Tables.** A table renders in the note surface and in Read mode, and the
  editor keeps its source editable.
- **Backlinks.** A note lists the notes that link to it. The list is derived on
  the device from the note bodies it already holds, so the link syntax stays a
  standard Markdown link.
- **Front matter.** A note keeps a YAML front matter block through a save and a
  render, so the stored Markdown stays portable.
- **An optional TLS front.** `docker compose --profile tls up -d` starts Caddy
  in front of the application. It answers `NOTESAPP_DOMAIN`, gets the
  certificate on its own, passes the original `Host` header, and adds the
  forwarded headers. A default `docker compose up` starts the application
  alone, as before.
- **A folder inside a folder.** New folder takes the folder you selected, the
  folder row offers New folder in this folder, the dialog states the parent it
  takes, and Enter creates the folder.
- **The sidebar width belongs to you.** The sidebar has four named widths and a
  collapsed state. A drag on its edge, the arrow keys on that edge,
  `Cmd or Ctrl + \`, the header button and a palette action all reach it.
- **A loading state.** A screen that waits shows the shape of what arrives,
  instead of a sentence.
- **A key hint that matches the platform.** A shortcut shows the key icon of
  the machine you use.

### Changed

- The command palette opens with `Cmd or Ctrl + P`, so `Cmd or Ctrl + K`
  inserts a link.
- The port that the server listens on is `NOTESAPP_PORT`, and it no longer
  follows the port of `NOTESAPP_ORIGIN`. The public address and the listening
  socket are two different things behind a proxy. An installation that names a
  port in its origin and no `NOTESAPP_PORT` stops at startup with a message
  that names the value to set. The Compose file and the image set it already.
- An installation now names the addresses it serves as full origins. Set
  `NOTESAPP_ORIGIN` to the one public origin, and name a second address in
  `NOTESAPP_ADDITIONAL_ORIGINS`, with its scheme and its port. The host list
  `NOTESAPP_ALLOWED_HOSTS` is gone: an installation that still sets it stops at
  startup with a message that names the two values to set.
- The shutdown is a drain. The server stops taking new requests, finishes the
  requests it holds, and then closes.
- `/health` and `/ready` are operations of the API contract, so the response
  check covers every address that an operator configures. Readiness reads the
  pool that the deployment already serves from, so a repeated probe opens no
  connection of its own.
- A task box stays a control while you edit its line, so you tick an item on
  the line you are writing.
- The open note selects its folder, and a note list that still loads cannot
  reset that choice.
- The note list refreshes in the background. A window focus no longer empties
  the tree and no longer puts a placeholder over it.
- A read surface tells an empty answer apart from a failed read, so an empty
  state never stands for a server that did not answer.
- The service worker stays out of the first load, it claims no client, and the
  build names its precache and the cache that holds it. It stands aside for a
  request it holds no answer for.
- Every log record goes through one module.
- A move and a deletion are each one operation of the local store, so a save
  from another device no longer reverts them.
- The browser gate runs in parallel workers, and each worker owns its whole
  stack.
- A type assertion is refused across the source. A value of an unknown shape
  reaches its type through a guard or a parser that fails loudly.

### Fixed

- Deleting the only child folder no longer removes its parent folder.
- A table no longer reads as raw text in the note surface.
- A save that the server refuses is no longer reported as an empty save queue
  in Settings.
- The backlinks panel names a failed read instead of reporting no inbound link.
- A revoked link leaves the list of the owner.
- A dialog no longer moves focus back to its opener in the middle of a
  keystroke, so a typed folder name lands in the field.
- A folder made from the menu of a closed row is on the screen at once.
- The caret mark of a line stops at the content box, so a heading shows no
  tall empty band over its own text.
- The tree marks the open note and the selected folder with two different
  marks, so a note under its own folder no longer reads as one band of colour.
- The note name and the note text share one left edge, and the gap between
  them is the gap of the scale.
- A block quote renders with a left bar, in the GitHub style.
- The active line stays clear inside a code block.
- The New folder icon has the body and the size of its neighbours.
- A missing asset answers 404, not the application shell.
- Firefox opens a note address directly and still loads the first lazy chunk.
- The welcome note is seeded on both first-account paths.
- The editor keeps the work that scales with the document off the keystroke
  path, and the diff worker carries no editor engine.
- The local store revalidates in bounded chunks, and the file list load is
  bounded.
- The first run of `pnpm lint` passes in a fresh checkout with no prior build.

### Security

- The setup routes and the authentication routes carry an attempt limit.
- One list decides which origins the installation serves. The cookie write
  check and the identity routes read that one list, and no scheme and no port
  is added to it, so the shipped defaults no longer trust an address that
  nobody named.
- One value decides whose forwarded headers the installation believes.
  `NOTESAPP_TRUSTED_PROXIES` names the proxies in front, it is empty by
  default, and the identity routes read the address that the server resolved
  instead of a header of the caller. A caller can no longer state an address of
  its own choice and pass the attempt limit of the sign-in screen.
- The first-run setup write checks the origin of the request.
- An attachment download states its disposition and its name, so no stored file
  renders in the browser as a document of this origin.
- An attachment upload has a per route timeout and a bounded idle body.
- A published link holds a hashed token. Its password goes through the hasher
  of the account path, its attempts are bounded, and the reader path refuses
  every write.
- A problem document of the reader path carries no secret address.
- The setup compensation is safe: a failed first account leaves no partial row.
- A migration run takes an advisory lock, so two containers cannot migrate at
  the same moment.

## 0.1.1 - 2026-09-15

A rebuild of the image on a new Node base image. The tag also carried the work
that was in progress toward 0.2.0, which the entry above records.

## 0.1.0 - 2026-09-13

The first public release. NotesApp is a self-hosted Markdown notes
application for one person. A large part of the change is removal: the
multi-user and remote-integration surface that no screen and no route reached
is gone.

There is no earlier release, so an upgrade note is not needed. Every
installation starts from an empty database.

### Added

- **Trash.** Deleting a note moves it to Trash. Trash lists the deleted notes
  with Restore and Delete permanently, and shows an undo notice after a
  delete. Delete permanently releases the attachment bytes that no live
  revision references.
- **Needs attention.** A save that the server refuses for good is kept on the
  device and listed on its own screen, reachable from the save state. Each
  row offers Retry, Save as new note, Copy text and Discard, and states the
  cause in one sentence.
- **Stale draft handling.** When the device holds unsaved text written over an
  older version of a note, the note screen states that and lets the person
  choose. Taking the latest version keeps the older text under Needs
  attention.
- **Superseded save notice.** When a save became the latest version because
  the note also changed elsewhere, the application says so and points at
  History, where the other text is kept.
- **Note size messages.** A note that is too large or too deeply nested to
  render is refused with a sentence the author can act on, instead of a
  server error.

### Changed

- The first `docker compose up` is safe with no edit beyond the origin. The
  listener is published on `127.0.0.1`, the allowed-host list holds the host
  of the origin only, `NOTESAPP_ORIGIN` is required and has no default, and
  both services rotate their container logs.
- Database migrations run in the application container entry point, with the
  migration role, before the server starts with the restricted runtime role.
  The separate one-shot migration service is gone.
- The database and the attachment store are host bind mounts, so the host
  encryption check and the backup and restore scripts name the same paths.
- The container health check sends the host name that the deployment serves.
- The image name is a Compose variable, so a version tag can replace `latest`.
- The Markdown package keeps two limits, the document size and the nesting
  depth, instead of thirteen.
- The API contract shares its repeated schemas and caches its validators, so
  the server starts faster.

### Removed

- The remote integration surface: the remote MCP server, the OAuth
  authorization server, agent tokens and the `mcp-stdio` app. Only the session
  cookie authenticates a request now. An MCP adapter returns in a later
  release.
- Public share pages and the `/s/` URL prefix.
- Wiki links `[[...]]` and backlinks. Link to another note with a standard
  Markdown link.
- Named checkpoints. A save creates one version; History lists them.
- Invitations, members, workspace roles and ownership transfer. There is one
  user and one workspace, and the workspace has no screen.
- Conflict branches, on the server and in the browser store. History stays one
  line.
- The purge, recovery and offline status screens. Their useful parts moved
  into Trash, Needs attention and Settings.
- The `/metrics` route and the write pause.

### Fixed

- A save whose parent moved is placed after the current head and reports the
  head it passed, so no save silently removes text its author never saw.
- A rebase across a deletion or a rename boundary is refused with
  `stale_head`, so a stale save cannot resurrect a deleted note.
- A stale delete no longer removes newer text. The note stays and the
  application says so.
- A purged note leaves the local cache, and a restore returns it.
- A stale delete draft no longer describes a restored note.
- The editor keeps its base version after the draft row is removed.
- Purge no longer removes an upload that is still in flight, and it now
  deletes the attachment bytes it should.
- The phone header no longer scrolls sideways.

### Security

- The unauthenticated `/metrics` route is removed.
- The consent-free OAuth authorize route is removed with the OAuth server.
- The default deployment no longer carries a private network address as its
  origin, no longer binds every interface, and no longer accepts any host
  name.
- `.dockerignore` keeps the secret, storage, database, report and document
  trees out of the build context.
