# Native advisory review

Date: 2026-10-13
Commit: `8d3736f516ad84266297966a3cc4bd5971eb5647`

This audit is for the owner. It reviews source paths and saved private image
security evidence. It records an engineering assessment. Owner acceptance of
launch risk and a scan of the final image remain pending.

## Scope and evidence

The source is the commit above. Its image is
`sha256:80ea6841c9f576964aa4c308446ce32f5d813ffee5571f38e9fe9f20c633ccf4`.
The saved scan is dated 2026-10-11. It reads the earlier image named by
`.tooling/final-security-review/final-security-receipt.json` in the
`open-source-final-readiness` worktree. That receipt names its source and image.
It is not a scan of the image above. This audit runs no scanner or image build.

The private evidence includes the full scanner report, the installed native
inventory, the retained Debian assessment and the native source review.
Raw reports remain outside source. Primary references below are read on this
audit date. Empty feeds and non-public reports remain coverage limits.

## Native image paths

`apps/server/src/jobs/inspect-image-worker.ts` blocks all foreign image
loaders before input selection. It permits only the file loaders for PNG,
JPEG, GIF and WebP. This follows the supported
[Sharp block and unblock interface](https://sharp.pixelplumbing.com/api-utility/).
Both attachment upload and archive import use this worker.

The retained libheif matches have upstream fixes in the
[security release](https://github.com/strukturag/libheif/releases/tag/v1.23.6).
The worker cannot select its HEIF loader. The saved source review also finds
that the reported codec and pixel conversion paths are absent or not called
by metadata inspection. These are path limits, not library patches.

The [libpng advisory](https://github.com/pnggroup/libpng/security/advisories/GHSA-qvg3-h654-xq3j)
requires `png_read_end`. The saved exact-source review finds no call to this
function in the libvips PNG reader. PNG remains an allowed format. Retain the
version match and this call-path limit in
[issue 332](https://github.com/tidynotebook/tidynotebook/issues/332).

The [Expat issue list](https://github.com/libexpat/libexpat/issues/1160)
contains unfixed non-public reports. Public evidence cannot establish their
severity or affected paths. Blocking SVG removes one possible input path.
It does not prove that all Expat use is safe.

## Worker limits

`apps/server/src/jobs/inspect-image.ts` starts a child process. The parent
limits its run time and output. The worker limits image pixels. It does not
have a separate native memory limit or a security sandbox. It inherits the
server user's access to its environment, files and network. A native defect
can use that access. A process boundary does not prove privilege isolation.

`Dockerfile` selects a non-root user and removes setuid and setgid permissions
from the mount tools. The saved image readback agrees. These limits do not
cover an operator who selects root or privileged container use.

## Scanner findings and supported fixes

The saved high and critical findings belong to Debian packages and the Go
runtime in the shipped schema-tool binary. The Node section has no such row.
Scan silence does not prove complete coverage of Node or custom native code.

The Debian critical zlib match maps to MiniZip code. The
[Debian tracker](https://security-tracker.debian.org/tracker/CVE-2023-45853)
states that Bookworm does not build the affected code in its zlib binary.
Final image proof must still exclude a separate affected MiniZip dependency.

The retained Debian high rows have no fixed Bookworm package in the current
tracker assessment. The [mount finding](https://security-tracker.debian.org/tracker/CVE-2026-53613)
retains that status. The saved assessment distinguishes absent programs,
operator utilities and installed libraries. It does not erase scanner rows.
The current GnuTLS trackers classify the reports as unimportant and state
that upstream does not treat them as security issues:
[hostname checks](https://security-tracker.debian.org/tracker/CVE-2026-88647)
and [certificate restrictions](https://security-tracker.debian.org/tracker/CVE-2026-88648).

The schema-tool graph and its Go findings remain in
[issue 331](https://github.com/tidynotebook/tidynotebook/issues/331).
A planned graph change is not proof that the final image removes that binary.
Its final deployed graph and image scan remain pending.

## Launch disposition remains pending

Keep issue 332 open for the next supported official native bundle. A custom
native build or unsupported override is not part of this assessment. The
final candidate needs current upstream review, actual image loader and
inventory proof, and a new scan. Preserve all retained findings and limits.

The owner must decide whether to accept the named retained native and Debian
findings for that exact image. The decision must name the loader and call-path
limits, the absence of a worker security sandbox, unknown native defect risk,
and separate exposure from privileged operator use. This audit records no
such acceptance. It does not permit release, deployment or visibility changes.
