# Published images

This page is for the person who runs the server.

Use the official stable image for an installation. The shell commands below
select the release. A digest fixes the image bytes, so a later pull cannot
change them. The public image and release manifest need no login.

## Supported platforms

The selected release supports `linux/amd64`. It has no native arm64 image.
An ARM host needs amd64 emulation to run it. Existing tags and digests keep
their current bytes.

macOS needs Docker with Linux containers. On Windows, use WSL2 with Docker
Linux containers and the shell tools listed in the quick start. Native
Windows containers are not supported.

### Apple Silicon

In Docker Desktop **Settings**, open **General**. Select the Apple
Virtualization framework and enable **Use Rosetta for x86_64/amd64 emulation
on Apple Silicon**. Apply the settings and restart Docker Desktop. See
[Docker Desktop settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/).

Add this setting to the installation's `.env` file. Compose reads it for each
command, so you do not need to set it again in a new shell:

```bash
DOCKER_DEFAULT_PLATFORM=linux/amd64
```

This default applies to all services. On an ARM host, keep PostgreSQL native:
add this setting to the `postgres` service in `docker-compose.override.yml`.
Create that file if it does not exist. Keep any settings already in it.
Compose reads this override with `docker-compose.yml`.

```yaml
services:
  postgres:
    platform: linux/arm64
```

### ARM Linux

Install the amd64 QEMU executable handler on the Docker host, then select
the image platform:

```bash
docker run --privileged --rm \
  tonistiigi/binfmt@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0 \
  --install amd64
```

Add `DOCKER_DEFAULT_PLATFORM=linux/amd64` to the installation's `.env` file,
as in the Apple Silicon steps. Also add the PostgreSQL platform override from
those steps to keep the database native. The image selection commands below
keep the `.env` platform line.

The registration command registers the emulator on that host. See
[Docker's QEMU setup](https://docs.docker.com/build/building/multi-platform/#install-qemu-manually)
for host requirements. This registration does not survive a host reboot.
Run the registration command after each boot, before you start the app.

For persistent registration, install your Linux distribution's
`qemu-user-static` and `binfmt-support` packages. Enable their binfmt service
at boot and confirm that the amd64 handler is registered before Docker starts
the app. Package and service names can differ between distributions.

On either ARM platform, emulation can be slower than a native amd64 host.

## Select the stable image

Start with the release checkout and a prepared `.env` from
[Quick start](quickstart.md) or [Self-hosting](self-hosting.md). Install `curl`
and `jq` on the host. Run these commands in the root of the clone, in Bash.
The commands select the stable tag checked out in this folder. They also
work with the operator scripts shipped in that release. An upgrade first
checks out its new tag, as [Upgrade](upgrade.md) states.

```bash
(
  set -euo pipefail
  tag="$(git describe --tags --exact-match HEAD)"
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
  settings_file="$(mktemp .env.XXXXXX)"
  awk '!/^[[:space:]]*NOTESAPP_IMAGE[[:space:]]*=/' .env > "$settings_file"
  printf 'NOTESAPP_IMAGE=%s\n' "$image" >> "$settings_file"
  chmod 600 "$settings_file"
  mv "$settings_file" .env
)
```

The checks stop on a different repository, tag, version, source commit, image
name, or invalid digest. If a check fails, do not start the application.
Keep one `NOTESAPP_IMAGE` line in `.env`. Do not replace it with `latest` or
`main`. Neither tag fixes a stable release.

The current `tools/ops/select-image.sh` uses `curl` over HTTPS to download the
manifest and `jq` to check it. Older release checkouts can require the GitHub
CLI instead. The commands above work without a GitHub login in either case.

## Pull and start

```bash
docker compose pull app
docker compose up -d --no-build --wait
```

The primary install path does not build source. The settings, secret files,
and migrations use the same release checkout. Keep the manifest and image
pin with your installation records. Before an upgrade, make and verify a
backup. See [Upgrade](upgrade.md).
