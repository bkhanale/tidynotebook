#!/usr/bin/env bash
# Host storage encryption verification.
#
# Verifies that host storage locations for application data, database WAL,
# attachments, temporary files, swap, and crash outputs use disk encryption.
set -euo pipefail

STORAGE_DIR="${STORAGE_DIR:-/var/lib/notesapp}"
DB_DIR="${DB_DIR:-/var/lib/postgresql/data}"
WAL_DIR="${WAL_DIR:-$DB_DIR}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/notesapp}"
TEMP_DIR="${TEMP_DIR:-/tmp}"
CRASH_DIR="${CRASH_DIR:-/var/lib/systemd/coredump}"
ALLOW_SIMULATED="${ALLOW_SIMULATED:-false}"

print_usage() {
  cat << 'USAGE'
Usage: tools/ops/check-host.sh [OPTIONS]

Options:
  --storage-dir DIR   Path to attachment storage root (default: /var/lib/notesapp)
  --db-dir DIR        Path to database data directory (default: /var/lib/postgresql/data)
  --wal-dir DIR       Path to PostgreSQL WAL when it is separate from data
  --backup-dir DIR    Path to backup directory (default: /var/backups/notesapp)
  --temp-dir DIR      Path to temporary directory (default: /tmp)
  --crash-dir DIR     Path used for persistent crash output
  --allow-simulated   Accept simulated encryption marker for tests
  --help              Show this message
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --storage-dir)
      STORAGE_DIR="$2"
      shift 2
      ;;
    --db-dir)
      DB_DIR="$2"
      shift 2
      ;;
    --wal-dir)
      WAL_DIR="$2"
      shift 2
      ;;
    --backup-dir)
      BACKUP_DIR="$2"
      shift 2
      ;;
    --temp-dir)
      TEMP_DIR="$2"
      shift 2
      ;;
    --crash-dir)
      CRASH_DIR="$2"
      shift 2
      ;;
    --allow-simulated)
      ALLOW_SIMULATED="true"
      shift
      ;;
    --help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
done

ERRORS=0

check_device_encryption() {
  local target_label="$1"
  local target_path="$2"

  if [[ ! -e "$target_path" ]]; then
    # Directory does not exist yet; check its nearest existing parent
    local probe_path="$target_path"
    while [[ ! -d "$probe_path" && "$probe_path" != "/" ]]; do
      probe_path="$(dirname "$probe_path")"
    done
    target_path="$probe_path"
  fi

  # Check for test simulation marker if permitted
  if [[ "$ALLOW_SIMULATED" == "true" ]]; then
    if [[ -f "$target_path/.encrypted_marker" || -f "$(dirname "$target_path")/.encrypted_marker" ]]; then
      echo "[OK] $target_label ($target_path): verified (simulated encryption marker)"
      return 0
    fi
  fi

  local mount_source
  mount_source="$(findmnt -n -o SOURCE -T "$target_path" 2>/dev/null || df --output=source "$target_path" 2>/dev/null | tail -n 1 || true)"

  if [[ -z "$mount_source" ]]; then
    echo "[FAIL] $target_label ($target_path): cannot determine backing mount source." >&2
    ERRORS=$((ERRORS + 1))
    return 1
  fi

  # Check if the backing device or any parent is dm-crypt or LUKS.
  if command -v lsblk >/dev/null 2>&1; then
    local dev_types
    dev_types="$(lsblk -s -n -o TYPE "$mount_source" 2>/dev/null || true)"
    if echo "$dev_types" | grep -q "crypt"; then
      echo "[OK] $target_label ($target_path): backed by encrypted device ($mount_source)"
      return 0
    fi
  fi

  echo "[FAIL] $target_label ($target_path on $mount_source): unencrypted block device detected." >&2
  ERRORS=$((ERRORS + 1))
  return 1
}

echo "Starting host storage encryption checks..."

check_device_encryption "Storage root" "$STORAGE_DIR" || true
check_device_encryption "Database data" "$DB_DIR" || true
check_device_encryption "Database WAL" "$WAL_DIR" || true
check_device_encryption "Backup storage" "$BACKUP_DIR" || true
check_device_encryption "Temporary directory" "$TEMP_DIR" || true

# Check swap encryption
echo "Checking swap configuration..."
if [[ -f /proc/swaps ]]; then
  # Skip header line
  while read -r swap_path swap_type rest; do
    [[ "$swap_path" == "Filename" ]] && continue
    if [[ "$swap_type" == "partition" || "$swap_type" == "file" ]]; then
      if [[ "$ALLOW_SIMULATED" == "true" ]]; then
        echo "[OK] Swap ($swap_path): verified (simulated encryption)"
      else
        check_device_encryption "Swap" "$swap_path" || true
      fi
    fi
  done < /proc/swaps
fi

# Check crash and core dump policy
echo "Checking core dump policy..."
if [[ -f /proc/sys/kernel/core_pattern ]]; then
  core_pattern="$(cat /proc/sys/kernel/core_pattern)"
  if [[ "$core_pattern" == "|/bin/false" || "$core_pattern" == "|/bin/true" ]]; then
    echo "[OK] Core dumps: disabled by the configured handler"
  elif [[ "$core_pattern" == "|/usr/lib/systemd/systemd-coredump"* ]]; then
    check_device_encryption "Crash output" "$CRASH_DIR" || true
  elif [[ "$ALLOW_SIMULATED" == "true" ]]; then
    check_device_encryption "Crash output" "$CRASH_DIR" || true
  else
    echo "[FAIL] Core dump pattern '$core_pattern' has no verified encrypted target." >&2
    ERRORS=$((ERRORS + 1))
  fi
fi

if [[ $ERRORS -gt 0 ]]; then
  echo "" >&2
  echo "Host encryption check FAILED with $ERRORS error(s)." >&2
  echo "All storage devices, swap partitions, and backup targets must use LUKS or equivalent full-disk encryption." >&2
  exit 1
fi

echo ""
echo "Host encryption check PASSED: all inspected storage targets are encrypted."
exit 0
