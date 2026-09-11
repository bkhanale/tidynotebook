# NotesApp

NotesApp is a self-hosted Markdown notes application for one person. The file
is the document: a note is a Markdown file with one `.md` suffix, in a folder
you choose. Typing writes a draft on your device. Save creates one immutable
version on your server.

**Status:** working toward v0.1. There is no release tag yet. See
[CHANGELOG.md](CHANGELOG.md) for what changed and
[docs/plans/003-v0.1-revamp.md](docs/plans/003-v0.1-revamp.md) for what v0.1
is.

## Features

- **Plain Markdown files.** Notes are organised in folders. Nothing is stored
  that cannot be exported as plain Markdown files.
- **One editing surface.** A live-preview Markdown editor keeps the source
  editable at every position. A Read mode shows the same note through the
  reference renderer. CommonMark and GFM, with tables, tasks, footnotes, math
  and Mermaid.
- **Explicit save.** Typing writes a local draft. Save creates one immutable
  version on the server. History lists the versions and restores any of them.
- **Works offline.** A queued save is sent when the connection returns. You
  see one linear history, and the application tells you when a later save
  superseded an earlier one.
- **Trash.** Deleting moves a note to Trash. Trash restores it or deletes it
  permanently.
- **Search.** Finds notes by name and content, ranked, with a highlighted
  excerpt.
- **Attachments.** Images are validated, deduplicated by digest, and stored
  outside the database.
- **One user.** First-run setup takes one email address and one password.
  There is no sharing, no invitation, and no public page.
- **One Compose file.** Safe defaults, health checks, encrypted backups and a
  tested restore.

## Quick start

The shortest path from a clone to the setup screen is in
[docs/quickstart.md](docs/quickstart.md). Read
[docs/operations/self-hosting.md](docs/operations/self-hosting.md) before you
store data you care about.

## Requirements

- Node.js 26.8.1
- pnpm 12.3.4
- Docker Engine and Docker Compose v2
- PostgreSQL 18 for a self-hosted installation

## Development

```bash
pnpm install --frozen-lockfile
tools/test-database/ensure-postgres.sh
pnpm verify
```

Browser tests:

```bash
pnpm exec playwright install
pnpm test:e2e
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the complete setup path, the command
list, the branch workflow and the commit style.

## Repository layout

| Path                       | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `apps/web`                 | React web application and PWA                        |
| `apps/server`              | Fastify API, authentication, and static delivery     |
| `packages/api-contract`    | OpenAPI source contract and request validators       |
| `packages/api-client`      | Generated typed client                               |
| `packages/core`            | Domain rules, revision graph, and version validation |
| `packages/editor`          | CodeMirror editor and live preview                   |
| `packages/markdown`        | Safe CommonMark and GFM rendering                    |
| `packages/storage-browser` | IndexedDB persistence                                |
| `packages/storage-server`  | PostgreSQL stores, migrations, and files             |
| `packages/sync`            | Save queue, lease, and synchronization               |
| `packages/ui`              | Shared interface components, icons, and theme        |
| `docker`                   | Container entry point and health check               |
| `docs`                     | Development, operation, and planning documents       |
| `tests`                    | Integration and browser tests                        |
| `tools`                    | Checkers, code generation, and operator scripts      |

## API generation

The contract is `packages/api-contract/openapi.yaml`.

```bash
pnpm contract:lint
pnpm generate
pnpm generated:check
```

## Documentation

Start here:

- [Quick start](docs/quickstart.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

Development:

- [Architecture](docs/development/architecture.md)
- [Developing a feature](docs/development/feature-workflow.md)
- [HTTP API access](docs/development/api.md)
- [Adding an API operation](docs/development/api-contract.md)
- [Database](docs/development/database.md)
- [Files, revisions, and atomic changes](docs/development/files-and-revisions.md)
- [Single-user identity](docs/development/identity.md)
- [Local drafts and explicit saves](docs/development/local-storage.md)
- [Themes](docs/development/themes.md)
- [Toolchain](docs/development/toolchain.md)
- [Verification](docs/development/verification.md)
- [Architecture decision records](docs/decisions/README.md)

Operations:

- [Self-hosting and recovery](docs/operations/self-hosting.md)

Plans and audits:

- [v0.1 revamp plan](docs/plans/003-v0.1-revamp.md)
- [Audit: hands-on probe](docs/plans/003-audit/hands-on-probe.md)
- [Audit: Markdown and editor](docs/plans/003-audit/markdown-editor.md)
- [Audit: server, sync, and data](docs/plans/003-audit/server-sync-data.md)
- [Audit: tests, tooling, and docs](docs/plans/003-audit/tests-tooling-docs.md)
- [Audit: web interface](docs/plans/003-audit/web-ui-ux.md)

Superseded, kept for provenance only:

- [001: Initial design](docs/history/design-001-initial-design.md)
- [002: Holistic client repair design](docs/history/design-002-holistic-client-repair.md)
- [001: Initial implementation plan](docs/history/plan-001-initial-implementation.md)
- [002: Holistic client repair plan](docs/history/plan-002-holistic-client-repair.md)

## License

NotesApp is available under the [MIT License](LICENSE).
