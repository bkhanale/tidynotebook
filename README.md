# NotesApp

NotesApp is a self-hosted, local-first Markdown workspace. It keeps drafts in
the browser, creates immutable checkpoints, synchronizes them with PostgreSQL,
and preserves divergent work for explicit conflict resolution.

The web app, REST API, authentication routes, public shares, and MCP routes use
one server and one origin.

## Features

- Local-first Markdown editing with durable browser drafts.
- Automatic and manual checkpoints with complete revision history.
- Offline editing, reconnect synchronization, and recovery copies.
- Explicit conflict review that keeps both versions.
- Workspaces with owner, administrator, editor, and viewer roles.
- Search, outlines, backlinks, stable note links, and folder navigation.
- Image attachments with content validation and deduplicated storage.
- Private notes and pinned public shares.
- Password authentication, invitations, account recovery, and optional OIDC.
- REST and MCP access from the same operation contract.
- Responsive desktop, tablet, and phone layouts with light and dark themes.
- Docker Compose deployment, health checks, metrics, encrypted backups, and
  verified restore procedures.

## How it works

```text
Browser editor
  -> IndexedDB drafts, checkpoints, and sync queue
  -> ordered synchronization over the generated API client
  -> Fastify application and authorization checks
  -> PostgreSQL revision graph and attachment storage
```

NotesApp does not replace a draft with a server response. A draft is first
stored in IndexedDB. A checkpoint then creates an immutable local revision and
one durable queue entry in the same transaction. The sync engine submits queue
entries in parent order. A stale sibling becomes a branch, while an ordered
child continues from its accepted parent.

For more detail, read the [local storage guide](docs/development/local-storage.md)
and the [file and revision guide](docs/development/files-and-revisions.md).

## Repository layout

| Path                       | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `apps/web`                 | React web app and PWA service worker                        |
| `apps/server`              | Fastify API, authentication, public shares, and MCP server  |
| `apps/mcp-stdio`           | Local MCP bridge for standard input and output              |
| `packages/api-contract`    | OpenAPI source contract                                     |
| `packages/api-client`      | Generated typed client                                      |
| `packages/core`            | Domain rules, identifiers, digests, and revision validation |
| `packages/editor`          | CodeMirror editor integration                               |
| `packages/markdown`        | Markdown validation and rich content rendering              |
| `packages/storage-browser` | IndexedDB persistence through Dexie                         |
| `packages/storage-server`  | PostgreSQL stores, migrations, and attachments              |
| `packages/sync`            | Queue, lease, checkpoint, and synchronization logic         |
| `packages/ui`              | Shared interface components and icons                       |
| `docs`                     | Design, development, verification, and operation guides     |

## Requirements

- Node.js 26.8.1
- pnpm 12.3.4
- Docker Engine and Docker Compose
- PostgreSQL 18 for a self-hosted installation

The repository enforces the Node.js and pnpm versions in `package.json`.

## Development setup

Install dependencies and start the disposable test database:

```bash
pnpm install --frozen-lockfile
tools/test-database/ensure-postgres.sh
```

Run the complete code verification gate:

```bash
pnpm verify
```

Run the browser journey tests:

```bash
pnpm test:e2e
```

The browser suite covers Chromium, Firefox, WebKit, a 390-pixel phone, and a
768-pixel tablet. It tests login styles, responsive navigation, note lifecycle,
ordered saves, offline recovery, feature access, and conflict resolution.

Useful commands:

| Command                 | Result                                                |
| ----------------------- | ----------------------------------------------------- |
| `pnpm build`            | Builds every package, the server, and the PWA         |
| `pnpm typecheck`        | Checks all TypeScript projects                        |
| `pnpm lint`             | Checks versions, source rules, and package boundaries |
| `pnpm format:check`     | Checks Prettier formatting                            |
| `pnpm test:unit`        | Runs unit tests                                       |
| `pnpm test:integration` | Runs PostgreSQL and IndexedDB integration tests       |
| `pnpm test:e2e`         | Runs the complete Playwright matrix                   |
| `pnpm perf:bundle`      | Checks the browser entry bundle budget                |
| `pnpm perf:service`     | Checks service and search performance budgets         |

## Self-hosting

Copy `.env.example` to `.env`, create the protected secret files, and validate
the Compose configuration before startup. Secret files must stay outside the
repository and use mode `0600`.

```bash
cp .env.example .env
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

The Compose stack contains PostgreSQL, a one-time migration service, and one
application service. The default bind address is `127.0.0.1`. Put an HTTPS
reverse proxy in front of it for a permanent installation. PostgreSQL is not
published to the host.

Read the [self-hosting guide](docs/operations/self-hosting.md) before you create
secrets or production data. It includes local network access, owner bootstrap,
account recovery, storage encryption, backup, restore, health checks, metrics,
upgrade, and rollback procedures.

## Initial owner

Public registration is disabled. After the first migration, create one owner
with a password from a protected file:

```bash
export NOTESAPP_BOOTSTRAP_PASSWORD_FILE=/run/secrets/first-password
pnpm owner:bootstrap --email owner@example.com --name "Owner"
```

Use `pnpm account:recover --email owner@example.com` with
`NOTESAPP_RECOVERY_PASSWORD_FILE` when an operator must reset a local password.
The recovery command revokes existing sessions.

## API and MCP

The OpenAPI contract is in `packages/api-contract/openapi.yaml`. Generated
clients must match this contract. Use these commands after a contract change:

```bash
pnpm contract:lint
pnpm generate
pnpm generated:check
```

See the [API and MCP guide](docs/development/api-and-mcp.md) for transport,
authentication, and tool details.

## Documentation

- [Initial design](docs/design/001-initial-design.md)
- [Client repair design](docs/design/002-holistic-client-repair.md)
- [Verification guide](docs/development/verification.md)
- [Database model](docs/development/database.md)
- [Identity and access](docs/development/identity.md)
- [Toolchain](docs/development/toolchain.md)
- [Self-hosting and recovery](docs/operations/self-hosting.md)

## License

NotesApp is available under the [MIT License](LICENSE).
