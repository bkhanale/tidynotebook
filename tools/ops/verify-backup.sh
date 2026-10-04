#!/usr/bin/env bash
# Verify one encrypted tidy notebook backup without restoring it.
set -euo pipefail

BACKUP_FILE=""
KEY_FILE=""
INSTALLATION_ID_FILE=""

fail() {
  printf 'notesapp backup verification: %s\n' "$1" >&2
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
    --key-file) KEY_FILE="${2:-}"; shift 2 ;;
    --installation-id-file) INSTALLATION_ID_FILE="${2:-}"; shift 2 ;;
    --help)
      printf '%s\n' 'Usage: tools/ops/verify-backup.sh --backup-file FILE --key-file FILE --installation-id-file FILE'
      exit 0
      ;;
    *) fail "unknown option $1" ;;
  esac
done

[[ -f "$BACKUP_FILE" && -s "$BACKUP_FILE" ]] || fail '--backup-file must name a nonempty archive.'
protected_file "$KEY_FILE" '--key-file'
protected_file "$INSTALLATION_ID_FILE" '--installation-id-file'
validate_backup_identity
command -v gpg >/dev/null 2>&1 || fail 'gpg is required.'
command -v tar >/dev/null 2>&1 || fail 'tar is required.'

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$KEY_FILE" \
  --decrypt --output "$TEMP_DIR/backup.tar" "$BACKUP_FILE"

tar -tf "$TEMP_DIR/backup.tar" > "$TEMP_DIR/names.txt"
if awk '
  /^\// { exit 1 }
  {
    count = split($0, parts, "/")
    for (i = 1; i <= count; i += 1) {
      if (parts[i] == "..") exit 1
    }
  }
' "$TEMP_DIR/names.txt"; then :; else
  fail 'the archive contains an unsafe path.'
fi
tar -tvf "$TEMP_DIR/backup.tar" > "$TEMP_DIR/listing.txt"
if awk '$1 !~ /^[-d]/ { exit 1 }' "$TEMP_DIR/listing.txt"; then :; else
  fail 'the archive contains a link or special file.'
fi
tar --no-same-owner --no-same-permissions -C "$TEMP_DIR" -xf "$TEMP_DIR/backup.tar"

INSTALLATION_HASH="$(sha256sum "$INSTALLATION_ID_FILE" | awk '{print $1}')"
NOTESAPP_VERIFY_ROOT="$TEMP_DIR" \
NOTESAPP_INSTALLATION_HASH="$INSTALLATION_HASH" \
node --input-type=module -e "
  import crypto from 'node:crypto';
  import fs from 'node:fs';
  import path from 'node:path';
  const root = process.env.NOTESAPP_VERIFY_ROOT;
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 1 || manifest.installationHash !== process.env.NOTESAPP_INSTALLATION_HASH) {
    throw new Error('The backup identity or format does not match this installation.');
  }
  if (!manifest.database || !Array.isArray(manifest.objects)) {
    throw new Error('The backup manifest is incomplete.');
  }
  const verify = (file, expectedHash, expectedSize) => {
    const bytes = fs.readFileSync(file);
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actual !== expectedHash || bytes.length !== expectedSize) {
      throw new Error('A backup file does not match its manifest digest or size.');
    }
  };
  if (manifest.database.file !== 'database.sql') throw new Error('The database file name is invalid.');
  verify(path.join(root, 'database.sql'), manifest.database.sha256, manifest.database.size);
  const listed = new Set();
  for (const object of manifest.objects) {
    if (!/^workspaces\/[0-9a-f-]{36}\/attachments\/[0-9a-f]{64}$/.test(object.path)) {
      throw new Error('An attachment path is invalid.');
    }
    if (listed.has(object.path)) throw new Error('The manifest repeats an attachment path.');
    listed.add(object.path);
    verify(path.join(root, 'storage', object.path), object.sha256, object.size);
  }
  const actual = [];
  const storage = path.join(root, 'storage');
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) actual.push(path.relative(storage, child));
      else throw new Error('Backup storage contains a special file.');
    }
  };
  walk(storage);
  if (actual.length !== listed.size || actual.some((item) => !listed.has(item))) {
    throw new Error('Backup storage and its manifest do not contain the same objects.');
  }
"

printf 'Verification passed: %s is intact and belongs to this installation.\n' "$BACKUP_FILE"
