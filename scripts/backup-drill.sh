#!/usr/bin/env bash
#
# Does the backup actually come back?
# Indian Railways WRS Raipur
#
# WHY THIS EXISTS
# ---------------
# backup-db.sh and restore-db.sh were written, reviewed, and never once run.
# The admin dashboard reported "no backup has ever been taken" and that was
# read as "nobody has scheduled it" rather than as "nobody has established
# that it works". Those are different statements, and only one of them can be
# checked.
#
# The offline drill taught this lesson already: a script nobody runs does not
# announce that it has stopped working, it just stops being run. The backup
# path is a worse place to learn it, because the moment it is needed is the
# moment it is too late to find out.
#
# WHAT IT PROVES
# --------------
#   1. A backup of a live database contains what the database contains,
#      including anything still sitting in the WAL. A plain file copy does
#      NOT — measured here, because the gap is silent and specific.
#   2. The backup decrypts and restores to an identical set of rows.
#   3. A tampered backup is REFUSED, and no file is written.
#   4. The wrong key is REFUSED, and no file is written.
#   5. Every refusal exits non-zero, so a cron line that fails is not a cron
#      line that reports success.
#
# Everything happens in a temporary directory with a throwaway key. It never
# touches the real database, the real backups, or the real key.
#
#   bash scripts/backup-drill.sh

set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
say()  { printf '  %-58s%s\n' "$1" "$2"; }
check() {
  # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then say "$1" "PASS"; else say "$1" "FAIL (expected $2, got $3)"; fail=$((fail + 1)); fi
}

for tool in sqlite3 openssl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "  backup drill NOT RUN — $tool is not installed"
    exit 0
  fi
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo
echo "  WRS Raipur — backup drill"
echo "  -------------------------"

umask 077
openssl rand -hex 32 > "$WORK/backup.key"
openssl rand -hex 32 > "$WORK/wrong.key"

# A real database with the real schema, built by the application itself rather
# than by hand. A drill against a toy schema proves something about the toy.
DB="$WORK/drill.db"
if ! node --experimental-strip-types -e "
  const { createApp } = await import('./server/src/app.ts');
  createApp('$DB');
" >"$WORK/init.log" 2>&1; then
  echo "  could not build a test database:"
  sed 's/^/    /' "$WORK/init.log" | tail -5
  exit 1
fi

# Leave rows in the WAL, uncheckpointed, which is the state a live database is
# always in. This is what a plain copy loses.
sqlite3 "$DB" "PRAGMA journal_mode=WAL;" >/dev/null
#
# The copy is taken from INSIDE the process that still holds the database
# open. That matters: node:sqlite checkpoints the WAL when the connection
# closes, so a copy taken afterwards has already had the WAL folded in and
# would show no difference at all. Copying while the handle is open is the
# state a real backup runs in — the server is up — and it is the only way this
# comparison measures anything rather than happening to agree.
node --experimental-strip-types -e "
  const { DatabaseSync } = require('node:sqlite');
  const fs = require('node:fs');
  const db = new DatabaseSync('$DB');
  const ins = db.prepare('INSERT INTO users (id, username, password_hash, role, full_name, employee_id, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?)');
  const now = new Date().toISOString();
  for (let i = 0; i < 50; i++) ins.run('drill_' + i, 'drill_user_' + i, 'x', 'INSPECTOR', 'Drill ' + i, 'E' + i, now, now);
  fs.copyFileSync('$DB', '$WORK/naive-copy.db');
" >/dev/null 2>&1

LIVE_ROWS="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM users;')"
COPY_ROWS="$(sqlite3 "$WORK/naive-copy.db" 'SELECT COUNT(*) FROM users;' 2>/dev/null || echo 0)"

WRS_BACKUP_KEY_FILE="$WORK/backup.key" bash server/scripts/backup-db.sh "$DB" "$WORK/out" >"$WORK/backup.log" 2>&1
check "backup of a live database succeeds" "0" "$?"

ENC="$(ls "$WORK"/out/*.db.enc 2>/dev/null | head -1)"
if [ -z "$ENC" ]; then
  say "backup produced a file" "FAIL (nothing written)"
  fail=$((fail + 1))
else
  WRS_BACKUP_KEY_FILE="$WORK/backup.key" bash server/scripts/restore-db.sh "$ENC" "$WORK/restored.db" >"$WORK/restore.log" 2>&1
  check "restore succeeds" "0" "$?"

  RESTORED_ROWS="$(sqlite3 "$WORK/restored.db" 'SELECT COUNT(*) FROM users;' 2>/dev/null || echo -1)"
  check "restored row count matches the live database" "$LIVE_ROWS" "$RESTORED_ROWS"

  # The point of using .backup rather than cp, stated as a measurement rather
  # than as a claim in a comment.
  # Stated as a check rather than a note. If a plain copy captured everything,
  # this run did not reproduce the WAL case, and reporting the restore as
  # meaningful would be overclaiming what was tested.
  if [ "$COPY_ROWS" -lt "$LIVE_ROWS" ]; then
    say "a plain file copy loses $((LIVE_ROWS - COPY_ROWS)) row(s); .backup does not" "PASS"
  else
    say "the WAL case was not reproduced — restore proves less than it seems" "FAIL"
    fail=$((fail + 1))
  fi

  cp "$ENC" "$WORK/tampered.db.enc"
  cp "$ENC.hmac" "$WORK/tampered.db.enc.hmac"
  printf '\x00' | dd of="$WORK/tampered.db.enc" bs=1 seek=5000 conv=notrunc >/dev/null 2>&1
  WRS_BACKUP_KEY_FILE="$WORK/backup.key" bash server/scripts/restore-db.sh "$WORK/tampered.db.enc" "$WORK/tampered-out.db" >/dev/null 2>&1
  check "a tampered backup is refused" "1" "$?"
  check "  and no file is written" "absent" "$([ -f "$WORK/tampered-out.db" ] && echo present || echo absent)"

  WRS_BACKUP_KEY_FILE="$WORK/wrong.key" bash server/scripts/restore-db.sh "$ENC" "$WORK/wrongkey-out.db" >/dev/null 2>&1
  check "the wrong key is refused" "1" "$?"
  check "  and no file is written" "absent" "$([ -f "$WORK/wrongkey-out.db" ] && echo present || echo absent)"
fi

bash server/scripts/backup-db.sh "$DB" "$WORK/nokey" >/dev/null 2>&1
check "backup without a key refuses rather than write plaintext" "1" "$?"
check "  and no plaintext is left behind" "absent" "$([ -n "$(ls "$WORK"/nokey/*.db 2>/dev/null)" ] && echo present || echo absent)"

echo
if [ "$fail" -gt 0 ]; then
  echo "  $fail check(s) FAILED — the backup path cannot be relied on."
  exit 1
fi
echo "  All checks passed. A backup taken now would come back."
exit 0
