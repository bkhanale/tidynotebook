# NotesApp

NotesApp is a self-hosted, single-user Markdown notes application. It keeps
working drafts in the browser and sends immutable versions to PostgreSQL when
the user selects Save.

## Features

- First-run setup with one email address and password.
- Local browser drafts for offline safety.
- Explicit Save actions with complete version history and restore.
- CommonMark and GFM preview with tables, tasks, footnotes, math, and Mermaid.
- Search, outlines, backlinks, stable note links, and folder navigation.
- Image attachments with content validation and deduplicated storage.
- REST and MCP access from one operation contract.
- Responsive desktop, tablet, and phone layouts with light and dark themes.
- Docker Compose deployment, health checks, metrics, backups, and restore.

## Save model

```text
Typing
  -> IndexedDB draft
Save
  -> immutable local version and durable queue entry
  -> generated API client
  -> Fastify application
  -> PostgreSQL version history
```

Typing does not create server versions. Save creates a version immediately on
the device. The sync engine sends that version when a connection is available.
If another save reached the server first, the server places the later save
after the current head. The user sees one linear history and no conflict UI.

## Repository layout

| Path                       | Purpose                                     |
| -------------------------- | ------------------------------------------- |
| `apps/web`                 | React web application and PWA               |
| `apps/server`              | Fastify API, authentication, and MCP server |
| `apps/mcp-stdio`           | Local MCP bridge                            |
| `packages/api-contract`    | OpenAPI source contract                     |
| `packages/api-client`      | Generated typed client                      |
| `packages/core`            | Domain rules and version validation         |
| `packages/editor`          | CodeMirror source editor                    |
| `packages/markdown`        | Safe CommonMark and GFM rendering           |
| `packages/storage-browser` | IndexedDB persistence                       |
| `packages/storage-server`  | PostgreSQL stores, migrations, and files    |
| `packages/sync`            | Offline queue, lease, and synchronization   |
| `packages/ui`              | Shared interface components and icons       |
| `docs`                     | Development and operation guides            |

## Requirements

- Node.js 26.8.1
- pnpm 12.3.4
- Docker Engine and Docker Compose
- PostgreSQL 18 for a self-hosted installation

## Development

```bash
pnpm install --frozen-lockfile
tools/test-database/ensure-postgres.sh
pnpm verify
```

Run browser tests with:

```bash
pnpm test:e2e
```

Useful commands:

| Command                 | Result                                                |
| ----------------------- | ----------------------------------------------------- |
| `pnpm build`            | Builds all packages, the server, and the PWA          |
| `pnpm typecheck`        | Checks all TypeScript projects                        |
| `pnpm lint`             | Checks versions, source rules, and package boundaries |
| `pnpm format:check`     | Checks Prettier formatting                            |
| `pnpm test:unit`        | Runs unit tests                                       |
| `pnpm test:integration` | Runs PostgreSQL and IndexedDB integration tests       |
| `pnpm test:e2e`         | Runs the Playwright test matrix                       |

## Self-hosting

Copy `.env.example` to `.env`, create the protected secret files, and start the
Compose stack:

```bash
cp .env.example .env
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

Open the application after the first startup. The setup page asks for the
email address and password of the single user. Later visits show the normal
sign-in page.

The optional `pnpm owner:bootstrap` command can create the same first account
for an unattended installation. It refuses to run after an account exists.
The `pnpm account:recover` command resets the password and revokes old
sessions.

Read the [self-hosting guide](docs/operations/self-hosting.md) before you store
production data.

## API generation

The OpenAPI contract is in `packages/api-contract/openapi.yaml`.

```bash
pnpm contract:lint
pnpm generate
pnpm generated:check
```

## Documentation

- [Local storage](docs/development/local-storage.md)
- [Files and versions](docs/development/files-and-revisions.md)
- [Identity](docs/development/identity.md)
- [Verification](docs/development/verification.md)
- [Self-hosting](docs/operations/self-hosting.md)

## License

NotesApp is available under the [MIT License](LICENSE).
