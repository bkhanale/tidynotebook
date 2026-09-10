#!/usr/bin/env bash
# Ensure that exactly one healthy disposable PostgreSQL service is available.
set -euo pipefail

project_name='notesapp-test'

# A reachable service is all that a test needs. CI starts the Compose service
# itself, so the script must do nothing in that case. This check also keeps the
# script quick when the local service is already up.
if (exec 3<>/dev/tcp/127.0.0.1/55432) 2>/dev/null; then
  printf '%s\n' 'notesapp test database: port 55432 already accepts connections.'
  exit 0
fi

if ! command -v docker > /dev/null 2>&1; then
  printf '%s\n' 'notesapp test database: no service on port 55432 and Docker is not installed.' >&2
  exit 1
fi

mapfile -t containers < <(
  docker ps \
    --filter 'publish=55432' \
    --filter "label=com.docker.compose.project=${project_name}" \
    --filter 'label=com.docker.compose.service=postgres' \
    --format '{{.ID}}'
)

if [[ ${#containers[@]} -gt 1 ]]; then
  printf '%s\n' 'notesapp test database: more than one matching container is running.' >&2
  exit 1
fi

if [[ ${#containers[@]} -eq 1 ]]; then
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${containers[0]}")"
  if [[ "$health" != 'healthy' && "$health" != 'running' ]]; then
    printf 'notesapp test database: the matching container is %s.\n' "$health" >&2
    exit 1
  fi
  printf 'notesapp test database: using healthy container %s.\n' "${containers[0]}"
  exit 0
fi

docker compose -p "$project_name" -f compose.test.yaml up -d --wait postgres
