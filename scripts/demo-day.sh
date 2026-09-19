#!/usr/bin/env bash
# Demo day, rehearsed on the built bundle.
#
# Packages the shop bundle, does what START.cmd's first run does (.env with a
# generated secret, the certificate), what DEMO-DATA.cmd does (the demonstration
# record, SEED_DEMO_USERS=true), starts it the way START.cmd does (production,
# https, the bundle's own certificate), takes the evening-before backup, and
# then walks docs/DEMO_DAY.md step by step in a real browser
# (scripts/demo-day-drill.mjs), photographing each step. The evening before the
# meeting this is the command; the screenshots are what to look at.
#
#   bash scripts/demo-day.sh [outDir]      # default: demo-rehearsal/
#   SKIP_PACKAGE=1 bash scripts/demo-day.sh  # reuse dist-shop/wrs-raipur
#   KEEP=1 bash scripts/demo-day.sh          # leave the seeded bundle running on :3200 to look at
set -u
cd "$(dirname "$0")/.."

PORT="${DEMO_PORT:-3200}"
OUT="${1:-demo-rehearsal}"
BUNDLE="$PWD/dist-shop/wrs-raipur"
LOG=/tmp/wrs_demo_day_server.log

if ! node -e "import('playwright')" >/dev/null 2>&1; then echo "playwright is not installed"; exit 2; fi
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "something is already listening on :$PORT"; exit 2; fi

# The rehearsal's certificate lives beside the bundle, not in it: packaging
# wipes the folder, and a browser that had trusted the old certificate then
# loads the cached app and gets 'Failed to fetch' on every call against the
# new one. Trust it once on this machine and it is the certificate served by
# every rehearsal after.
CERT_KEEP="$PWD/dist-shop/.rehearsal-certs"
if [ "${SKIP_PACKAGE:-}" != "1" ]; then
  [ -d "$BUNDLE/server/certs" ] && mkdir -p "$CERT_KEEP" && cp "$BUNDLE"/server/certs/lan-*.* "$CERT_KEEP"/ 2>/dev/null
  echo "packaging the bundle..."
  if ! npm run package:shop >/tmp/wrs_demo_day_package.log 2>&1; then tail -20 /tmp/wrs_demo_day_package.log; exit 1; fi
fi
if [ -f "$CERT_KEEP/lan-cert.pem" ] && [ ! -f "$BUNDLE/server/certs/lan-cert.pem" ]; then
  mkdir -p "$BUNDLE/server/certs" && cp "$CERT_KEEP"/lan-*.* "$BUNDLE/server/certs/"
fi

cd "$BUNDLE"
mkdir -p server/data
rm -f .env server/data/wrs_inspections.db server/data/wrs_inspections.db-wal server/data/wrs_inspections.db-shm
# The certificate is kept between runs (like START.cmd keeps it): trust it once on
# this machine and it stays trusted. Everything else starts fresh.
rm -rf server/data/photos server/data/backups backups-elsewhere logs

# START.cmd, first run: .env from the example, a generated secret. The demo
# leaves BOOTSTRAP_ADMIN_PASSWORD at the placeholder — that is what a person
# who closes Notepad does, and the seed must not make an account from it.
echo "START.cmd first run: .env and certificate"
cp .env.example .env
sed -i.bak \
  -e "s/^JWT_SECRET=$/JWT_SECRET=$(node -e 'console.log(require("crypto").randomBytes(48).toString("base64"))' | tr -d '/+=')/" \
  -e "s/^PORT=3000/PORT=$PORT/" \
  -e "s#^CORS_ORIGIN=.*#CORS_ORIGIN=https://localhost:$PORT#" \
  -e "s#^WRS_BACKUP_DIR=.*#WRS_BACKUP_DIR=$BUNDLE/backups-elsewhere#" .env
rm -f .env.bak
[ -f server/certs/lan-cert.pem ] || node server/scripts/make-lan-cert.mjs server/certs >/dev/null 2>&1

# DEMO-DATA.cmd: the demonstration record, SEED_DEMO_USERS=true into .env.
echo "DEMO-DATA.cmd: seeding the demonstration record"
( cd server && SEED_DEMO_USERS=true node --experimental-strip-types src/db/seed.ts >/tmp/wrs_demo_day_seed.log 2>&1 ) || { tail -20 /tmp/wrs_demo_day_seed.log; exit 1; }
grep -q '^SEED_DEMO_USERS=true' .env || echo 'SEED_DEMO_USERS=true' >> .env
# … and what DEMO-DATA.cmd does next: INDEX-MANUALS.cmd, every .txt in docs/manuals.
if ls docs/manuals/*.txt >/dev/null 2>&1; then
  echo "INDEX-MANUALS.cmd: indexing docs/manuals"
  for f in docs/manuals/*.txt; do
    label="$(basename "$f" .txt | cut -d- -f1)"
    ( cd server && node --experimental-strip-types scripts/index-manual.ts "../$f" "$label" >>/tmp/wrs_demo_day_seed.log 2>&1 ) || { echo "  indexing $f failed:"; tail -5 /tmp/wrs_demo_day_seed.log; exit 1; }
  done
else
  echo "  (no docs/manuals/*.txt — Ask the Manual will cite nothing; see docs/manuals/README.md)"
fi

# START.cmd, second run.
echo "START.cmd: starting on :$PORT"
mkdir -p logs
( cd server && TLS_KEY_PATH="$PWD/certs/lan-key.pem" TLS_CERT_PATH="$PWD/certs/lan-cert.pem" \
    node --experimental-strip-types src/index.ts >"$LOG" 2>&1 ) &
SERVER_PID=$!
for _ in $(seq 1 30); do
  if curl -sk -o /dev/null --max-time 2 "https://localhost:$PORT/api/health"; then break; fi
  sleep 1
done
if ! curl -sk -o /dev/null --max-time 2 "https://localhost:$PORT/api/health"; then
  echo "the bundle did not start:"; tail -20 "$LOG"; kill $SERVER_PID 2>/dev/null; exit 1
fi

# The evening before, step 6: a backup, so the morning starts from a known file.
echo "the evening-before backup"
mkdir -p key-elsewhere && node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))' > key-elsewhere/backup.key
if WRS_BACKUP_KEY_FILE="$BUNDLE/key-elsewhere/backup.key" node --experimental-strip-types server/scripts/backup-db.mjs server/data/wrs_inspections.db backups-elsewhere server/data/photos >/tmp/wrs_demo_day_backup.log 2>&1 \
   && ls backups-elsewhere/*.db.enc >/dev/null 2>&1; then
  echo "  ✓ backup written to backups-elsewhere/"
else
  echo "  ✗ the backup failed:"; tail -8 /tmp/wrs_demo_day_backup.log; BACKUP_FAILED=1
fi

cd "$OLDPWD"
mkdir -p "$CERT_KEEP" && cp "$BUNDLE"/server/certs/lan-*.* "$CERT_KEEP"/ 2>/dev/null
APP_URL="https://localhost:$PORT" node scripts/demo-day-drill.mjs "$OUT"
RESULT=$?
[ "${BACKUP_FAILED:-}" = "1" ] && RESULT=1

if [ "${KEEP:-}" = "1" ]; then
  echo "KEEP=1: the seeded bundle is still running at https://localhost:$PORT (drm1 / password123). Stop it with: kill $SERVER_PID; pkill -P $SERVER_PID"
  exit $RESULT
fi

# The subshell's node child too — killing the subshell alone left a server on the port.
pkill -P $SERVER_PID 2>/dev/null; kill $SERVER_PID 2>/dev/null
echo "server log: $LOG"
grep -iE "error|warn" "$LOG" | grep -v "SEED_DEMO_USERS\|demo" | head -5
# The bundle keeps no trace of the rehearsal: a fresh folder is what ships.
rm -f "$BUNDLE/.env"
rm -rf "$BUNDLE/backups-elsewhere" "$BUNDLE/key-elsewhere" "$BUNDLE/server/data" "$BUNDLE/logs"
mkdir -p "$BUNDLE/server/data"
exit $RESULT
