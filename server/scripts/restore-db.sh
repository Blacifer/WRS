#!/usr/bin/env bash
# Restore an encrypted WRS Raipur database backup.
#
# This exists because an encrypted backup that nobody can restore is worse
# than no backup at all — it looks like protection right up until the moment
# it is needed. Run it once against a throwaway target after setting up
# backups, so the restore path is known to work before it matters.
#
# Usage:
#   WRS_BACKUP_KEY_FILE=/etc/wrs/backup.key \
#     ./restore-db.sh /path/to/wrs_inspections_20260825_020000.db.enc [target_db_path]
#
# The target is never overwritten. If a database is already there, this stops
# and tells you — restoring over a live database would destroy whatever has
# been recorded since the backup was taken, which on this system means real
# inspections that were never written anywhere else.

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENC_FILE="${1:-}"
TARGET_DB="${2:-$SCRIPT_DIR/../data/wrs_inspections.db}"
KEY_FILE="${WRS_BACKUP_KEY_FILE:-}"

if [ -z "$ENC_FILE" ]; then
  echo "Usage: WRS_BACKUP_KEY_FILE=/etc/wrs/backup.key $0 <backup.db.enc> [target_db_path]" >&2
  exit 1
fi

if [ -z "$KEY_FILE" ] || [ ! -r "$KEY_FILE" ]; then
  echo "[restore-db] ERROR: WRS_BACKUP_KEY_FILE is not set or not readable." >&2
  echo "[restore-db]        Without the key the backup cannot be read. There is no recovery path around this." >&2
  exit 1
fi

if [ ! -f "$ENC_FILE" ]; then
  echo "[restore-db] ERROR: backup not found: $ENC_FILE" >&2
  exit 1
fi

if [ -e "$TARGET_DB" ]; then
  echo "[restore-db] ERROR: $TARGET_DB already exists — refusing to overwrite it." >&2
  echo "[restore-db]        Move it aside first. Anything recorded since this backup was taken" >&2
  echo "[restore-db]        exists only in that file." >&2
  exit 1
fi

# Check the MAC before decrypting, not after. A backup that was corrupted or
# altered on the backup volume should be rejected without being fed to the
# cipher at all.
HMAC_FILE="${ENC_FILE}.hmac"
if [ -f "$HMAC_FILE" ]; then
  HMAC_KEY="$(openssl dgst -sha256 -hex "$KEY_FILE" | awk '{print $NF}')"
  ACTUAL="$(openssl dgst -sha256 -mac HMAC -macopt "hexkey:$HMAC_KEY" -hex "$ENC_FILE" | awk '{print $NF}')"
  EXPECTED="$(tr -d '[:space:]' < "$HMAC_FILE")"
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "[restore-db] ERROR: HMAC mismatch. Not restoring this backup." >&2
    echo "[restore-db]" >&2
    echo "[restore-db]        Two different things look like this, and the first is far more common:" >&2
    echo "[restore-db]" >&2
    echo "[restore-db]          1. Wrong key file. The HMAC key is derived from WRS_BACKUP_KEY_FILE," >&2
    echo "[restore-db]             so a key that does not match fails here rather than at decryption." >&2
    echo "[restore-db]             Check you are pointing at the key used when this backup was taken." >&2
    echo "[restore-db]" >&2
    echo "[restore-db]          2. The backup was altered or corrupted on the backup volume." >&2
    echo "[restore-db]             If the key is definitely right, treat it as that and use an" >&2
    echo "[restore-db]             earlier backup." >&2
    exit 1
  fi
  echo "[restore-db] HMAC verified."
else
  echo "[restore-db] WARNING: no .hmac file beside this backup, so tampering cannot be ruled out."
  echo "[restore-db]          Continuing, because an unauthenticated backup is still better than none."
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM
PLAIN_FILE="$WORK_DIR/restored.db"

echo "[restore-db] Decrypting $ENC_FILE"
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 210000 -md sha512 \
      -pass "file:$KEY_FILE" -in "$ENC_FILE" -out "$PLAIN_FILE" 2>/dev/null; then
  echo "[restore-db] ERROR: decryption failed — wrong key file, or the backup is damaged." >&2
  exit 1
fi

if ! sqlite3 "$PLAIN_FILE" "PRAGMA integrity_check;" | grep -q "^ok$"; then
  echo "[restore-db] ERROR: the decrypted file is not a valid SQLite database." >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DB")"
mv "$PLAIN_FILE" "$TARGET_DB"

echo "[restore-db] Restored to $TARGET_DB"
echo "[restore-db] Now verify the audit chain before trusting the restored data."
echo "[restore-db] Start the server, then as a SUPERVISOR or ADMIN:"
echo "[restore-db]"
echo "[restore-db]   curl -s -H \"Authorization: Bearer <token>\" http://localhost:3000/api/audit/verify"
echo "[restore-db]"
echo "[restore-db] It recomputes every hash and reports any break. A restored file that"
echo "[restore-db] decrypts cleanly can still have been altered before it was backed up,"
echo "[restore-db] and this is what would show that."
