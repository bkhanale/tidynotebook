#!/usr/bin/env bash
# Create one encrypted tidy notebook backup.
#
# The database part is consistent on its own: pg_dump reads one transaction
# snapshot. The attachment files are content addressed by their digest, so a
# file that the dump references is never rewritten in place. For a backup that
# is also consistent across the two parts, stop the application first with
# `docker compose stop app`.
set -euo pipefail

STORAGE_ROOT=""
BACKUP_ROOT=""
DATABASE_URL_FILE=""
KEY_FILE=""
INSTALLATION_ID_FILE=""
POSTGRES_CONTAINER=""

usage() {
  printf '%s\n' \
    'Usage: tools/ops/backup.sh --storage-root DIR --backup-root DIR' \
    '  --database-url-file FILE --key-file FILE --installation-id-file FILE' \
    '  [--postgres-container NAME]'
}

fail() {
  printf 'notesapp backup: %s\n' "$1" >&2
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
    --storage-root) STORAGE_ROOT="${2:-}"; shift 2 ;;
    --backup-root) BACKUP_ROOT="${2:-}"; shift 2 ;;
    --database-url-file) DATABASE_URL_FILE="${2:-}"; shift 2 ;;
    --key-file) KEY_FILE="${2:-}"; shift 2 ;;
    --installation-id-file) INSTALLATION_ID_FILE="${2:-}"; shift 2 ;;
    --postgres-container) POSTGRES_CONTAINER="${2:-}"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) usage >&2; fail "unknown option $1" ;;
  esac
done

[[ -n "$STORAGE_ROOT" && "$STORAGE_ROOT" == /* ]] || fail '--storage-root must be an absolute path.'
[[ -n "$BACKUP_ROOT" && "$BACKUP_ROOT" == /* ]] || fail '--backup-root must be an absolute path.'
[[ "$STORAGE_ROOT" != "$BACKUP_ROOT" ]] || fail 'the backup root must be separate from application storage.'
protected_file "$DATABASE_URL_FILE" '--database-url-file'
protected_file "$KEY_FILE" '--key-file'
protected_file "$INSTALLATION_ID_FILE" '--installation-id-file'
validate_backup_identity
command -v gpg >/dev/null 2>&1 || fail 'gpg is required.'
command -v tar >/dev/null 2>&1 || fail 'tar is required.'
command -v flock >/dev/null 2>&1 || fail 'flock is required.'
command -v sync >/dev/null 2>&1 || fail 'GNU coreutils sync 8.24 or later is required.'

DATABASE_URL="$(<"$DATABASE_URL_FILE")"
export NOTESAPP_OPS_DATABASE_URL="$DATABASE_URL"
INSTALLATION_HASH="$(sha256sum "$INSTALLATION_ID_FILE" | awk '{print $1}')"
[[ "$DATABASE_URL" == postgres://* || "$DATABASE_URL" == postgresql://* ]] || fail 'the database URL file is invalid.'

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

run_pg_dump() {
  if [[ -n "$POSTGRES_CONTAINER" ]]; then
    local url
    url="$(container_url)"
    printf '%s\n' "$url" | docker exec -i "$POSTGRES_CONTAINER" \
      sh -c 'IFS= read -r url; exec pg_dump "$url" --clean --if-exists --enable-row-security'
  else
    PGDATABASE="$DATABASE_URL" pg_dump --clean --if-exists --enable-row-security
  fi
}

mkdir -p "$STORAGE_ROOT" "$BACKUP_ROOT"
STORAGE_ROOT="$(realpath -m "$STORAGE_ROOT")"
BACKUP_ROOT="$(realpath -m "$BACKUP_ROOT")"
case "$BACKUP_ROOT/" in
  "$STORAGE_ROOT/"*) fail 'the backup root must not be inside application storage.' ;;
esac
case "$STORAGE_ROOT/" in
  "$BACKUP_ROOT/"*) fail 'application storage must not be inside the backup root.' ;;
esac
lock_directory() {
  local descriptor="$1" directory="$2" label="$3" status
  if flock --nonblock "$descriptor"; then
    return
  else
    status=$?
  fi
  if [[ "$status" == 1 ]]; then
    fail "another backup is using this $label root."
  fi
  fail "cannot lock $directory; the filesystem must support flock."
}

# Lock directory descriptors without creating files in app-writable storage.
umask 077
exec 8< "$STORAGE_ROOT"
lock_directory 8 "$STORAGE_ROOT" storage
exec 9< "$BACKUP_ROOT"
lock_directory 9 "$BACKUP_ROOT" backup
find "$STORAGE_ROOT" -mindepth 1 -maxdepth 1 -type d -name '.backup-stage.*' -exec rm -rf -- {} +
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type f -name 'backup-*.tar.gpg.partial' -delete

ARCHIVE_TIMESTAMP="$(date -u +%Y%m%d-%H%M%SZ)"
ARCHIVE_FILE="$BACKUP_ROOT/backup-$ARCHIVE_TIMESTAMP.tar.gpg"
PARTIAL_FILE="$ARCHIVE_FILE.partial"
[[ ! -e "$PARTIAL_FILE" ]] || fail "backup output already exists: $PARTIAL_FILE"
[[ ! -e "$ARCHIVE_FILE" ]] || fail "backup output already exists: $ARCHIVE_FILE"
STAGE_DIR="$(mktemp -d "$STORAGE_ROOT/.backup-stage.XXXXXX")"
CONTENT_DIR="$STAGE_DIR/content"
mkdir -p "$CONTENT_DIR/storage"

cleanup() {
  local status=$?
  rm -rf "$STAGE_DIR"
  rm -f "$PARTIAL_FILE"
  exit "$status"
}
trap cleanup EXIT INT TERM

run_psql --tuples-only --no-align --field-separator=$'\t' --command="
  SELECT DISTINCT ao.workspace_id::text, ao.digest, ao.size::text
  FROM public.attachment_objects ao
  JOIN public.contents c
    ON c.workspace_id = ao.workspace_id AND c.object_id = ao.id
  WHERE ao.state = 'finalized'
  ORDER BY ao.workspace_id::text, ao.digest
" > "$STAGE_DIR/referenced.tsv"

run_pg_dump > "$CONTENT_DIR/database.sql"
[[ -s "$CONTENT_DIR/database.sql" ]] || fail 'pg_dump produced an empty database file.'

NOTESAPP_STORAGE_ROOT="$STORAGE_ROOT" \
NOTESAPP_CONTENT_DIR="$CONTENT_DIR" \
NOTESAPP_ROWS_PATH="$STAGE_DIR/referenced.tsv" \
NOTESAPP_INSTALLATION_HASH="$INSTALLATION_HASH" \
node --input-type=module -e "
  import crypto from 'node:crypto';
  import fs from 'node:fs';
  import path from 'node:path';
  const storageRoot = process.env.NOTESAPP_STORAGE_ROOT;
  const contentDir = process.env.NOTESAPP_CONTENT_DIR;
  const rows = fs.readFileSync(process.env.NOTESAPP_ROWS_PATH, 'utf8').split('\n').filter(Boolean);
  const objects = [];
  for (const row of rows) {
    const [workspaceId, digest, sizeText] = row.split('\t');
    if (!/^[0-9a-f-]{36}$/.test(workspaceId) || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error('The database returned an invalid attachment identity.');
    }
    const relative = path.join('workspaces', workspaceId, 'attachments', digest);
    const source = path.join(storageRoot, relative);
    const target = path.join(contentDir, 'storage', relative);
    const bytes = fs.readFileSync(source);
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actual !== digest || bytes.length !== Number(sizeText)) {
      throw new Error('A referenced attachment does not match its database digest or size.');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    objects.push({ path: relative, sha256: actual, size: bytes.length });
  }
  const database = fs.readFileSync(path.join(contentDir, 'database.sql'));
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    installationHash: process.env.NOTESAPP_INSTALLATION_HASH,
    database: {
      file: 'database.sql',
      sha256: crypto.createHash('sha256').update(database).digest('hex'),
      size: database.length
    },
    objects
  };
  fs.writeFileSync(path.join(contentDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
"

tar --format=posix -C "$CONTENT_DIR" -cf "$STAGE_DIR/backup.tar" .
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$KEY_FILE" \
  --symmetric --cipher-algo AES256 --output "$PARTIAL_FILE" "$STAGE_DIR/backup.tar"

"$(dirname "$0")/verify-backup.sh" \
  --backup-file "$PARTIAL_FILE" \
  --key-file "$KEY_FILE" \
  --installation-id-file "$INSTALLATION_ID_FILE"

sync -- "$PARTIAL_FILE"
mv -- "$PARTIAL_FILE" "$ARCHIVE_FILE"
sync -f -- "$BACKUP_ROOT"

NOTESAPP_BACKUP_ROOT="$BACKUP_ROOT" node --input-type=module -e "
  import fs from 'node:fs';
  import path from 'node:path';
  const root = process.env.NOTESAPP_BACKUP_ROOT;
  const files = fs.readdirSync(root)
    .filter((name) => /^backup-[0-9]{8}-[0-9]{6}Z[.]tar[.]gpg$/.test(name))
    .sort().reverse();
  const keep = new Set();
  const days = new Set();
  const weeks = new Set();
  const weekKey = (date) => {
    const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
    return value.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
  };
  for (const name of files) {
    const match = /^backup-([0-9]{4})([0-9]{2})([0-9]{2})-/.exec(name);
    if (!match) continue;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const day = name.slice(7, 15);
    const week = weekKey(date);
    if (days.size < 7 && !days.has(day)) {
      days.add(day);
      keep.add(name);
    }
    if (weeks.size < 4 && !weeks.has(week)) {
      weeks.add(week);
      keep.add(name);
    }
  }
  for (const name of files) {
    if (!keep.has(name)) fs.rmSync(path.join(root, name));
  }
"

trap - EXIT INT TERM
rm -rf "$STAGE_DIR"
printf 'Backup completed successfully: %s\n' "$ARCHIVE_FILE"
