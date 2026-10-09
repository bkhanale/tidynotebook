# Agent lifecycle

This page owns phase routing, saved proof, and the public lifecycle boundary.

[Record 0212](../decisions/0212-agent-lifecycle-proof.md) sets the lifecycle.
[Record 0213](../decisions/0213-build-and-publish-one-release-image.md) sets image publication.
Commands perform repeated operations. Skills make the choices of a unit.
Each skill has one start state and one end state. The catalog below routes work.
It does not repeat the instructions of a unit.

## Scope and continuation

A feature or fix request starts preparation and includes build, proof, and PR
review. It includes landing when the session permits it. An agent continues
through those units without asking for the same permission again. A release
request starts the release unit and includes its prepare PR and proof. An
interruption resumes the saved unit. A build request never starts a release,
live deploy, host restore, retirement, or machine cleanup.

Only a missing required input or a real conflict needs a question. The agent
continues work that does not depend on that answer. A review or image wait uses
a completion event or a bounded read. It does not repeat an expensive gate.

## Catalog

| Skill                      | Start                                    | End                                            |
| -------------------------- | ---------------------------------------- | ---------------------------------------------- |
| `prepare-change`           | Core task or resume                      | Saved owner, context, scope, and phase         |
| `design-change`            | Architectural choice                     | Accepted record and linked work                |
| `build-change`             | Prepared approved change                 | Code and focused tests                         |
| `prove-change`             | Clean source                             | Exact input proof and screen evidence          |
| `test-application`         | Browser check request                    | Observed local application and screenshots     |
| `review-change`            | Current proof or review findings         | Final head review and resolved threads         |
| `land-change`              | Reviewed head and landing scope          | Read back exact merged source                  |
| `release-core`             | Explicit release or release resume       | Fixed tag, image, assets, notes, and milestone |
| `setup-project`            | Named new target                         | Ready contributor worktree or host             |
| `operate-host`             | Named host check or backup               | Health or verified archive evidence            |
| `recover-host`             | Named verified archive and empty target  | Proved restored target                         |
| `maintain-project`         | Named maintenance scope                  | Checked change through normal units            |
| `manage-host-credentials`  | Named credential operation and consumers | Verified replacement and revoke state          |
| `retire-host`              | Explicit named retirement                | Stopped service and stated retained data       |
| `cleaning-up-after-a-task` | Owner invokes this exact skill           | Owner machine cleanup                          |

The skill sources live in `.agents/skills/`. `.claude/skills/` links each source.
The cleanup skill remains owner-only. No unit invokes it.

## Context and ownership

`tools/task-prepare.mjs` saves the public context and the current actual diff.
A repeated task keeps its saved phase and paths when the caller omits them.
It keeps user context, dependencies, and remaining work. The explicit context
command refreshes the current commit and guide inputs. Internal resume leaves
omitted phase and paths to the private owner. This context grants no new permission.
`tools/agent-context.mjs` covers wire, domain, storage, migration, configuration,
and image effects. Its conservative impact result means read the operator guide
and state the consumer effect. It does not claim every flagged change breaks it.
Optional consumer context adds a guide when present. Standalone work passes
without it. Explicit internal work requires its private owner and sends context
there. Private guide contents never enter a public archive.

## Proof and review

`tools/lifecycle-state.mjs` binds a clean commit, tree, repository, environment
hash, runtime, package manager, and gate definitions. `tools/lifecycle.mjs` owns
canonical proof, saved logs, PR bodies, live review reads, and exact landing.
A local receipt is a same-user cache. It is not an external attestation. A
partial receipt, missing log, changed log, changed input, or failed command
cannot permit landing. A gate must leave the checked inputs unchanged.
Image proof builds an archive of the checked commit for `linux/amd64` and tests
that image.

The PR states the result, proof, public compatibility effect, reviewed release
type and note, and light and dark screen evidence. Screenshots go through
`tools/pr-screenshots.mjs`. For a known automatic review integration, `--auto-review-on-ready` uses the
new PR trigger once. A changed head on an existing ready PR uses one manual
request. A saved automatic intent survives a lost PR creation response.
Codex completion must belong to the final head.
Every thread must be resolved. All observed checks must pass. A fast-forward
push of the exact head refuses unseen main work. A rejected push never grants
permission to bypass protection. The merged commit and tree must match proved source. A saved validated write
attempt permits recovery of a successful push whose result was lost. A dry run
keeps that attempt unchanged.

## Release and consumers

`tools/release.mjs` owns the explicit release chain and shared worktree lock.
It derives notes and the version from merged PR metadata. The strongest release
type wins. A mixed feature and fix takes the feature step. Before stability, a
breaking change takes the next minor step. The command saves each stage.
The prepare commit and date stay fixed even when later work lands on main.
The command publishes the exact local image that passes the image gate.
It reads the registry before a retry and refuses a different image.

`tools/release-check.mjs` proves the before and after chain. The after gate reads
the cryptographic tag result, immutable version digest, and image
revision for the exact source commit. A later latest alias does not invalidate that release.
`tools/release-manifest.mjs` validates the public asset. The release publishes
its manifest and operator contract. It reads both exact asset byte streams before the next write. The after gate
compares the assets with the fixed source, image, operator, migration, and proof.
Migration and operator digests bind source. Historical checks read the tagged
Git source and original public proof metadata. They need no current machine
receipt. Saved publication digests also hold the original asset bytes.
GitHub attestation is not a release requirement.
A consumer reads the published digest. It never rebuilds a released artifact.

A legacy release has no new manifest. A consumer keeps its existing pin under
its existing verification policy. Moving to this lifecycle requires a new
release with the manifest and exact published image. A missing legacy asset is not filled
with invented proof. The lifecycle change takes a feature release classification.

## Host procedures

Existing tools in `tools/ops/` own host checks, backup, archive verification,
and restore. Restore targets are empty and name the same installation identity.
No lifecycle unit clears live data to make recovery pass. Credentials stay in
protected files. Machine cleanup stays outside the task lifecycle.
