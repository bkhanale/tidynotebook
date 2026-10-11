# Published images

This page is for the operator who uses an official release image with Compose.

Use this path when a future public release and its image are available.
The image package policy is in
[record 0220](../decisions/0220-future-releases-use-a-new-public-image.md).
The old package stays private. Its fixed releases and digests stay intact.
Until a public release exists, use [Quick start](quickstart.md) to build locally.

Set up the installation through [Self-hosting](self-hosting.md) first.
Before an upgrade, make and verify a backup through [Upgrade](upgrade.md).
You need the GitHub CLI and `jq` for the commands below.

Select one fixed release tag from the official repository releases.
Download its manifest. Read the image address and digest from that asset.
Future manifests select the core package. A local build still uses the
default image name in `docker-compose.yml`. `NOTESAPP_IMAGE` selects the published
image for these commands without a change to that local default.

Run the commands from the checkout of that fixed release. Use the same shell:

```bash
set -e
read -r -p 'Fixed release tag: ' operator_release_tag
test -n "$operator_release_tag"
operator_release_dir="$PWD/.tooling/published-release/$operator_release_tag"
mkdir -p "$operator_release_dir"
gh release download "$operator_release_tag" --repo tidynotebook/tidynotebook \
  --pattern release-manifest.json --dir "$operator_release_dir"
NOTESAPP_IMAGE="$(jq -er '.image.reference + "@" + .image.digest' \
  "$operator_release_dir/release-manifest.json")"
export NOTESAPP_IMAGE
docker compose pull app
docker compose up -d --no-build app
```

The digest fixes the selected image. Keep the same `NOTESAPP_IMAGE` for later
Compose commands of this installation. Do not replace it with a moving alias.
The HTTP contract, migration commands, and secret settings stay the same.
See [Configuration](configuration.md) for the installation settings.
