#!/usr/bin/env bash
# Scheduled backup for the WRS Raipur SQLite database.
# Uses SQLite's native ".backup" command, which is safe to run against a
# live WAL-mode database without stopping the server (unlike a plain file
# copy, which can capture an inconsistent snapshot mid-write).
#
# Usage: ./backup-db.sh [source_db_path] [backup_dir]
# Defaults assume this script runs from server/scripts/.
#
# Retention: keeps the last 30 daily backups and prunes older ones.
#
# To schedule (Linux, cron): run `crontab -e` and add a line such as:
#   0 2 * * * /path/to/server/scripts/backup-db.sh >> /var/log/wrs-backup.log 2>&1
# (runs daily at 02:00). On macOS, use launchd instead of cron for reliability.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DB="${1:-$SCRIPT_DIR/../data/wrs_inspections.db}"
BACKUP_DIR="${2:-$SCRIPT_DIR/../data/backups}"
RETENTION_DAYS=30

if [ ! -f "$SOURCE_DB" ]; then
  echo "[backup-db] ERROR: source database not found at $SOURCE_DB" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DEST_FILE="$BACKUP_DIR/wrs_inspections_${TIMESTAMP}.db"

echo "[backup-db] Backing up $SOURCE_DB -> $DEST_FILE"
sqlite3 "$SOURCE_DB" ".backup '$DEST_FILE'"

# Verify the backup is a valid, readable SQLite database before trusting it.
if ! sqlite3 "$DEST_FILE" "PRAGMA integrity_check;" | grep -q "^ok$"; then
  echo "[backup-db] ERROR: integrity check failed on $DEST_FILE — deleting corrupt backup" >&2
  rm -f "$DEST_FILE"
  exit 1
fi

echo "[backup-db] Backup verified OK ($(du -h "$DEST_FILE" | cut -f1))"

# Prune backups older than RETENTION_DAYS, including their WAL/SHM companion
# files (which don't match the *.db glob on their own and would otherwise be
# left orphaned once the parent backup ages out).
find "$BACKUP_DIR" -name 'wrs_inspections_*.db' -mtime "+${RETENTION_DAYS}" -print | while read -r old_backup; do
  rm -f "$old_backup" "${old_backup}-shm" "${old_backup}-wal"
done

echo "[backup-db] Done. $(find "$BACKUP_DIR" -name 'wrs_inspections_*.db' | wc -l | tr -d ' ') backups retained."
