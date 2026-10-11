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
[[ "$operator_release_tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
operator_release_commit="$(git rev-parse "$operator_release_tag^{commit}")"
test "$(git rev-parse HEAD)" = "$operator_release_commit"
operator_release_dir="$PWD/.tooling/published-release/$operator_release_tag"
mkdir -p "$operator_release_dir"
gh release download "$operator_release_tag" --repo tidynotebook/tidynotebook \
  --pattern release-manifest.json --dir "$operator_release_dir"
NOTESAPP_IMAGE="$(jq -ser --arg tag "$operator_release_tag" \
  --arg commit "$operator_release_commit" '
  select(length == 1) | .[0]
  | select(.repository == "tidynotebook/tidynotebook"
    and .tag == $tag and .version == ($tag | ltrimstr("v"))
    and .source.commit == $commit
    and .image.reference == "ghcr.io/tidynotebook/core"
    and (.image.digest | type == "string" and length == 71
      and test("^sha256:[a-f0-9]{64}$")))
  | .image.reference + "@" + .image.digest' \
  "$operator_release_dir/release-manifest.json")"
export NOTESAPP_IMAGE
printf 'NOTESAPP_IMAGE=%s\n' "$NOTESAPP_IMAGE"
```

The commands refuse an invalid tag or manifest and a different checkout.
Save the printed setting in the protected Compose environment file of this
installation. Replace its old `NOTESAPP_IMAGE` setting, or add it when absent.
Keep one such setting. Restrict file access to the operator. This keeps the
same digest for later shells. See the protected configuration section of
[Self-hosting](self-hosting.md#protected-configuration).

Then pull and start the fixed image:

```bash
docker compose pull app
docker compose up -d --no-build app
```

The digest fixes the selected image. Keep the same `NOTESAPP_IMAGE` for later
Compose commands of this installation. Do not replace it with a moving alias.
The HTTP contract, migration commands, and secret settings stay the same.
See [Configuration](configuration.md) for the installation settings.
