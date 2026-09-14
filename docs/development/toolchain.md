# Toolchain

This document owns the dependency policy, the compiler policy, and the checks
that `pnpm lint` and `pnpm lint:types` run. It records no version number and no
measured result. The manifests hold the versions, and
`tools/check-versions.mjs` fails the gate when a manifest and the installed tree
disagree.

## Versions

Node and pnpm are pinned in `.node-version`, and in `engines` and
`packageManager` in the root `package.json`. Every dependency is pinned to an
exact version, once, in a manifest or in the `pnpm-workspace.yaml` catalog.

- Check a version against the registry and the release notes before you change
  it. Registry availability does not prove runtime behaviour.
- A prerelease is refused. A release candidate line stays unused while a stable
  line exists.
- `pnpm install` uses exact versions, strict engines, strict peers, no
  automatic peer installation, and explicit `workspace:*` links. There is no
  major version override.
- pnpm refuses an unreviewed build script. `pnpm-workspace.yaml` lists the
  ones that were read and decided.

A version change is one commit over the manifest and the lockfile. The
evidence belongs in that commit body, not here.

## Automated bumps

`.github/dependabot.yml` opens the bump changes. It runs once a week. It groups
each wave into one change per area: the runtime dependencies, the development
and build tools, the GitHub Actions, and the container images of `Dockerfile`
and the Compose files. Each change carries a conventional commit prefix.

The npm entry sets an increasing versioning strategy, so Dependabot writes a new
exact version into a manifest that already holds one. No range reaches a
manifest, and `tools/check-versions.mjs` accepts the change. Dependabot reaches
a version that a manifest states, and a person bumps a catalog version by hand.
Review a bump like any other change. Run `pnpm verify` on the branch, and run
the browser matrix when it touches the editor, the router, or a storage library.

Two pins stay manual, and the configuration says why.

- TypeScript. `tools/check-versions.mjs` names the version of the code
  generator and the version of every other package, so a bump edits that check
  in the same commit.
- The image digest inside the `perf:service` script of the root `package.json`.
  Dependabot reads a Dockerfile and a Compose file, not a script. Move this
  digest with the base image digest of `Dockerfile`.

## Packages

`pnpm-workspace.yaml` names the workspace globs. Each package carries its
`@notesapp/` name, a `package.json`, a `tsconfig.json`, a `src/index.ts`, and
`typecheck`, `build`, and `test:unit` scripts.

A package exposes only `exports["."]`. It publishes no internal path, so a
consumer cannot reach past the public entry and a boundary stays provable.

Each app, each package, and the `tests` tree carries its own `AGENTS.md` with
the rules of that directory. Read it before you edit under it.

## Compiler settings

`tsconfig.base.json` holds the strict settings that every package inherits.
Each package then has two configurations: `tsconfig.json` for the type check,
which covers the adjacent `*.test.ts` files, and `tsconfig.build.json` for the
declaration emit, which excludes them. A consumer uses `references` to the
build configuration, so it reads emitted declarations and not another
package's sources.

Three settings need a reason before they are changed.

- **`skipLibCheck`.** It stays off. A package turns it on only when a
  third-party declaration does not compile under the strict base, and the
  reason belongs in a comment next to the setting. Application sources are
  still checked in full.
- **`exactOptionalPropertyTypes`.** It stays on everywhere except inside
  `packages/api-client`, whose generated vendor transport does not compile with
  it. `tools/check-exact-optional.test.mjs` fails when a consumer stops
  enforcing it.
- **`lib`.** A browser package that needs a browser type adds the `DOM`
  library rather than turning off `skipLibCheck`.

A handwritten relative import carries an explicit `.ts` extension. Node's type
stripping runs an adjacent test file directly and does not map `./path.js` to
`./path.ts`, so a `.js` specifier fails at run time. The base configuration
accepts the specifier and rewrites it on emit. An emitting package sets an
explicit `rootDir` and excludes `**/*.test.ts` from its build. Generated output
keeps the extension its generator writes.

An error class avoids a TypeScript parameter property for the same reason.

## The checks

`pnpm lint` runs these in order. Each check in this table takes a
`--root <directory>` flag and has a root tool test over a fixture tree.

| Check                          | Proves                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| `tools/check-versions.mjs`     | The installed runtime matches the pins in the manifests.           |
| `oxlint`                       | The source rules that need no type information, with no warning.   |
| `tools/check-boundaries.mjs`   | The package graph, the browser rule, and the transport rule.       |
| `tools/check-agents-md.mjs`    | The root guide matches `rules/`, and each directory has its guide. |
| `tools/check-docs.mjs`         | The documentation rules of `docs/README.md`.                       |
| `tools/check-design-rules.mjs` | The styling and user-facing text rules of the interface code.      |

`pnpm lint` reads the sources only, so it passes in a fresh checkout with no
build output. `pnpm lint:types` runs `oxlint --type-aware`, which needs the
emitted declaration of every workspace package, so it runs after `pnpm build`
and `pnpm verify` keeps that order. `tools/check-declarations.mjs` runs first
inside it and names that one cause when the build output is absent.

`tools/check-boundaries.mjs` holds the rules that
[Architecture](architecture.md) states. It parses every source file rather than
matching text, so an import cannot hide behind an alias, a destructuring, or a
computed member access. A module path it cannot resolve statically is refused
rather than ignored.

Two rules need care when you read a failure.

- **Do not name a binding after a transport.** `fetch`, `XMLHttpRequest`,
  `WebSocket`, and `EventSource` are refused in value position, so a variable
  with one of those names fails at its first use. Choose another name. A type
  position and a plain object key are accepted.
- **A declaration package satisfies a type-only import.** `@types/<name>` in
  the manifest declares an `import type` of `<name>`. A value import of the
  same name still needs the runtime package.

Every exemption is an exact file path or an exact generated directory, never a
glob that a later task can widen. An exemption turns off one rule and leaves
the others in force. Add a fixture to the checker's test in the same change
that adds an exemption.

`.oxlintrc.json` also refuses a DOM global and a Node global inside the
packages that both runtimes share. The boundary checker sees imports only, so a
package that loads the `DOM` type library could otherwise reach `document` or
`process` with no import at all.

## Generation

`pnpm generate` rewrites the contract index and the typed client.
`pnpm generated:check` runs the same code into a temporary directory and
compares the bytes, so it needs no Git history. Never edit a file under a
`src/generated/` directory. See [Adding an API operation](api-contract.md).

`tools/sdk-codegen` owns its own TypeScript version, because the generator
reads a compiler API that the root version does not expose. Its package
scripts run that compiler, so the recursive root type check never uses it.
