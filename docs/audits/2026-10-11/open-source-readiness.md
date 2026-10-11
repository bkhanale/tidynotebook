# Open source readiness

Date: 2026-10-11
Commit: `d45bcc03c1d910f495d689d76e994a3a7d4434fa`

The repository needs more work before public launch. The accepted license and
contribution model are already in place. The main gaps are the public setup
path, dependency findings, retained notices, and the review of material that
becomes public. [Plan 021](../../plans/021-open-source-readiness.md) tracks the
work. This audit does not grant a release, deploy or visibility change.

## Scope and method

The inventory covers all 2,152 tracked files and all 16 workspace manifests.
The source boundary check reads 1,106 source files. The review reads each
package guide and the main authentication, operator, rendering, logging,
storage and delivery boundaries. It also reads the build, test, Compose,
contribution and release paths. It does not claim a manual security review of
every line.

The dependency audit reads the lockfile. The license inventory reads the
installed Linux dependency tree. Other optional platforms still need review
in the release artifact check. The secret scan uses Gitleaks with redaction
and all local refs, including tags and the screenshot branch. The remote
metadata scan reads issue bodies, PR bodies and issue comments through the
GitHub API. Scanner output and downloaded metadata stay in the ignored
`.tooling/` directory. They are not public evidence files.

## Requirements and sources

An open source release needs an approved license, the right to release the
work, the required notices of borrowed work, and access to the source. A
usable public project also needs setup instructions, a contribution path, a
private security contact, a maintainer and safe repository controls. The
[Open Source Guides checklist](https://opensource.guide/starting-a-project/)
covers the project files, history and maintainer duties.

GitHub states that a visibility change exposes the source and Actions
history. Review those records before the change. See
[repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).
Private vulnerability reporting is a public repository setting. See
[private reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## Findings

### OS-1. The public setup path and the image CI job fail

`docs/guide/quickstart.md:16` writes the origin but omits the three required
host directories. `docker-compose.yml:30` requires the database directory.
It also requires the storage and secret directories. The quick start states
that those directories have defaults. They do not. Its clone address is a
placeholder. Its stop text also implies that the volume option removes bind
mounted data, which it does not.

`.github/workflows/ci.yml:93` supplies a secret directory for the image job,
but supplies no database or storage directory. Its Compose config step fails
before the image build. A source gate pass alone cannot prove that job.

Required result: the documented commands and the CI settings produce valid
Compose configuration with isolated data paths. A regression test must run
those configuration inputs against the actual Compose file.

### OS-2. Current documents describe retired behavior

`README.md:46` states that there is one user and no invitation.
`SECURITY.md:47` describes a single-user boundary. The current registration,
invitation and account rules are in `packages/core/src/identity/` and
`apps/server/src/auth/`. `tests/integration/row-access.test.ts` proves account
isolation. `docs/development/architecture.md:3` also describes one person and
points at superseded save and Trash records.

`docs/guide/security-model.md:76` states that an external image needs an
explicit action. `packages/markdown/src/policy.ts:180` permits HTTPS images
to load, as record 0067 requires. The guide also omits personal API keys.
`apps/server/src/auth/actor.ts` resolves both credentials.

Required result: the current documents state the actual account, save,
credential and external image behavior. Keep historical records intact.

### OS-3. Public community files are incomplete

The repository has `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`
and a tested DCO check. It has no code of conduct, issue template or PR
template. GitHub reports those files as absent. The security fallback tells
the reader to find contact details on a profile. A direct private contact is
clearer. The public owner profile supplies a contact address.

Required result: add the missing files, name the maintainer role, and keep
security reports out of the public issue path. Do not promise a response time
that the owner has not accepted.

### OS-4. The lockfile contains dependency findings

The initial audit reports 15 advisories: 5 high, 7 moderate and 3 low. The
affected packages are esbuild, lodash-es, js-yaml, fast-uri, ip-address,
DOMPurify, KaTeX and source-map-js. The dependency paths reach the web
diagram build, the contract generator, Fastify, the rate limiter and build
tools. The initial direct KaTeX pin is fixed; older transitive copies remain.

Required result: update compatible versions and prove their consumers. The
template import and YAML merge refusals need tests against the installed
packages. Review each finding that a compatible update cannot close. An
audit severity does not by itself prove a reachable attack.

The esbuild advisory requires its development server. The KaTeX advisory
requires existing prototype pollution. The repository does not call the
esbuild server API, and its math renderer sets trust off. These facts narrow
the review; they do not grant an exception or prove every transitive caller.
See the [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
and [KaTeX advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7).

### OS-5. Artifact license coverage is not proved

`tools/license.test.mjs` proves the exact GNU license text and the license
fields of the manifests and contracts. Record 0188 states that the owner
holds the existing copyrights and selects AGPL-3.0-only with DCO sign-offs.
There is no need to choose a different core license.

`packages/ui/THIRD_PARTY_LICENSES.md:80` names the copied palettes and their
licenses, but does not retain each full notice. `Dockerfile:55` copies the
server and web output without an explicit copy of the root license.
`apps/web/vite.config.ts:432` has no license inventory output setting. Check
the actual shipped bytes before a claim that all notices survive bundling.

The installed graph includes EPL, MPL and LGPL components. Verify whether
each one ships, its exact terms, its source provision and its compatibility.
Do not label the whole graph compatible from SPDX names alone. See the
[Eclipse license FAQ](https://www.eclipse.org/legal/faq/).

The unknown license metadata of khroma is a metadata defect: its installed
`license` file contains the MIT text and copyright notice. The six font
files retain copyright and OFL metadata. The
[OFL FAQ](https://openfontlicense.org/ofl-faq/) permits license information in
font metadata. A plain notice file can still help the recipient.

### OS-6. Secret checks pass after test-value classification, with limits

The all-ref scan reports 1,472 matches in eight test files. They reduce to
nine fixed literals. Each occurrence is checked against its historical source
line. They are test secrets, test digest strings or protocol test values.
No reported match is a production credential. No committed environment,
private key, database or backup file appears in the current tracked inventory.

The remote scan finds no secret match in issue, PR or issue-comment text.
It does not read PR review comments, downloaded attachments, old Actions
logs, image pixels or registry layers. The screenshot branch has 244 files.
A secret scanner does not establish whether those images contain private
content. Review them before visibility changes. Keep the branch and signed
tags under the current rules.

The accepted core design includes cloud planning records. Decide which
historical business and operator facts the owner accepts as public. Do not
copy any private repository content into this review.

### OS-7. Public GitHub and distribution controls are incomplete

GitHub marks the source repository and its core container package private.
The main branch is present, Actions has read-only default permissions, and
workflows pin their actions by full commit. The DCO target workflow reads
the base script and never runs PR code with target permissions.

Secret scanning and Dependabot alerts are off. The private reporting read
answers not found. Branch protection and ruleset reads answer that the
current private plan does not support the feature. The alerts API also names
a missing administration scope. These answers are not proof of a safe public
configuration. Configure and read back the available controls at launch.

The project board is private and includes cloud work. Contributors need a
clear public issue path. A second prioritized list would conflict with record 0027. Keep one list unless a new decision changes it. Any public board view
must exclude private cloud material.

The artifact API currently lists no Actions artifacts. Old logs, release
assets, source archives, container layers and attached images still need
review. The public image must have a usable corresponding source path.

## What is already in place

- An accepted OSI license and a tested agreement across the root text,
  manifests and contracts.
- A contribution guide, a changelog and a security policy.
- A DCO check with tests and a base-only target workflow.
- Generated request and response contracts, package boundary checks,
  sanitizers, row access tests, account isolation tests and operator tests.
- Exact dependency and action pins, a lockfile, reviewed build-script policy,
  non-root application image, loopback defaults, backups and restore tools.
- A standalone core context path. The private consumer guide is optional.

These are useful controls. Public launch still needs proof of the exact final
source and image, plus completion of the open findings.
