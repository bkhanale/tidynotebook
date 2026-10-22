# Published images

This page is for the person who runs the server.

Use the official stable image for an installation. The current stable release
is 0.19.0. A digest fixes the image bytes, so a later pull cannot change them.
The public image and release manifest need no login.

## Supported platforms

- Release 0.19.0 supports `linux/amd64`.
- From the next stable release, the release workflow builds and tests native
  `linux/amd64` and `linux/arm64` images and publishes one image index.
- Existing tags and digests keep their current bytes. Release 0.19.0 does not
  gain an arm64 image.
- macOS and Windows need Docker with Linux containers. An ARM host needs
  amd64 emulation to run 0.19.0. Native Windows containers are not supported.

## Select the stable image

Start with the release checkout and a prepared `.env` from
[Quick start](quickstart.md) or [Self-hosting](self-hosting.md). Install `curl`
and `jq` on the host. Run these commands in the root of the clone, in Bash.
They also work with the operator scripts shipped in 0.19.0.

```bash
set -euo pipefail
tag=v0.19.0
commit="$(git rev-parse --verify "$tag^{commit}")"
test "$(git rev-parse HEAD)" = "$commit"
mkdir -p .tooling/published-release
release="https://github.com/tidynotebook/tidynotebook/releases/download/$tag"
curl --fail --silent --show-error --location \
  --connect-timeout 10 --max-time 60 \
  "$release/release-manifest.json" \
  --output .tooling/published-release/release-manifest.json
image="$(jq -ser --arg tag "$tag" --arg commit "$commit" '
  select(length == 1) | .[0]
  | select(.repository == "tidynotebook/tidynotebook"
    and .tag == $tag and .version == ($tag | ltrimstr("v"))
    and .source.commit == $commit
    and .image.reference == "ghcr.io/tidynotebook/core"
    and (.image.digest | type == "string" and length == 71
      and test("^sha256:[a-f0-9]{64}$")))
  | .image.reference + "@" + .image.digest
' .tooling/published-release/release-manifest.json)"
test -n "$image"
sed -i '/^NOTESAPP_IMAGE=/d' .env
printf 'NOTESAPP_IMAGE=%s\n' "$image" >> .env
```

The checks stop on a different repository, tag, version, source commit, image
name, or invalid digest. If a check fails, do not start the application.
Keep one `NOTESAPP_IMAGE` line in `.env`. Do not replace it with `latest` or
`main`. Neither tag fixes a stable release.

The selector shipped in 0.19.0 uses the GitHub CLI. Use the commands above for
an anonymous 0.19.0 installation. The next release will include an anonymous
`tools/ops/select-image.sh` that performs these checks and prints the image pin.

## Pull and start

```bash
docker compose pull app
docker compose up -d --no-build --wait
```

The primary install path does not build source. The settings, secret files,
and migrations use the same release checkout. Keep the manifest and image
pin with your installation records. Before an upgrade, make and verify a
backup. See [Upgrade](upgrade.md).

## Release maintenance

For each stable release, update the install example to its real source tag
and verify both install guides with its manifest and image digest. Test the
published platforms before changing the platform list. Never replace an
existing version tag or digest to add a platform.
