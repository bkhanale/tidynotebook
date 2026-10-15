# 0222. Distribution runtime dependencies form a complete graph

- Status: Accepted. Process parts superseded by [0228](0228-hosted-proof-and-release.md)
- Date: 2026-10-13

## Context

The production deploy retains an unused optional schema tool of Better Auth.
Its compiler binary carries security findings. A process-local exclusion
changes the frozen lock settings and stops the deploy. The pinned manager
removes a peer declaration through an override but keeps its optional
metadata. That metadata restores the unused peer. Removing files after
installation can leave a required dependency unresolved.

## Decision

- `.pnpmfile.cjs` removes only the unused Better Auth schema peer declaration
  and its optional metadata before resolution. Its guard requires the exact
  reviewed package and fields. The generated lock binds the hook checksum.
  The builder retains the direct developer schema tool and its dependencies.
- The frozen install and production deploy use the same committed settings
  and lock. Sharp retains its platform-specific optional packages.
- `tools/runtime-dependencies.mjs` checks the deployed server before notice
  generation. It reads all installed packages, including unused virtual-store
  entries. It refuses schema tools, their loaders and compiler packages.
- The check resolves each required dependency and required peer from its
  consumer. A missing package, a broken link or a path outside the deployed
  server stops the build. An absent optional dependency or peer is permitted.
  A present optional package receives the same checks as any other package.
- The image test applies the same check to the actual runner. Source archives
  and notices describe the builder and runner through their existing paths.

## Consequences

`tools/runtime-dependencies.test.mjs` holds the refusal and graph rules.
`tests/image/distribution-notices.test.ts` holds the actual runtime result.
Existing auth, session, bootstrap, migration and recovery tests remain.
The operator HTTP contract, settings and image commands stay the same.
The cloud needs no interface change when it selects a corrected image.
The check proves dependency presence and closure. It does not prove that all
runtime libraries have no security finding.
