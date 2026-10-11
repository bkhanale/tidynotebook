# Distribution licenses and source

Date: 2026-10-11
Commit: `244e666686ee50cf72c7bedbee14ea30d5978da9`

This review covers the corrected runner, web app and documentation outputs.
It records the source duties of the pinned inputs. It does not grant a release
or a visibility change. It does not clear future dependency changes.

## Scope and terms

[Record 0219](../../decisions/0219-distributions-carry-notices-and-compatible-diagram-layouts.md)
holds the distribution choice. [Record 0220](../../decisions/0220-future-releases-use-a-new-public-image.md)
keeps old images private and selects a new package for corrected public images.
The source repository and its exact release source must be public at launch.
This audit does not prove that public access before launch.

The core uses the [AGPL terms](https://www.gnu.org/licenses/agpl-3.0.html).
The runner carries `LICENSE` and preferred source from the build inputs in
`Dockerfile`. Its source archive keeps the workspace, lockfile, patches,
server and web source, fonts, image recipes and build tools. Source and image
checks must agree on the source head. Release inputs can change image bytes.
The rebuild check does not promise identical image bytes.

## Browser and package notices

`tools/distribution-notices.mjs` reads the installed production package graph.
It retains available full license, copyright and notice files. Its inventory
states that unused packages can appear. Missing notices stop the build.
`tools/third-party/fallbacks.json` binds each reviewed fallback to the package
version, source repository and stated license. `tools/third-party/sources.json`
records its upstream source and local notice hash.

The npm agent fallback keeps the ISC declaration and author from the
[fixed upstream package manifest](https://raw.githubusercontent.com/npm/agent/db7852869c74ceb8985d7c36b291a2e7a866741c/package.json).
Its package and source tree have no separate copyright notice. The notice
adds no copyright holder or date. [npm's license field](https://docs.npmjs.com/files/package.json/#license)
states the package terms. The [ISC text](https://spdx.org/licenses/ISC.html)
holds its permission and disclaimer.

The Mermaid patch removes only the ELK layout loader. The inspected ELK copy
states EPL and has no identified secondary license grant. The [EPL terms](https://www.eclipse.org/legal/epl/epl-v20.html)
require that grant for the secondary license choice. A copy of the license
alone does not supply it.
All diagram types remain. ELK requests take the standard layout. The guide
states that node placement can change. The narrow choice avoids a claim that
all EPL code conflicts with AGPL.

DOMPurify offers Apache terms as a separate license choice. Full package
terms remain with the output. Font and palette notices retain their upstream
terms and copyright. Font metadata and `tools/third-party/geist.txt` carry the
OFL notice. The build retains the vendored font files.

## Runner source

`tools/native-sources.json` matches the deployed sharp consumer and its target.
It keeps source archives, patches and upstream build scripts for the bundled
native libraries. The full locked librsvg crate source graph travels with
that source. Original archives retain their own terms and copyright files.
The shared library stays replaceable. The [LGPL terms](https://www.gnu.org/licenses/lgpl-3.0.html)
remain with the library. The source notice permits debug work on changes.

`tools/base-sources.json` binds Debian source packages to the pinned base.
The runner retains each signed source descriptor and its source archives.
`tools/third-party/debian-source-signatures.json` records the checked signer
keys. The image test verifies signatures, archive sizes and hashes, and
matches the final installed inventory to the original base plus only the
fixed security package delta in `tools/runner-sources.json`.
`tools/base-packages.json` preserves the original binary inventory.
`tools/third-party/runner-source-signatures.json` records the added source
signatures. The original base record and source remain unchanged.
Debian copyright notices remain in the image.

The base manifest also binds Node source, signed release sums and official
image recipe source. The runner test checks the release signature, installed
Node, Node's full bundled notices, and the original npm source in the Node
archive. Original base layer npm has a separate full notice inventory. The
active runner removes unused npm and npx files. The builder keeps its tools.
This removal does not remove those bytes from immutable lower layers. The
test also checks active files outside the Debian package inventory. It
refuses an unrecorded tool there. Node version and source agreement are
separate checks. The image scanner does not inventory the bare Node binary.
Its package scan alone does not prove the security of Node.

The active runner clears the setuid and setgid bits on mount and umount.
This removes the recorded elevation precondition. It does not fix util-linux
source or remove its finding. The image check also holds the default nonroot
user, root-owned tools and the absence of the system mount capability.
Custom root or privileged use remains outside that proof.

## Documentation search source

The Pagefind search Wasm uses GPL code. Its npm root MIT notice does not cover
that program alone. The [GPL terms](https://www.gnu.org/licenses/gpl-3.0.html)
travel with the served program. `tools/pagefind-sources.json` keeps the exact
Pagefind source and build scripts, locked Wasm crate source, and original
Snowball algorithm source. The output includes source hashes and build
instructions. Source access applies to the search program separately from
the first-party guide generator.

The recorded generic and English source builds run offline with the unchanged
Wasm crate lock. Both rebuilt programs load actual guide indexes and find the
quick start page. The English build also finds the backup guide. The tested
compiler and build inputs are named in the emitted source instructions.
`tools/third-party/rust-runtime/` retains full linked Rust notices. Its
inventory marks the compiled crates. No linked standard library copyleft
crate is found in this recorded build. The compiler standard library is a
general system build input. This finding does not cover another compiler or
build target.

## Checks and result record

`tools/distribution-notices.test.mjs` checks fail-closed notices, safe source
rows, the active native consumer, pinned base inputs and the installed layout
registry. `tests/integration/distribution-notices.test.ts` checks actual built
notices and source hashes. It requests full notices and GPL source files from
the served output. It also checks the served guide rule and excludes ELK code
from scripts, maps and inline frame HTML.

`tests/image/distribution-notices.test.ts` checks the actual runner inventory,
terms, signed source and source hashes. It unpacks the first-party source and
rebuilds the image builder target. These paths state the acceptance checks;
their presence alone does not state a pass.

The PR that adds this audit carries the final exact-head source and image
validation receipts and CI check results. Those records bind completed proof
to the combined source head. The PR also carries light and dark screenshots
of the served layout and guide. Raw download, signature, compiler and runtime
reports stay private. Public source access remains a separate launch check.
