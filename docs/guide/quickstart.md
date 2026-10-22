# Quick start

This page is for the person who runs the server.

Run the stable release on your own machine with Docker Compose. You do not
need a GitHub account, a registry login, Node.js, or a source build.

This is a test installation. It keeps data inside the clone and serves only
your own machine. Use [Self-hosting](self-hosting.md) before you store data
that you need to keep.

## What you need

- Docker Engine and Docker Compose v2.
- Git, Bash, `curl`, `jq`, `openssl`, and `sudo`.
- A new clone. The setup script refuses an existing `.env` file.
- A Linux `amd64` host for release 0.19.0. On macOS or Windows, use Docker
  with Linux containers. An ARM host needs amd64 emulation for this release.
  See [Supported platforms](published-images.md#supported-platforms).

## 1. Get the release files

Use the public stable tag. The clone provides Compose files and operator
scripts that match the image.

```bash
git clone --branch v0.19.0 --depth 1 \
  https://github.com/tidynotebook/tidynotebook.git notesapp
cd notesapp
```

Run the remaining commands in this folder.

## 2. Prepare the test installation

```bash
tools/ops/quickstart.sh
```

The script asks for `sudo` to create secret files and set the attachment
folder owner. It writes `.env` and creates database, attachment, and secret
folders under `.tooling/quickstart`. Git ignores these files.

## 3. Select and start the stable image

Complete [Select the stable image](published-images.md#select-the-stable-image).
That step checks the public release manifest and writes the exact image digest
to `.env`. Stop if the check fails.

Then download and start the image:

```bash
docker compose pull app
docker compose up -d --no-build --wait
docker compose ps
```

Compose starts PostgreSQL first. The application updates the database and
then starts the server. To check readiness:

```bash
curl --fail http://127.0.0.1:3000/ready
```

The answer starts with `{"status":"ok"`. If startup fails, read the log:

```bash
docker compose logs app
```

## 4. Open the application

Open `http://127.0.0.1:3000`. Use this exact address. The default settings do
not serve the host name `localhost`.

Create the first account with an email address and a password. This account
is the administrator. Later visits show the sign-in page.

## Stop and remove

To stop the containers and keep the data:

```bash
docker compose down
```

To start again, use `docker compose up -d --no-build --wait`.

To remove this test installation, stop the containers first. Then remove its
data and settings:

```bash
sudo rm -rf .tooling/quickstart
rm .env
```

## Build from source

Contributors can build a chosen source checkout with `docker compose build`
and start it with `docker compose up -d --wait`. See
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the code setup and checks.

For a server that holds real data, use [Self-hosting](self-hosting.md).
