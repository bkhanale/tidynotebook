# Arm64 image compliance

Date: 2026-10-21

The [hosted image run](https://github.com/tidynotebook/tidynotebook/actions/runs/39601096557)
passed on `269b1cb695743e6a6b4755880a4438fcba1eea0c`. Native arm64 proof took
84 seconds. The parallel amd64 smoke took 138 seconds. Arm64 finished 52
seconds before amd64 and added no delay to Check. Scope start to Check finish
took 183 seconds. A prior cancelled run added 127 seconds of initial queue time.

The [reviewed-head run](https://github.com/tidynotebook/tidynotebook/actions/runs/39602080250)
passed Check on `d74084f5903e11c4c48ff1a8276bb8e77d4806b5`. Arm64 proof took
72 seconds and amd64 smoke took 142 seconds. Both image jobs passed.

Both targets use the same checked native and Debian source archives. The pinned
arm64 sharp package has the same full library version map as amd64. The original
Debian package and source versions also match. Only target package names differ.
The image checks verify both original and final Debian records, all bundled
source hashes, installed native versions and emitted notices. Unsupported
native targets and version mismatches fail. Image scope selects both jobs.

The local amd64 image was compared with output from main `1eb767429080ae2efd86ec42a993363112db5acd`.
Native, base and runner manifests, the original binary record, notice inventory,
combined notices, source directions, license and palette notices are byte-identical.
The PR holds the SHA-256 comparison and final check and review results.
