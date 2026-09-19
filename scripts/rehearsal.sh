#!/usr/bin/env bash
# The rehearsal, from one command — on the machine you are rehearsing on.
#
# Section 6 of the walkthrough ("failure drills") asks a person to stop the
# server, read its log, take a backup and restore it. On the demo laptop those
# are START.cmd, logs\wrs-<date>.log and two scripts; on a Mac rehearsing with
# demo-day.sh they were five different commands nobody could be expected to
# remember. So:
#
#   bash scripts/rehearsal.sh start     # package if needed, seed the demo, start on :3200, keep running
#   bash scripts/rehearsal.sh stop      # what "closing the START.cmd window" is on the laptop
#   bash scripts/rehearsal.sh status    # is it answering, and on which address
#   bash scripts/rehearsal.sh log       # the server's log, newest lines
#   bash scripts/rehearsal.sh backup    # take a backup now — what 02:00 does on its own
#   bash scripts/rehearsal.sh restore   # restore the newest backup into a second folder and count its wagons
#   bash scripts/rehearsal.sh tunnel    # Plan B: a public https address through Cloudflare, for a phone on its own internet
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
PORT="${DEMO_PORT:-3200}"
BUNDLE="$PWD/dist-shop/wrs-raipur"
LOG=/tmp/wrs_demo_day_server.log
OUT=/tmp/wrs-rehearsal-shots

case "${1:-}" in
  start)
    if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "already running on :$PORT — run stop first"; exit 0; fi
    SKIP=""; [ -f "$BUNDLE/START.cmd" ] && SKIP=1
    echo "starting (this takes a few minutes the first time: package, seed, rehearse) ..."
    KEEP=1 SKIP_PACKAGE="${SKIP:-}" bash scripts/demo-day.sh "$OUT" >/tmp/wrs_rehearsal_start.log 2>&1 &
    for _ in $(seq 1 120); do curl -sk -o /dev/null --max-time 2 "https://localhost:$PORT/api/health" && break; sleep 5; done
    "$0" status ;;
  stop)
    pids=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $2}')
    if [ -z "$pids" ]; then echo "nothing running on :$PORT"; else kill $pids; echo "stopped (that is what closing the START.cmd window does on the laptop)"; fi ;;
  status)
    ip=$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
    if curl -sk -o /dev/null --max-time 2 "https://localhost:$PORT/api/health"; then
      echo "running:  https://localhost:$PORT   (laptop)"
      echo "          https://${ip:-THIS-MACHINE-WIFI-ADDRESS}:$PORT   (phone or tablet on the same Wi-Fi)"
    else echo "NOT running on :$PORT — run: bash scripts/rehearsal.sh start"; fi ;;
  log)
    echo "== $LOG (newest last)"; tail -40 "$LOG" 2>/dev/null | cut -c1-220 || echo "no log yet" ;;
  backup)
    mkdir -p "$BUNDLE/key-elsewhere" "$BUNDLE/backups-elsewhere"
    [ -f "$BUNDLE/key-elsewhere/backup.key" ] || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))' > "$BUNDLE/key-elsewhere/backup.key"
    ( cd "$BUNDLE" && WRS_BACKUP_KEY_FILE="$BUNDLE/key-elsewhere/backup.key" node --experimental-strip-types server/scripts/backup-db.mjs server/data/wrs_inspections.db backups-elsewhere server/data/photos ) | grep -E "Done|Wrote|backup|ERROR" | head -6
    echo "== backups-elsewhere/"; ls -la "$BUNDLE/backups-elsewhere" | grep -E "db\.enc|hmac" | awk '{print "   " $6, $7, $8, $9, "(" $5 " bytes)"}' ;;
  restore)
    newest=$(ls -t "$BUNDLE"/backups-elsewhere/*.db.enc 2>/dev/null | head -1)
    [ -z "$newest" ] && { echo "no backup yet — run backup first"; exit 1; }
    rm -rf /tmp/wrs-restored && mkdir -p /tmp/wrs-restored
    ( cd "$BUNDLE" && WRS_BACKUP_KEY_FILE="$BUNDLE/key-elsewhere/backup.key" node --experimental-strip-types server/scripts/backup-db.mjs --restore "$newest" /tmp/wrs-restored/wrs.db ) | grep -E "Restored|restored|ERROR|verified" | head -4
    node scripts/count-tables.mjs "$BUNDLE/server/data/wrs_inspections.db" /tmp/wrs-restored/wrs.db
    echo "   restored copy: /tmp/wrs-restored/wrs.db" ;;
  tunnel)
    echo "Plan B: a public https address for a phone on its own internet. Data passes through Cloudflare, encrypted."
    echo "For a demonstration only, never for the live record. Needs internet on this machine. Ctrl-C ends it."
    exec bash scripts/pilot-tunnel.sh ;;
  *)
    sed -n 2,17p "$0" | cut -c3- ;;
esac
