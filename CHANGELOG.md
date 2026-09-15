# Changelog

All notable changes to this project are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

This entry covers the work toward the first public release. NotesApp becomes
a self-hosted Markdown notes application for one person. A large part of the
change is removal: the multi-user and remote-integration surface that no
screen and no route reached is gone.

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
  listener is published on `127.0.0.1`, the installation serves the configured
  origin and nothing else, `NOTESAPP_ORIGIN` is required and has no default,
  and both services rotate their container logs.
- An installation now names the addresses it serves as full origins. Set
  `NOTESAPP_ORIGIN` to the one public origin, and name a second address in
  `NOTESAPP_ADDITIONAL_ORIGINS`, with its scheme and its port. The host list
  `NOTESAPP_ALLOWED_HOSTS` is gone: an installation that still sets it stops at
  startup with a message that names the two values to set.
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
- One list decides which origins the installation serves. The cookie write
  check and the identity routes read that one list, and no scheme and no port
  is added to it, so the shipped defaults no longer trust an address that
  nobody named.
- `.dockerignore` keeps the secret, storage, database, report and document
  trees out of the build context.
