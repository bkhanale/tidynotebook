#!/usr/bin/env bash
# Restore one encrypted tidy notebook backup into an empty target.
set -euo pipefail

BACKUP_FILE=""
STORAGE_ROOT=""
DATABASE_URL_FILE=""
KEY_FILE=""
INSTALLATION_ID_FILE=""
POSTGRES_CONTAINER=""
OBJECT_STORE_CONFIG_FILE=""
OBJECTS_TOOL="$(cd "$(dirname "$0")/.." && pwd)/backup-objects.mjs"

usage() {
  printf '%s\n' \
    'Usage: tools/ops/restore.sh --backup-file FILE --storage-root DIR' \
    '  --database-url-file FILE --key-file FILE --installation-id-file FILE' \
    '  [--postgres-container NAME] [--object-store-config-file FILE]'
}

fail() {
  printf 'notesapp restore: %s\n' "$1" >&2
  exit 1
}

protected_file() {
  local path="$1"
  local label="$2"
  [[ -f "$path" && -s "$path" ]] || fail "$label must name a nonempty regular file."
  local mode
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & 077) == 0 )) || fail "$label must not be readable or writable by group or other users."
}

validate_backup_identity() {
  (( $(wc -c < "$KEY_FILE") >= 32 )) || fail '--key-file must contain at least 32 bytes.'
  local installation_id
  installation_id="$(<"$INSTALLATION_ID_FILE")"
  [[ "$installation_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] || \
    fail '--installation-id-file must contain one UUID.'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-file) BACKUP_FILE="${2:-}"; shift 2 ;;
    --storage-root) STORAGE_ROOT="${2:-}"; shift 2 ;;
    --database-url-file) DATABASE_URL_FILE="${2:-}"; shift 2 ;;
    --key-file) KEY_FILE="${2:-}"; shift 2 ;;
    --installation-id-file) INSTALLATION_ID_FILE="${2:-}"; shift 2 ;;
    --postgres-container) POSTGRES_CONTAINER="${2:-}"; shift 2 ;;
    --object-store-config-file) OBJECT_STORE_CONFIG_FILE="${2:-}"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) usage >&2; fail "unknown option $1" ;;
  esac
done

[[ -f "$BACKUP_FILE" && -s "$BACKUP_FILE" ]] || fail '--backup-file must name a nonempty archive.'
[[ -n "$STORAGE_ROOT" && "$STORAGE_ROOT" == /* ]] || fail '--storage-root must be an absolute path.'
protected_file "$DATABASE_URL_FILE" '--database-url-file'
protected_file "$KEY_FILE" '--key-file'
protected_file "$INSTALLATION_ID_FILE" '--installation-id-file'
validate_backup_identity
if [[ -n "$OBJECT_STORE_CONFIG_FILE" ]]; then
  protected_file "$OBJECT_STORE_CONFIG_FILE" '--object-store-config-file'
fi
export NOTESAPP_OBJECT_STORE_CONFIG_FILE="$OBJECT_STORE_CONFIG_FILE"
DATABASE_URL="$(<"$DATABASE_URL_FILE")"
export NOTESAPP_OPS_DATABASE_URL="$DATABASE_URL"

if [[ -d "$STORAGE_ROOT" ]] && find "$STORAGE_ROOT" -mindepth 1 -print -quit | grep -q .; then
  fail 'the target storage root is not empty.'
fi

container_url() {
  node --input-type=module -e "
    const value = new URL(process.env.NOTESAPP_OPS_DATABASE_URL);
    value.hostname = '127.0.0.1';
    value.port = '5432';
    process.stdout.write(value.toString());
  "
}

run_psql() {
  if [[ -n "$POSTGRES_CONTAINER" ]]; then
    local url
    url="$(container_url)"
    printf '%s\n' "$url" | docker exec -i "$POSTGRES_CONTAINER" \
      sh -c 'IFS= read -r url; exec psql "$url" --no-psqlrc --set=ON_ERROR_STOP=1 "$@"' sh "$@"
  else
    PGDATABASE="$DATABASE_URL" psql --no-psqlrc --set=ON_ERROR_STOP=1 "$@"
  fi
}

restore_database() {
  if [[ -n "$POSTGRES_CONTAINER" ]]; then
    local url
    url="$(container_url)"
    { printf '%s\n' "$url"; cat "$TEMP_DIR/database.sql"; } | \
      docker exec -i "$POSTGRES_CONTAINER" \
        sh -c 'IFS= read -r url; exec psql "$url" --no-psqlrc --set=ON_ERROR_STOP=1'
  else
    PGDATABASE="$DATABASE_URL" psql --no-psqlrc --set=ON_ERROR_STOP=1 < "$TEMP_DIR/database.sql"
  fi
}

NOTESAPP_STORAGE_ROOT="$STORAGE_ROOT" node "$OBJECTS_TOOL" empty

has_workspace_table="$(run_psql --tuples-only --no-align --command="SELECT to_regclass('public.workspaces') IS NOT NULL")"
if [[ "$has_workspace_table" == 't' ]]; then
  workspace_count="$(run_psql --tuples-only --no-align --command='SELECT count(*) FROM public.workspaces')"
  [[ "$workspace_count" == '0' ]] || fail 'the target database is not empty.'
fi

"$(dirname "$0")/verify-backup.sh" \
  --backup-file "$BACKUP_FILE" \
  --key-file "$KEY_FILE" \
  --installation-id-file "$INSTALLATION_ID_FILE"

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$KEY_FILE" \
  --decrypt --output "$TEMP_DIR/backup.tar" "$BACKUP_FILE"
tar --no-same-owner --no-same-permissions -C "$TEMP_DIR" -xf "$TEMP_DIR/backup.tar"

restore_database >/dev/null
mkdir -p "$STORAGE_ROOT"
NOTESAPP_STORAGE_ROOT="$STORAGE_ROOT" \
NOTESAPP_CONTENT_DIR="$TEMP_DIR" \
node "$OBJECTS_TOOL" restore

run_psql --tuples-only --no-align --field-separator=$'\t' --command="
  SELECT DISTINCT ao.workspace_id::text, ao.digest, ao.size::text
  FROM public.attachment_objects ao
  JOIN public.contents c
    ON c.workspace_id = ao.workspace_id AND c.object_id = ao.id
  WHERE ao.state = 'finalized'
  ORDER BY ao.workspace_id::text, ao.digest
" > "$TEMP_DIR/restored.tsv"

NOTESAPP_STORAGE_ROOT="$STORAGE_ROOT" \
NOTESAPP_ROWS_PATH="$TEMP_DIR/restored.tsv" \
NOTESAPP_CONTENT_DIR="$TEMP_DIR" \
node "$OBJECTS_TOOL" verify

printf 'Restoration completed successfully from %s\n' "$BACKUP_FILE"
