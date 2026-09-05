# Toolchain

Verified on 2026-09-05 against the npm registry and official release sources.
The root installs quality tools only. Application packages are added by their
implementation tasks. No E2E dependency, test, fixture, configuration, or CI job
is included.

## Runtime and package manager

Use Node 26.8.1 and pnpm 12.3.4. `.node-version`, `engines`, and `packageManager`
record the pins. The Node Linux x64 archive was checked against its official
SHA-256 manifest. The pnpm native package was checked against registry integrity.
This session keeps both runtimes in ignored `.tooling/` paths. No global runtime
or Git configuration was changed.

```sh
export PATH="$PWD/.tooling/bin:$PATH"
node --version
pnpm --version
pnpm install --frozen-lockfile
```

The local executable paths are `.tooling/bin/node` and `.tooling/bin/pnpm`. A new
checkout can use an existing installation of the exact versions. The ignored
local downloads are not part of the build contract.

The [Node release index](https://nodejs.org/dist/index.json) lists 26.8.1 as Current.
The [pnpm installation guide](https://pnpm.io/installation) describes pnpm 12 as a
native executable and uses the `latest-12` channel. Its npm installer needs Node
22.13 or later, while registry engines say `>=18.*`. Node 26.8.1 meets both.
[Node checksums](https://nodejs.org/dist/v26.8.1/SHASUMS256.txt).

## Checked package versions

Every version below exists as a stable registry release. The link is the exact
metadata checked. Packages outside the root quality tools are checked, not yet
installed as application dependencies. Recheck their metadata immediately before
the task that installs them. Registry availability does not prove runtime behavior.

| Package                                                                                         | Version  | Status          |
| ----------------------------------------------------------------------------------------------- | -------- | --------------- |
| [react](https://registry.npmjs.org/react/19.2.8)                                                | 19.2.8   | Later task      |
| [react-dom](https://registry.npmjs.org/react-dom/19.2.8)                                        | 19.2.8   | Later task      |
| [vite](https://registry.npmjs.org/vite/8.2.2)                                                   | 8.2.2    | Later task      |
| [react-router](https://registry.npmjs.org/react-router/8.3.1)                                   | 8.3.1    | Later task      |
| [tailwindcss](https://registry.npmjs.org/tailwindcss/4.3.3)                                     | 4.3.3    | Later task      |
| [@base-ui/react](https://registry.npmjs.org/@base-ui/react/1.8.0)                               | 1.8.0    | Later task      |
| [@codemirror/state](https://registry.npmjs.org/@codemirror/state/6.7.4)                         | 6.7.4    | Later task      |
| [@codemirror/view](https://registry.npmjs.org/@codemirror/view/6.43.11)                         | 6.43.11  | Later task      |
| [@codemirror/commands](https://registry.npmjs.org/@codemirror/commands/6.11.0)                  | 6.11.0   | Later task      |
| [@codemirror/language](https://registry.npmjs.org/@codemirror/language/6.12.4)                  | 6.12.4   | Later task      |
| [@codemirror/lang-markdown](https://registry.npmjs.org/@codemirror/lang-markdown/6.5.2)         | 6.5.2    | Later task      |
| [unified](https://registry.npmjs.org/unified/11.0.5)                                            | 11.0.5   | Later task      |
| [remark-parse](https://registry.npmjs.org/remark-parse/11.0.0)                                  | 11.0.0   | Later task      |
| [remark-gfm](https://registry.npmjs.org/remark-gfm/4.0.1)                                       | 4.0.1    | Later task      |
| [remark-math](https://registry.npmjs.org/remark-math/6.0.0)                                     | 6.0.0    | Later task      |
| [remark-rehype](https://registry.npmjs.org/remark-rehype/11.1.2)                                | 11.1.2   | Later task      |
| [rehype-sanitize](https://registry.npmjs.org/rehype-sanitize/6.0.0)                             | 6.0.0    | Later task      |
| [rehype-stringify](https://registry.npmjs.org/rehype-stringify/10.0.1)                          | 10.0.1   | Later task      |
| [katex](https://registry.npmjs.org/katex/0.18.5)                                                | 0.18.5   | Later task      |
| [mermaid](https://registry.npmjs.org/mermaid/11.17.2)                                           | 11.17.2  | Later task      |
| [fastify](https://registry.npmjs.org/fastify/5.12.3)                                            | 5.12.3   | Installed       |
| [@redocly/cli](https://registry.npmjs.org/@redocly/cli/2.51.2)                                  | 2.51.2   | Installed       |
| [ajv](https://registry.npmjs.org/ajv/8.20.0)                                                    | 8.20.0   | Installed       |
| [ajv-formats](https://registry.npmjs.org/ajv-formats/3.0.1)                                     | 3.0.1    | Installed       |
| [drizzle-orm](https://registry.npmjs.org/drizzle-orm/0.45.2)                                    | 0.45.2   | Installed       |
| [drizzle-kit](https://registry.npmjs.org/drizzle-kit/0.31.10)                                   | 0.31.10  | Installed       |
| [pg](https://registry.npmjs.org/pg/8.23.0)                                                      | 8.23.0   | Installed       |
| [dexie](https://registry.npmjs.org/dexie/4.4.5)                                                 | 4.4.5    | Later task      |
| [vite-plugin-pwa](https://registry.npmjs.org/vite-plugin-pwa/1.3.0)                             | 1.3.0    | Later task      |
| [workbox-build](https://registry.npmjs.org/workbox-build/7.4.1)                                 | 7.4.1    | Later task      |
| [@modelcontextprotocol/server](https://registry.npmjs.org/@modelcontextprotocol/server/2.0.0)   | 2.0.0    | Later task      |
| [@modelcontextprotocol/client](https://registry.npmjs.org/@modelcontextprotocol/client/2.0.0)   | 2.0.0    | Later task      |
| [@modelcontextprotocol/fastify](https://registry.npmjs.org/@modelcontextprotocol/fastify/2.0.0) | 2.0.0    | Later task      |
| [@modelcontextprotocol/node](https://registry.npmjs.org/@modelcontextprotocol/node/2.0.0)       | 2.0.0    | Later task      |
| [typescript](https://registry.npmjs.org/typescript/7.0.2)                                       | 7.0.2    | Root tool       |
| [typescript](https://registry.npmjs.org/typescript/6.0.3)                                       | 6.0.3    | SDK generator   |
| [pnpm](https://registry.npmjs.org/pnpm/12.3.4)                                                  | 12.3.4   | Package manager |
| [oxlint](https://registry.npmjs.org/oxlint/1.81.0)                                              | 1.81.0   | Root tool       |
| [oxlint-tsgolint](https://registry.npmjs.org/oxlint-tsgolint/7.0.2001)                          | 7.0.2001 | Root tool       |
| [prettier](https://registry.npmjs.org/prettier/3.9.6)                                           | 3.9.6    | Root tool       |
| [@hey-api/openapi-ts](https://registry.npmjs.org/@hey-api/openapi-ts/0.99.0)                    | 0.99.0   | Installed       |
| [better-auth](https://registry.npmjs.org/better-auth/1.7.2)                                     | 1.7.2    | Installed       |
| [@better-auth/oauth-provider](https://registry.npmjs.org/@better-auth/oauth-provider/1.7.2)     | 1.7.2    | Installed       |
| [@better-auth/core](https://registry.npmjs.org/@better-auth/core/1.7.2)                         | 1.7.2    | Installed       |
| [@better-auth/utils](https://registry.npmjs.org/@better-auth/utils/0.4.2)                       | 0.4.2    | Installed       |
| [@better-fetch/fetch](https://registry.npmjs.org/@better-fetch/fetch/1.3.1)                     | 1.3.1    | Installed       |
| [better-call](https://registry.npmjs.org/better-call/1.4.0)                                     | 1.4.0    | Installed       |
| [nodemailer](https://registry.npmjs.org/nodemailer/10.0.0)                                      | 10.0.0   | Installed       |
| [@types/node](https://registry.npmjs.org/@types/node/26.4.1)                                    | 26.4.1   | Root tool       |
| [oxc-parser](https://registry.npmjs.org/oxc-parser/0.148.0)                                     | 0.148.0  | Root tool       |

`@types/node` 26.4.1 matches the runtime major. `oxc-parser` 0.148.0 is an
additional development dependency. The boundary checker uses its TypeScript AST
to inspect imports and transport calls. This avoids dependence on the removed
TypeScript 7 JavaScript compiler API. It requires Node `^20.19.0 || >=22.12.0`.

## Compatibility evidence

- TypeScript 7.0.2 compiles the tooling with `strict`,
  `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. Its CLI works.
  Its default export reports the version, but `factory` and `createProgram` are
  undefined. It does not expose the legacy JavaScript compiler API. The
  [TypeScript 7 release notes](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  describe the native compiler transition.
- SDK code generation must own an exact TypeScript 6.0.3 dependency in
  `tools/sdk-codegen`. The [6.0.3 metadata](https://registry.npmjs.org/typescript/6.0.3)
  requires Node `>=14.17`. Hey API 0.99.0 requires Node `>=22.18.0` and declares
  TypeScript peers `>=5.5.3 || >=6.0.0 || 6.0.1-rc`. That broad peer range does
  not prove compiler API support in TypeScript 7. An isolated local probe ran
  the generator with the TS 6 compiler API and produced a health-operation SDK.
  [Hey API release](https://github.com/hey-api/hey-api/releases/tag/@hey-api%2Fopenapi-ts@0.99.0).
- The probe exposed a real limitation: default generated fetch transport fails
  strict TS 7 checks with `exactOptionalPropertyTypes`. Reported fields include
  `serializedBody`, `allowReserved`, `path`, `map`, and SSE request/event fields.
  Task 2 must resolve this in the generation process and pass the full generated
  output check. Application strict settings remain enabled. No handwritten SDK
  or transport has been added. This probe does not claim SDK compatibility.
- Better Auth 1.7.2 directly requires `@better-auth/utils` 0.4.2. The OAuth
  provider 1.7.2 also requires exactly 0.4.2 as a peer. Retain that nested version;
  do not override it to a newer major. The provider requires Better Auth and
  core `^1.7.2`, better-call 1.4.0, and better-fetch 1.3.1.
- Rechecked on 2026-09-06 and installed in `apps/server`. Strict peer
  installation refuses a missing peer, so `@better-auth/oauth-provider` also
  needs `@better-auth/core` 1.7.2, `@better-auth/utils` 0.4.2,
  `@better-fetch/fetch` 1.3.1, and `better-call` 1.4.0 as direct dependencies.
  All four are the exact versions that Better Auth 1.7.2 already resolves, so
  no second copy is installed. The OAuth provider itself is not enabled yet:
  it serves the remote MCP authorization of Task 20.
- Better Auth 1.7.2 declares optional peers `drizzle-orm` `^0.45.2` and
  `drizzle-kit` `>=0.31.4`, which the selected versions satisfy. Its Drizzle
  adapter reads a field through the property name of the table object, so the
  identity tables in `packages/storage-server/src/schema.ts` use the Better
  Auth field names as properties and snake case column names.
- The generic OAuth plugin of 1.7.2 registers a configured provider as a social
  provider, so an OpenID Connect sign-in uses `/api/auth/sign-in/social` and
  `/api/auth/callback/:id` rather than separate OAuth 2.0 endpoints. Discovery
  runs when the auth context is first used, so an unreachable provider fails
  the first sign-in and not process startup.
- `nodemailer` 10.0.0 is the SMTP transport of local password recovery. It is
  an implementation dependency of a design feature, not new product scope. It
  ships its own type declarations and requires Node `>=20.0.0`. The design
  names SMTP recovery but no package, so this pin is recorded here.
  [nodemailer metadata](https://registry.npmjs.org/nodemailer/10.0.0).
- `fastify` 5.12.3 is also a root development dependency, because
  `tests/integration/support/identity-provider.ts` runs a small OpenID Connect
  provider in process. It is the same pinned version that `apps/server` uses.
  The root already carries `pg` for the same reason.
- React DOM 19.2.8 requires React `^19.2.8`. Router 8.3.1 requires React and
  React DOM `>=19.2.7` and Node `>=22.22.0`. The selected versions meet these
  ranges. Base UI accepts React 19. Optional date and type peers are recorded
  upstream and must be installed only when needed.
- Vite 8.2.2 requires Node `^20.19.0 || >=22.12.0`. PWA plugin 1.3.0 accepts
  Vite 8 and Workbox `^7.4.1`. Its assets generator peer is optional.
- Ajv formats 3.0.1 accepts Ajv `^8.0.0`. Redocly 2.51.2 accepts Node 26. Use
  Ajv's explicit 2020-12 entry point for the contract, as described in
  [Ajv dialect support](https://ajv.js.org/json-schema.html).
- Drizzle ORM 0.45.2 accepts pg `>=8`; pg 8.23.0 requires Node `>=16`.
  Better Auth accepts the selected Drizzle ORM and Kit versions.
- MCP adapters 2.0.0 require Node `>=20`. The Fastify adapter accepts Fastify
  `^5.2.0` and MCP server `^2.0.0`. The Node adapter also requires Hono
  `^4.11.4`; verify and pin that peer if the later task uses this adapter.
- Oxlint 1.81.0 requires Node `^20.19.0 || >=22.12.0` and the selected
  oxlint-tsgolint version `>=7.0.2001`. Its vite-plus peer is optional.
  [Oxlint release](https://github.com/oxc-project/oxc/releases/tag/oxlint_v1.81.0).
- PostgreSQL 18.6 is recorded in its
  [official release notes](https://www.postgresql.org/docs/release/18.6/).
  Docker and Compose are reference deployment versions in the design, not
  installed by this task. The host currently has Docker 26.1.5 and Compose
  2.26.1. Their application checks belong to the storage and deployment tasks.

## Workspace conventions

`pnpm-workspace.yaml` discovers `apps/*`, `packages/*`, and
`tools/sdk-codegen`. Installation uses exact versions, strict engines and peers,
no automatic peer installation, and explicit `workspace:*` links. There are no
major-version overrides. The lockfile records the installed root tool graph.

Each new package must have its assigned `@notesapp/` name, `package.json`,
`tsconfig.json`, `src/index.ts`, and `typecheck`, `build`, and `test:unit` scripts.
Expose only `exports["."]`. Do not expose internal paths. Configure runtime
exports for the package build. Package test scripts call
`node ../../tools/run-tests.mjs unit`; the runner uses the current package.

Application packages extend `tsconfig.base.json` and use root TypeScript 7.
Browser packages add DOM libraries and bundler resolution where required.
Server packages add Node types. Code generation extends the same strict base
but invokes its own TypeScript 6 executable. The root tooling context is
`tsconfig.json`, with strict JavaScript checks for `tools/*.mjs`. The root file
keeps that name because type-aware lint resolves the nearest `tsconfig.json` for
each file; every package supplies its own. The recursive root commands run each
package's own compiler/build script.

### Import extensions

Handwritten relative imports carry an explicit `.ts` extension, for example
`import { normalizePath } from './path.ts'`. Node's type stripping runs an
adjacent `*.test.ts` file directly and does not map `./path.js` to `./path.ts`,
so a `.js` specifier fails at run time. `tsconfig.base.json` therefore sets
`allowImportingTsExtensions` and `rewriteRelativeImportExtensions`. The first
accepts the specifier. The second rewrites it to `./path.js` on emit, so a
package that emits, such as the server or the API client, still builds with
`tsc`. An emitting package must set an explicit `rootDir`, otherwise `tsc`
reports TS5011. It must also exclude `**/*.test.ts` in its build configuration,
so adjacent test files are not emitted into `dist`. The type check
configuration still covers those files.

This applies to handwritten source only. Generated output keeps the extension
that its generator writes. Bare package specifiers are unchanged: a package is
always imported by its public name, never by a file path.

A local probe under `.tooling/compat/ts-extensions/` proved this on 2026-09-05
with Node 26.8.1 and TypeScript 7.0.2. An `index.test.ts` file that imports
`./index.ts` passed under `node --test`, type-checked with a `tsconfig.json`
extending `tsconfig.base.json`, emitted `./index.js` in the compiled output, and
the emitted file also ran under `node --test`.

## Commands and boundaries

| Command                             | Behavior                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm typecheck`                    | Check tool scripts with TS 7, package type checks, then the integration tree. |
| `pnpm lint`                         | Check pins and runtime, type-aware Oxlint, and source boundaries.             |
| `pnpm format:check`                 | Check maintained source and configuration formatting.                         |
| `pnpm test:unit`                    | Run adjacent package tests and root tool tests with Node.                     |
| `pnpm test:integration -- contract` | Build the packages, then run the named service integration test.              |
| `pnpm build`                        | Check tools, then run package builds in dependency order.                     |
| `pnpm contract:lint`                | Check `openapi.yaml` with the strict Redocly rules.                           |
| `pnpm generate`                     | Bundle the contract, write the validators, and write the SDK.                 |
| `pnpm generated:check`              | Generate into a temporary directory and compare bytes.                        |

Unit test discovery covers `*.test.ts` and `*.test.mjs` only. It does not
discover `*.test.tsx`, because Node cannot strip JSX. Until the authorized E2E
stage, React component behavior is verified by unit tests over the pure
functions behind a component and by manual inspection, not by a component test
runner. Integration discovery covers the repository-root `tests/integration`
tree.

Test selectors match a basename without `.test.ts` or an exact repository-relative
path. Every supplied selector must exist. A missing selector exits 1. Test
failures and process failures exit nonzero. An unfiltered suite with no tests
prints an explicit message; it does not claim that tests passed. No application
tests exist at Task 1.

The boundary checker rejects package cycles, disallowed dependency directions,
deep imports, relative imports outside a package, undeclared imports, browser
imports of Node modules and server dependencies, and handwritten application
HTTP transports.

Oxlint runs with `--type-aware --deny-warnings`. It checks import cycles within
source modules, forbids `any` and non-null assertions, and adds the type-aware
rules `typescript/no-floating-promises`, `typescript/no-misused-promises`,
`typescript/await-thenable`, and `typescript/no-unsafe-assignment`. Type-aware
rules need type information, so a file must be covered by the nearest
`tsconfig.json`. One override, listed by the two exact generated paths, turns
off `typescript/no-explicit-any`, `typescript/no-non-null-assertion`,
`typescript/no-unsafe-assignment`, `typescript/no-redundant-type-constituents`,
`typescript/no-misused-spread`, and `typescript/no-floating-promises` for
generated output, which cannot satisfy them. The spread rule was added when the
first operation with a request body landed: the generated call spreads
`options.headers`, whose declared type includes an array form. Generated output is otherwise linted like every other file. A later task
that generates new output may need to extend that exact list; it must not widen
the glob.

### Browser-safe packages

These packages must run in a browser: `web`, `api-client`, `core`,
`storage-browser`, `sync`, `markdown`, `editor`, and `ui`. Core is part of this
set because the design requires core to hold domain rules for both runtimes.

A browser-safe package must not import a Node built-in module. This covers the
`node:` prefix and the bare built-in names, for example `node:fs`, `fs`,
`fs/promises`, `path`, and `crypto`. It must not import a Node-only package
either: `pg`, `fastify`, `fastify-plugin`, `drizzle-orm`, `drizzle-kit`,
`better-auth`, `sharp`, `dotenv`, and every `@fastify/`,
`@modelcontextprotocol/`, or `@better-auth/` package. It must not import the
server-only workspace packages `@notesapp/server` and
`@notesapp/storage-server`.

The same rule applies to the package manifest. A browser-safe package cannot
list such a package in `dependencies`, `optionalDependencies`, or
`peerDependencies`. Test helpers stay in `devDependencies`, which the browser
build does not use.

The rule is transitive. The checker records the first Node-only or server-only
use of every workspace package, then walks the workspace import graph from each
browser-safe package. A browser-safe package fails when it reaches such a use
through other workspace packages, and the report names the chain. For example,
`web` fails when `sync` imports `core` and `core` imports `node:fs`.

### Test files

A recognized test file is a file whose name ends in `.test.ts`, `.test.tsx`, or
`.test.mjs`, or any file in the repository-root `tests/` tree. A `tests/`
directory inside a package is not itself an exception; a file there is a test
file only when its name matches.

A test file must also sit where a command runs it: a package `src` tree, the
repository-root `tests` tree, or directly in `tools` for a root tool test. The
checker rejects a test file anywhere else, because no command discovers it and
it would silently never run. A recognized test file may import `node:test`,
`node:test/reporters`, `node:assert`, and `node:assert/strict`, also inside a
browser-safe package. Other Node modules stay forbidden there. Test helper
packages belong in `devDependencies`; the browser dependency rule ignores that
group.

A production file must not import a test file. Relative specifiers carry an
explicit `.ts` extension, so the checker resolves the specifier and applies the
same recognizer to the resolved path. Test files do not contribute to
the transitive Node reach above, because they are not part of a browser build.
Every other rule, including package cycles, deep imports, browser-to-server
imports, and handwritten HTTP calls, stays active for test files.

### Inspected import forms

The checker parses JavaScript and TypeScript with the oxc parser and inspects
every import form it produces:

| Form                                           | Handling                               |
| ---------------------------------------------- | -------------------------------------- |
| `import x from 'module'`                       | Checked.                               |
| `export ... from 'module'` and `export * from` | Checked.                               |
| `import('module')` with a string literal       | Checked.                               |
| `import('module')` with any other expression   | Rejected as a computed dynamic import. |
| `type T = import('module').X`                  | Checked.                               |
| `import x = require('module')`                 | Checked, including a type-only form.   |
| `require('module')` with a string literal      | Checked.                               |
| `require(name)` with any other expression      | Rejected as a computed module path.    |

Each rejected form names the file and the reason.

### Transport rules and exact exemptions

The transport names are `fetch`, `XMLHttpRequest`, `WebSocket`, and
`EventSource`. Handwritten application traffic means any of the following:

- A call or `new` expression on a bare transport name, such as `fetch('/x')` or
  `new WebSocket('/x')`.
- A call or `new` expression through a plain property, such as
  `globalThis.fetch('/x')`, `window.fetch('/x')`, `self.fetch('/x')`, or
  `new globalThis.WebSocket('/x')`.
- A reference to a bare transport name in value position, such as
  `const send = fetch`, which would otherwise hide a call behind an alias.
- A destructured transport, such as `const { fetch: send } = globalThis` or
  `const { fetch: send } = deps`. The pattern key is the reference, so a rename
  does not hide it.
- Computed access to a transport name, such as `globalThis['fetch']` or
  `Reflect.get(globalThis, 'fetch')` with a string literal.
- An import of a direct HTTP library such as `axios`, `undici`, or
  `@hey-api/client-fetch`.

A transport name that is not a value reference is accepted: a plain property key
in an object literal such as `{ fetch: 1 }` or `{ fetch: value }`, a member
property such as the `fetch` in `globalThis.fetch` when it is not called, any
type position such as `typeof globalThis.fetch` or `{ fetch?: typeof fetch }`,
and an import or export name.

Do not name a parameter, variable, or other binding after a transport. The
declaration itself is accepted, but every later use of that name is a value
reference and is rejected. Choose another name.

A computed access that hides the name behind a variable or an expression, for
example `globalThis[key]` or `Reflect.get(globalThis, key)`, cannot be proved by
a static rule. Code review must check semantic wrappers and computed endpoints.

The generated client owns the fetch transport, so the transport rules and the
HTTP library rule are skipped for the two generated paths,
`packages/api-client/src/generated/` and `packages/api-contract/src/generated/`.
Every other rule still applies there, including package direction, deep imports,
and undeclared dependencies.

Protocol exceptions use exact adapter files:
`apps/server/src/auth/better-auth.ts`, `apps/server/src/mcp/server.ts`, and
`apps/mcp-stdio/src/main.ts`. A protocol adapter also states an exact list of
the routes it serves, and startup fails when a contract operation that names
that protocol is not in the list. See `docs/development/api-contract.md`. PWA asset handling uses only
`apps/web/src/pwa/service-worker.ts`; literal application API paths are rejected
there. `packages/api-client/src/configure.ts` is the handwritten client
configuration named in the plan. It may set a base URL and pass a transport
implementation to the generated client, so a transport reference, computed
transport access, and URL construction are accepted in that one file. It must
not call `fetch` itself, so the call and `new` rules stay active for it.

Package direction, browser dependencies, and deep-import checks still apply to
every exception.

The checker accepts `--root <directory>` for disposable verification inputs.
`tools/check-boundaries.test.mjs` uses that option. It writes fixture workspaces
into a temporary system directory, runs the checker against them, and removes
them again. No fixture is committed as application code. `pnpm test:unit`
discovers this test with the other root tool tests.

Formatting excludes generated output, local progress notes, and the two approved
design/plan input documents. Their existing formatting is not changed by this task.

## Task 1 verification

The following local checks passed with Node 26.8.1 and pnpm 12.3.4:

- `pnpm install` and `pnpm install --frozen-lockfile`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm build`.
- `pnpm test:unit` runs the checker's own tests. `pnpm test:integration`
  reports no tests yet.
- `tools/check-boundaries.test.mjs` covers the checker with temporary fixture
  workspaces. It accepts a browser-safe workspace, test files that use the Node
  test runner, a property or type named `fetch`, the generated client
  transport, a transport name in a type query, a transport name as an object
  literal key, and base URL and transport options in the client configuration.
  It
  rejects a deep import, a `fetch` call, computed transport access, a
  `new WebSocket()`, a cross-package relative re-export, a package cycle, a
  computed import, a computed `require`, a renamed destructured transport, a
  destructured transport constructor, a transport destructured from a
  dependency object, `Reflect.get` access to a transport, a `globalThis.fetch`
  call, a
  `window.fetch` call, a `self.fetch` call, a transport alias, a
  `new globalThis.WebSocket()`, a test file outside a runnable tree, a Node
  built-in in core, a bare
  built-in name, Node reach through a workspace package, a Node-only manifest
  dependency, a `@fastify/` dependency in a browser package,
  `import x = require('node:fs')`, a deep `import x = require(...)`, another
  Node module inside a test file, a Node test module outside a recognized test
  file, an HTTP library outside generated output, a `fetch` call in the client
  configuration, a forbidden core dependency in any group, and a production
  import of a test file.
- A local lint probe confirmed the type-aware rules. A floating promise in a
  probe file was rejected. A non-null assertion was rejected in a handwritten
  file under `packages/api-client/src/` and accepted under its `generated/`
  path, which proves the exact-glob override. The probe files were removed.
- A local probe confirmed the import extension settings. See the
  "Import extensions" section above.
- `node tools/check-versions.mjs` rejected a manifest whose `engines.pnpm`
  did not match `packageManager`. The temporary edit was reverted.
- `pnpm test:integration -- missing-task1-probe` exited 1. A temporary tool unit
  test was selected by name and propagated its intentional failure as exit 1.
  The temporary test was removed after the check.

The SDK probe generated output using `@hey-api/typescript`, `@hey-api/sdk`, and
`@hey-api/client-fetch`, then ran this command:

```sh
pnpm exec tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes --module NodeNext --target ES2024 \
  .tooling/compat/generated/index.ts
```

That probe failed with TS2379 or TS2375 in these generated files:

| File                           | Lines           | Incompatible optional fields |
| ------------------------------ | --------------- | ---------------------------- |
| `client/client.gen.ts`         | 93, 105, 230    | `serializedBody`, SSE `body` |
| `client/utils.gen.ts`          | 31, 41, 51, 158 | `allowReserved`, `path`      |
| `core/params.gen.ts`           | 73              | `map`                        |
| `core/pathSerializer.gen.ts`   | 99, 163         | `allowReserved`              |
| `core/serverSentEvents.gen.ts` | 119, 206        | `body`, `event`              |

For example, `string | undefined` is passed to an optional `string` field while
exact optional checking is enabled. The fetch plugin's published types expose
`bundle` and `runtimeConfigPath` options. A search of the installed generator
found no `exactOptionalPropertyTypes` setting. These observations are evidence
for Task 2, not a selected workaround. The probe and diagnostics remain local
under `.tooling/compat/`; application output has not been created.

## Task 2 packages and settings

Every version below was rechecked against the npm registry on 2026-09-05,
immediately before the install that added it. `pnpm install --frozen-lockfile`
passes with the committed lockfile.

| Package               | Version | Workspace                                      |
| --------------------- | ------- | ---------------------------------------------- |
| `fastify`             | 5.12.3  | `apps/server` dependency                       |
| `ajv`                 | 8.20.0  | `packages/api-contract` dependency             |
| `ajv-formats`         | 3.0.1   | `packages/api-contract` dependency             |
| `@hey-api/openapi-ts` | 0.99.0  | `tools/sdk-codegen` development dependency     |
| `@redocly/cli`        | 2.51.2  | `tools/sdk-codegen` development dependency     |
| `typescript`          | 6.0.3   | `tools/sdk-codegen` development dependency     |
| `typescript`          | 7.0.2   | every other new package development dependency |
| `@types/node`         | 26.4.1  | `apps/server` and `tools/sdk-codegen`          |

`packages/api-client` has no runtime dependency. The Hey API fetch plugin
bundles its transport into the generated output, so the client package does not
install `@hey-api/client-fetch`.

TypeScript 6.0.3 exists only inside `tools/sdk-codegen`. Its package scripts run
that compiler, so the recursive root `typecheck` never checks the generator with
TypeScript 7. `tools/check-versions.mjs` already fails a manifest that pins a
different TypeScript version in either place.

### Compiler settings added by Task 2

- Each new package has `tsconfig.json` for type checking and
  `tsconfig.build.json` for declaration output. The build configuration is
  `composite`, sets an explicit `rootDir`, and excludes `**/*.test.ts`. A
  consumer uses `references` to that build configuration, so it reads emitted
  declarations rather than another package's sources.
- `packages/api-client` sets `exactOptionalPropertyTypes: false` in both of its
  configurations, as the design requires. Every consumer keeps
  `exactOptionalPropertyTypes: true`.
  `tools/exact-optional/fixture.ts` and `tools/check-exact-optional.test.mjs`
  prove that: the fixture assigns `undefined` to an optional member of the
  generated `GetReadinessData` query type, and the test fails when that no
  longer reports TS2375 or TS2379. `pnpm test:unit` runs it.
- Only `apps/server`, `tests/integration`, and `tools/sdk-codegen` set
  `skipLibCheck: true`. The server and the integration tree need it because
  Fastify pulls in `pino` and then `thread-stream` 4.2.0, whose
  `index.d.ts` line 96 reports
  `TS2694: Namespace '"worker_threads"' has no exported member 'TransferListItem'`
  against `@types/node` 26.4.1. The generator workspace needs it because the
  Hey API 0.99.0 declarations do not compile under TypeScript 6.0.3.
  `packages/api-contract` and `packages/api-client` check their library
  declarations in full.
- `packages/api-contract` reaches the Ajv formats plugin through
  `ajvFormats.default(...)`. Ajv formats ships CommonJS, so Node binds a default
  import to `module.exports` and the plugin function is its `default` member.
- `tests/integration/tsconfig.json` covers the integration tree, so type-aware
  Oxlint finds a configuration for those files. The root `typecheck` script runs
  it after the package type checks.
- The root `test:integration` script builds every package first, because the
  integration tests import workspace packages through their published `dist`
  entry points.
- The root `test:unit` script builds only `@notesapp/api-contract`,
  `@notesapp/api-client`, and `@notesapp/core`. Those are the packages that an
  adjacent unit test reaches through `dist`: `apps/server/src/config.test.ts`
  and its neighbours import `@notesapp/api-contract`. An adjacent test in
  another package must not import a workspace package through `dist` unless
  that package is added to this filter list in the same change, otherwise
  `pnpm test:unit` fails on a missing build output.
- Error classes avoid TypeScript parameter properties. Node's type stripping
  runs an adjacent `*.test.ts` file directly and rejects that syntax.

### Generated output

`pnpm generate` runs three steps in a fixed order: Redocly bundles and
dereferences `packages/api-contract/openapi.yaml`, the operation index and its
Ajv validators are written to `packages/api-contract/src/generated/`, and Hey
API writes the SDK to `packages/api-client/src/generated/`. `pnpm
generated:check` runs the same code into a temporary directory and compares
every produced file byte for byte, so it needs no Git history.

The generator sets `output.module.extension` to `.js` and does not set
`output.tsConfigPath`. Ajv standalone code output was not used: it emits
JavaScript, and both generated modules must compile and emit through the
package's TypeScript declaration build. Ajv compiles each schema once when
`packages/api-contract/src/generated/validators.ts` is first imported.

The `.oxlintrc.json` override for the two generated globs now also turns off
`typescript/no-redundant-type-constituents` and
`typescript/no-floating-promises`. The generated fetch transport trips both. The
globs were not widened.

`tools/check-boundaries.mjs` now applies the transport call and reference rules
to the repository-root `tests/` tree as well. A test is application code: it
calls a generated operation, or the framework's in-process `app.inject()`
utility for a request that no operation can express. Nothing in that tree is
exempt.

## Task 2 verification

The following local checks passed with Node 26.8.1 and pnpm 12.3.4:

- `pnpm install`, then `pnpm install --frozen-lockfile`.
- `pnpm contract:lint`, `pnpm generate`, `pnpm generated:check`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.
- `pnpm test:unit` runs the tool tests, the exact optional proof, and the
  adjacent server tests for configuration, host names, correlation ids, error
  classification, route paths, media types, and the startup checks.
- `pnpm test:integration -- contract` runs 22 contract tests through the
  generated client against a real listening Fastify server, plus the boundary
  rules that no generated operation can express through `app.inject()`.

## Task 3 package settings

`packages/core` holds the shared domain rules. It has no runtime dependency, so
nothing new was installed for the browser. Its only development dependencies are
`typescript` 7.0.2 and `@types/node` 26.4.1, both rechecked against the registry
on 2026-09-05 and already used elsewhere in this workspace.

A browser-safe package that keeps adjacent tests follows this pattern:

- `tsconfig.json` sets `types: ["node"]`, because the type check covers the
  adjacent `*.test.ts` files and those files import `node:test` and
  `node:assert/strict`.
- `tsconfig.build.json` excludes `src/**/*.test.ts` and keeps the empty `types`
  list of `tsconfig.base.json`. An adjacent test is therefore never emitted into
  `dist`, and production sources compile without any Node global, so a
  browser-only rule cannot reach `process` or `Buffer` unnoticed. The boundary
  checker already rejects a `node:` import there.
- `@types/node` stays in `devDependencies`. The browser build does not read that
  group, and the boundary checker allows a test helper only in that group.

`packages/core` does not set `skipLibCheck`. It has no third-party runtime
declarations to skip, so the strict base setting stays in force.

`tools/actor-brand/` holds a second compile-time proof, built on the pattern of
`tools/exact-optional/`. `fixture.ts` assigns a plain object to `Actor` and
passes it to `authorize`. `tools/check-actor-brand.test.mjs` builds
`packages/core`, compiles the fixture, and fails when the two expected errors
about the missing verified actor marker disappear. The fixture reads the
package through its emitted declarations. TypeScript 7 removed `baseUrl`, so
its `paths` entry is written relative to the configuration file.

## Task 12 package settings

`packages/markdown` holds the shared Markdown parser, reference extraction, and
safe renderer. It is a browser-safe package, so every runtime dependency below
is browser-safe too and nothing in it reads a file or opens a connection.

The versions were rechecked against the registry on 2026-09-06 with
`npm view <package> dist-tags.latest`. Each one is the newest stable release of
its major line, so nothing moved past the design baseline and no prerelease was
used.

| Package                                                                       | Version | Purpose                                                           |
| ----------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| [unified](https://registry.npmjs.org/unified/11.0.5)                          | 11.0.5  | Processor that holds the parse, transform, and serialize stages.  |
| [remark-parse](https://registry.npmjs.org/remark-parse/11.0.0)                | 11.0.0  | CommonMark parsing with source positions.                         |
| [remark-gfm](https://registry.npmjs.org/remark-gfm/4.0.1)                     | 4.0.1   | Tables, task list items, strikethrough, autolinks, and footnotes. |
| [remark-math](https://registry.npmjs.org/remark-math/6.0.0)                   | 6.0.0   | Inline and display math nodes.                                    |
| [remark-rehype](https://registry.npmjs.org/remark-rehype/11.1.2)              | 11.1.2  | Markdown tree to HTML tree, with raw HTML dropped.                |
| [rehype-sanitize](https://registry.npmjs.org/rehype-sanitize/6.0.0)           | 6.0.0   | Element, attribute, and scheme allow list.                        |
| [rehype-stringify](https://registry.npmjs.org/rehype-stringify/10.0.1)        | 10.0.1  | HTML serialization with text escaping.                            |
| [unist-util-visit](https://registry.npmjs.org/unist-util-visit/5.1.0)         | 5.1.0   | Tree walking for extraction and the URL pass.                     |
| [mdast-util-to-string](https://registry.npmjs.org/mdast-util-to-string/4.0.0) | 4.0.0   | Plain text of a link label.                                       |
| [@types/mdast](https://registry.npmjs.org/@types/mdast/4.0.4)                 | 4.0.4   | Declares the `mdast` module, including the public `Root` type.    |
| [@types/hast](https://registry.npmjs.org/@types/hast/3.0.5)                   | 3.0.5   | Declares the `hast` module used by the renderer stage.            |

GFM covers footnotes, so no separate footnote extension is installed. No front
matter extension is installed either: the design requires front matter to stay
document content.

The two declaration packages are runtime dependencies and not development
dependencies, because the public API returns an mdast `Root`. A consumer of the
emitted declarations needs that module to resolve.

### Compiler settings added by Task 12

`packages/markdown` sets `lib: ["ES2024", "DOM"]` in both its type check and its
build configuration. The `vfile` declarations that unified depends on reference
the WHATWG `URL` global, which the base `ES2024` library does not declare. The
alternative was `skipLibCheck: true`, which would have stopped checking every
third-party declaration in the package. Adding the browser library keeps
`skipLibCheck: false` in force and matches the runtime: this package runs in the
browser. Production sources still list no `types`, so no Node global is
reachable.

The package keeps the Task 3 pattern otherwise: `types: ["node"]` for the type
check only, `src/**/*.test.ts` excluded from the build, and `@types/node` in
`devDependencies`.

### Declaration packages and the boundary checker

`tools/check-boundaries.mjs` now accepts `@types/<name>` in a manifest as the
declaration of an import of `<name>`. TypeScript resolves `import type { Root }
from 'mdast'` through `@types/mdast`, so the module has a declared owner even
though no dependency is literally named `mdast`. Without this rule a package
could only satisfy the checker by adding a fake dependency.

The rule covers a type-only import and nothing else: `import type`,
`export type`, and a type position `import('module')`. Those load nothing at
run time. A value import of the same name still needs the runtime package, so
`import lodash from 'lodash'` fails when only `@types/lodash` is declared, and
a mixed import such as `import { type A, B }` is treated as a value import.
Four fixtures in `tools/check-boundaries.test.mjs` cover both outcomes. Every
other rule is unchanged, and an import with no declaration package at all is
still rejected.

### The shared corpus

The corpus lives in `packages/markdown/test-data/content.ts` and exports the
document as a string, rather than in a `content.md` file. Two repository rules
force this. A browser-safe package may import only `node:test` and
`node:assert` in a test, so a test cannot read a file from disk. Prettier also
formats every `.md` file, and the corpus holds deliberately malformed Markdown
that formatting would repair. A template literal in a TypeScript file is left
exactly as written, so the byte offsets that the range tests assert stay stable.

### Bounded Markdown parsing

A byte cap alone does not bound the cost of reading a note. Several parser
constructs cost time that grows faster than the document does. Measured on the
development machine before the caps existed: 80 KB of `[` and `]` took 16
seconds, 200 KB took 205 seconds, a line of one million `>` characters never
finished, a 220 KB table took 83 seconds, 195 KB of list items took 12 seconds,
and 1 MiB of prose written as one paragraph took 12 seconds.

`packages/markdown/src/limits.ts` therefore runs a pre-scan before any parse, in
every public entry point of the package. It is one pass over the text, and it
caps the shapes whose cost grows faster than their size:

| Limit                               | Value  | Reason code     |
| ----------------------------------- | ------ | --------------- |
| Document size                       | 1 MiB  | `input-size`    |
| Line size                           | 64 KiB | `line-length`   |
| Plain block (paragraph) size        | 64 KiB | `block-size`    |
| Run of one delimiter character      | 1000   | `delimiter-run` |
| Nesting levels written by an author | 100    | `nesting-depth` |
| Link openings in one document       | 2000   | `link-count`    |
| Table rows in one document          | 2000   | `table-rows`    |
| List lines in one document          | 5000   | `list-items`    |

The delimiter set is `[ ] * _ ` ~ > # - + = | $ ! ( ) <`. A table row is a line
that starts with `|` after at most three spaces. A list line is a line that
starts with a bullet or an ordered marker after its indentation. Nesting counts
the block quote markers, the list markers, and the four-column indentation
levels at the start of one line; the parsed tree is measured again afterwards,
because inline constructs such as repeated emphasis nest without a line prefix,
and the levels every document has are subtracted so that the number means what
an author wrote.

A plain block is a run of neighbouring lines that is not blank, not a table
row, not a list line, and not inside a code fence. The parser reads the inline
content of a paragraph as one unit, and that cost grows faster than the
paragraph does. The fence is the one construct the scan recognizes, and it
recognizes it only for this cap: a long fence is cheap because its content is
never read as inline text. Every other cap still applies inside a fence, so a
1 MiB block of generated YAML inside a fence can still trip the list cap.

There is no wall-clock timeout. A timeout would bound one render on one machine
and would make the outcome depend on the load of that machine, so the same note
could render for one reader and fail for another. The shape caps are the bound
instead, and each of them is calibrated by measurement.

Every entry point parses through `parseMarkdown`, so `renderMarkdown`,
`extractLinks`, and `extractAttachmentRefs` are all bounded by both guards. A
refused document throws `MarkdownLimitError`; it is never truncated, because a
half note looks like data loss. The message on the error is technical; a caller
that shows a message to an author should phrase it for that author and read the
value from `markdownLimits`.

`limits.test.ts` builds every capped shape at exactly its cap, renders it, and
prints the time. The measurements on the development machine are:

| Shape at its cap                   | Size    | Render time |
| ---------------------------------- | ------- | ----------- |
| Table of 2000 rows                 | 39 KB   | 0.36 s      |
| List of 5000 lines                 | 94 KB   | 0.33 s      |
| 2000 link openings                 | 92 KB   | 0.21 s      |
| 100 nesting levels                 | 205 B   | 0.001 s     |
| One paragraph of 64 KiB            | 66 KB   | 0.04 s      |
| 1 MiB of prose in short paragraphs | 1.0 MiB | 1.13 s      |
| 1 MiB fenced code block            | 1.0 MiB | 0.15 s      |

The list cap was lowered from 10,000 to 5000 during calibration. A list of
10,000 lines measured between 0.84 and 1.9 seconds depending on what else the
machine was doing, which is too close to the budget to be a stable bound.

Every shape is under one second except the full 1 MiB prose document, and that
one is a size cost rather than a shape cost: the same prose measures 0.10, 0.15,
0.35, and 0.63 seconds at an eighth, a quarter, a half, and the whole of the
cap, which is linear. The design requires a 1 MiB stress file to render, so the
document cap cannot go below it. Each shape one step past its cap is refused in
under 100 ms; the tests assert both.

### Byte order marks and reported ranges

The parser removes a leading U+FEFF before it assigns offsets, so a tree offset
is relative to the text after the mark. `extractLinks` and
`extractAttachmentRefs` add its length back, so every reported range addresses
the string the caller passed in and `source.slice(from, to)` returns the
reported text. `parseMarkdown` returns the tree as the parser built it.

### Restricted globals in shared packages

`.oxlintrc.json` adds a `no-restricted-globals` override for
`packages/core/src/**` and `packages/markdown/src/**`, excluding `*.test.ts`.
The restricted names are `document`, `window`, `navigator`, `location`,
`localStorage`, `sessionStorage`, `fetch`, `process`, `Buffer`, and `require`.
A package that both runtimes share must not reach for a DOM global or a Node
global, and the boundary checker sees imports only. This matters more since
`packages/markdown` loads the `DOM` type library, which makes those names
resolve during the type check.

### Task 12 verification

The following local checks passed with Node 26.8.1 and pnpm 12.3.4:

- `pnpm install`, then `pnpm install --frozen-lockfile`.
- `pnpm --filter @notesapp/markdown test:unit` runs 83 tests, including the
  resource limit measurements above.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`,
  `pnpm build`.

## Task 4 packages and settings

Every version below was rechecked against the npm registry on 2026-09-06,
immediately before the install that added it.

| Package       | Version | Workspace                                          |
| ------------- | ------- | -------------------------------------------------- |
| `drizzle-orm` | 0.45.2  | `packages/storage-server` dependency               |
| `pg`          | 8.23.0  | `packages/storage-server` dependency               |
| `drizzle-kit` | 0.31.10 | `packages/storage-server` development dependency   |
| `@types/pg`   | 8.23.1  | `packages/storage-server` development dependency   |
| `pg`          | 8.23.0  | root development dependency, for integration tests |
| `@types/pg`   | 8.23.1  | root development dependency, for integration tests |
| PostgreSQL    | 18.6    | `compose.test.yaml`, pinned by image digest        |

`drizzle-orm` 0.45.2 and `pg` 8.23.0 are the newest stable releases.
`drizzle-kit` 0.31.10 is the newest stable release of its line. Drizzle also
publishes 1.0.0 release candidates; the dependency policy forbids a prerelease,
so the 0.x lines stay. `@types/pg` 8.23.1 is the newest stable release, one
patch above the design's note, so that patch is pinned. `drizzle-orm` declares
`pg` and `@types/pg` as optional peers, and both are satisfied inside the
package that installs them.

`pg` and `@types/pg` are also root development dependencies, because the row
access tests must issue direct statements. Table rights, row level security,
and immutability triggers are database guarantees that no application call
exposes. The boundary checker still forbids a handwritten transport there; a
database driver is not an HTTP transport.

The root also gains `@notesapp/core` and `@notesapp/storage-server` as
development dependencies, so the repository-root `tests/integration` tree can
import their public entry points, as it already does for the server and the
generated client.

`packages/storage-server` sets `skipLibCheck: true` in both of its compiler
configurations. The published Drizzle declarations do not compile under
TypeScript 7 with the strict base settings: they report errors inside the Gel,
MySQL, and SingleStore dialect files, which this package never loads.
Application sources are still checked in full, and the package keeps `strict`,
`noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.

`packages/storage-server/tsconfig.json` also includes `drizzle.config.ts`, so
type-aware lint finds a compiler configuration for that file. The build
configuration keeps `rootDir: "src"` and excludes it.

`pnpm-workspace.yaml` gained `allowBuilds: { esbuild: false }`. pnpm 12 refuses
an install that has unreviewed build scripts. `drizzle-kit` depends on
`esbuild`, whose install script was checked and is not needed: `drizzle-kit
generate` runs correctly with the script disabled, because the platform binary
arrives through esbuild's optional dependencies.

### Database commands

| Command                            | Behavior                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| `pnpm db:generate`                 | Writes the next Drizzle schema migration. No database needed. |
| `pnpm db:migrate --profile test`   | Migrates the Compose test database.                           |
| `pnpm db:migrate --profile deploy` | Migrates the operator database from protected files.          |

The migration command requires an explicit profile and refuses a database whose
name does not match the profile. `docs/development/database.md` records the
schema, the roles, the row access design, the deferrable accepted path, the
immutability triggers, the test database procedure, and the migration
procedure.

Node runs `packages/storage-server/src/migrate.ts` directly through its type
stripping, so the migration command needs no build step. The file guards its
command entry point with `import.meta.main`, so importing it starts nothing.

### The test service role model

`compose.test.yaml` uses the image superuser for initialization only.
`tools/test-database/init.sql` runs once in `/docker-entrypoint-initdb.d` and
creates the migration role `notesapp_migrate` with `LOGIN`, `CREATEROLE`,
`CREATEDB`, `NOSUPERUSER`, and `NOBYPASSRLS`, plus the database `notesapp_test`
that it owns. Every check therefore runs under the production role model. A
superuser migration role would bypass row level security, and FORCE row level
security would prove nothing.

### Task 4 verification

The following local checks passed with Node 26.8.1 and pnpm 12.3.4:

- `pnpm install`, then `pnpm install --frozen-lockfile`.
- `sudo docker compose -f compose.test.yaml down -v`, then
  `up -d --wait`.
- `pnpm db:generate` reported no schema change against the committed
  `0000_slimy_ravenous.sql`. `0001_row_access.sql` is the reviewed custom
  migration.
- `pnpm db:migrate --profile test`, then the same command again as a no
  operation. The command without a profile exits 1.
- `pnpm test:integration -- storage` runs 22 tests.
- `pnpm test:integration -- row-access` runs 20 tests.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`,
  `pnpm build`.
