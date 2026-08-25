#!/usr/bin/env bash
# Encrypted, verified backup of the WRS Raipur database.
#
# WHAT IS IN THIS FILE
# --------------------
# Every inspection, every release certificate, every named inspector, and the
# whole hash-chained audit log. It is the record that says a particular wagon
# was fit to leave, and who said so. A copy of it sitting in plaintext on a
# backup volume is the softest target in the deployment: the running server
# has authentication in front of it, and a backup file has nothing.
#
# So this script encrypts, and it refuses to run without a key rather than
# quietly producing a plaintext copy — a backup script that silently degrades
# is worse than one that fails, because nobody looks at a job that reports
# success.
#
# HOW IT ENCRYPTS
# ---------------
# AES-256-CBC with PBKDF2 (210,000 iterations, SHA-512), then a detached
# HMAC-SHA256 over the ciphertext. Encrypt-then-MAC, verified before
# decryption on restore, so a corrupted or tampered backup is detected
# without feeding it to the cipher first.
#
# openssl's `enc` will not do AES-GCM, and gpg and age are not present on a
# stock host, so the MAC is separate rather than built into the cipher mode.
# The two keys are separated: the AES key is derived by PBKDF2 from the key
# file with a random salt per backup, the HMAC key is SHA-256 of the key file.
#
# SETUP (once)
# ------------
#   umask 077
#   openssl rand -hex 32 > /etc/wrs/backup.key
#   chmod 400 /etc/wrs/backup.key
#   export WRS_BACKUP_KEY_FILE=/etc/wrs/backup.key
#
# Keep that key somewhere other than the backup volume. A key stored beside
# the thing it encrypts protects against nothing. Losing it means losing every
# backup, so it belongs wherever JWT_SECRET is kept — and it is not the same
# value as JWT_SECRET, deliberately: whoever restores backups should not
# thereby be able to forge tokens or certificates.
#
# Usage: ./backup-db.sh [source_db_path] [backup_dir]
# Restore with: ./restore-db.sh <backup.db.enc> [target_db_path]
#
# Retention: keeps the last 30 days and prunes older ones.
#
# To schedule (Linux, cron): `crontab -e`, then
#   0 2 * * * WRS_BACKUP_KEY_FILE=/etc/wrs/backup.key /path/to/server/scripts/backup-db.sh >> /var/log/wrs-backup.log 2>&1
# On macOS use launchd rather than cron.

set -euo pipefail

# The plaintext database is written to disk for a moment before it is
# encrypted. Make sure that moment is not world-readable.
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DB="${1:-$SCRIPT_DIR/../data/wrs_inspections.db}"
BACKUP_DIR="${2:-$SCRIPT_DIR/../data/backups}"
RETENTION_DAYS=30

KEY_FILE="${WRS_BACKUP_KEY_FILE:-}"

if [ -z "$KEY_FILE" ]; then
  cat >&2 <<'MSG'
[backup-db] ERROR: WRS_BACKUP_KEY_FILE is not set.

This database holds the audit log, the release certificates and every
inspector's record. It is not backed up in plaintext.

Create a key once, keeping it OFF the backup volume:

    umask 077
    openssl rand -hex 32 > /etc/wrs/backup.key
    chmod 400 /etc/wrs/backup.key
    export WRS_BACKUP_KEY_FILE=/etc/wrs/backup.key

Then back that key up separately. Without it, no backup can be restored.
MSG
  exit 1
fi

if [ ! -r "$KEY_FILE" ]; then
  echo "[backup-db] ERROR: key file not readable at $KEY_FILE" >&2
  exit 1
fi

if [ ! -s "$KEY_FILE" ]; then
  echo "[backup-db] ERROR: key file is empty: $KEY_FILE" >&2
  exit 1
fi

if [ ! -f "$SOURCE_DB" ]; then
  echo "[backup-db] ERROR: source database not found at $SOURCE_DB" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ENC_FILE="$BACKUP_DIR/wrs_inspections_${TIMESTAMP}.db.enc"

# The plaintext snapshot is a working file, not an output. It goes to a
# private temporary directory and is removed however this script exits —
# including on failure, which is exactly when a forgotten plaintext copy of
# the audit log would be left behind.
WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

PLAIN_FILE="$WORK_DIR/snapshot.db"

# SQLite's own .backup, which is safe against a live WAL-mode database. A
# plain file copy can catch an inconsistent snapshot mid-write.
echo "[backup-db] Snapshotting $SOURCE_DB"
sqlite3 "$SOURCE_DB" ".backup '$PLAIN_FILE'"

# Check it before encrypting. Encrypting a corrupt snapshot would produce a
# backup that decrypts perfectly into something useless.
if ! sqlite3 "$PLAIN_FILE" "PRAGMA integrity_check;" | grep -q "^ok$"; then
  echo "[backup-db] ERROR: integrity check failed on the snapshot — not writing a backup" >&2
  exit 1
fi

PLAIN_SIZE="$(du -h "$PLAIN_FILE" | cut -f1)"

echo "[backup-db] Encrypting -> $ENC_FILE"
openssl enc -aes-256-cbc -pbkdf2 -iter 210000 -md sha512 -salt \
  -pass "file:$KEY_FILE" -in "$PLAIN_FILE" -out "$ENC_FILE"

# Encrypt-then-MAC. The HMAC key is derived from the key file rather than
# being the key file, so it is not the same key the cipher uses.
HMAC_KEY="$(openssl dgst -sha256 -hex "$KEY_FILE" | awk '{print $NF}')"
openssl dgst -sha256 -mac HMAC -macopt "hexkey:$HMAC_KEY" -hex "$ENC_FILE" \
  | awk '{print $NF}' > "${ENC_FILE}.hmac"

# Prove the backup is restorable now, rather than discovering it is not on the
# day it is needed. An untested backup is a belief, not a backup.
VERIFY_FILE="$WORK_DIR/verify.db"
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 210000 -md sha512 \
      -pass "file:$KEY_FILE" -in "$ENC_FILE" -out "$VERIFY_FILE" 2>/dev/null; then
  echo "[backup-db] ERROR: the backup just written could not be decrypted — removing it" >&2
  rm -f "$ENC_FILE" "${ENC_FILE}.hmac"
  exit 1
fi

if ! sqlite3 "$VERIFY_FILE" "PRAGMA integrity_check;" | grep -q "^ok$"; then
  echo "[backup-db] ERROR: the decrypted backup is not a valid database — removing it" >&2
  rm -f "$ENC_FILE" "${ENC_FILE}.hmac"
  exit 1
fi

echo "[backup-db] Verified: encrypted, decrypts, and the result is a valid database (${PLAIN_SIZE} plaintext)"

# Prune aged-out backups and their HMAC files together, so a .hmac is never
# left pointing at a backup that no longer exists.
find "$BACKUP_DIR" -name 'wrs_inspections_*.db.enc' -mtime "+${RETENTION_DAYS}" -print | while read -r old_backup; do
  rm -f "$old_backup" "${old_backup}.hmac"
done

# Plaintext backups from before this script encrypted are reported rather than
# deleted — removing someone's only copy of the audit log unasked would be a
# worse mistake than leaving it. Move them somewhere encrypted, then delete.
LEGACY_COUNT="$(find "$BACKUP_DIR" -name 'wrs_inspections_*.db' -not -name '*.enc' | wc -l | tr -d ' ')"
if [ "$LEGACY_COUNT" -gt 0 ]; then
  echo "[backup-db] WARNING: $LEGACY_COUNT unencrypted backup(s) from before encryption was added are still in $BACKUP_DIR."
  echo "[backup-db]          They contain the full audit log in the clear. Move them to encrypted storage and delete them."
fi

echo "[backup-db] Done. $(find "$BACKUP_DIR" -name 'wrs_inspections_*.db.enc' | wc -l | tr -d ' ') encrypted backups retained."
