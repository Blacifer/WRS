#!/usr/bin/env bash
# The production first day, on the built bundle.
#
# Packages the shop bundle, starts it the way START.cmd does — NODE_ENV=production,
# https with the bundle's own certificate, the bootstrap administrator from .env,
# no demo accounts — on a fresh database, and drives the first day through it
# (scripts/first-day-drill.mjs). Everything is torn down afterwards. This is the
# step that answers "is it ready to use" rather than "does it demo".
#
#   bash scripts/first-day.sh            # standalone; preflight runs it too
set -u
cd "$(dirname "$0")/.."

PORT=3100
BOOT_PASSWORD='FirstDay-Raipur-2026!'
BUNDLE="$PWD/dist-shop/wrs-raipur"
LOG=/tmp/wrs_first_day_server.log

if ! node -e "import('playwright')" >/dev/null 2>&1; then echo "playwright is not installed"; exit 2; fi
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "something is already listening on :$PORT"; exit 2; fi

echo "packaging the bundle..."
if ! npm run package:shop >/tmp/wrs_first_day_package.log 2>&1; then tail -20 /tmp/wrs_first_day_package.log; exit 1; fi

cd "$BUNDLE"
cp .env.example .env
# What START.cmd's first run fills in, filled in here.
sed -i.bak \
  -e "s/^JWT_SECRET=$/JWT_SECRET=first-day-$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')/" \
  -e "s/^BOOTSTRAP_ADMIN_PASSWORD=.*/BOOTSTRAP_ADMIN_PASSWORD=$BOOT_PASSWORD/" \
  -e "s/^PORT=3000/PORT=$PORT/" \
  -e "s#^CORS_ORIGIN=.*#CORS_ORIGIN=https://localhost:$PORT#" \
  -e "s#^WRS_BACKUP_DIR=.*#WRS_BACKUP_DIR=$BUNDLE/backups-elsewhere#" .env
rm -f .env.bak
node server/scripts/make-lan-cert.mjs server/certs >/dev/null 2>&1
rm -f server/data/wrs_inspections.db server/data/wrs_inspections.db-wal server/data/wrs_inspections.db-shm
rm -rf backups-elsewhere key-elsewhere

( cd server && TLS_KEY_PATH="$PWD/certs/lan-key.pem" TLS_CERT_PATH="$PWD/certs/lan-cert.pem" \
    node --experimental-strip-types src/index.ts >"$LOG" 2>&1 ) &
SERVER_PID=$!
for _ in $(seq 1 20); do
  if curl -sk -o /dev/null --max-time 2 "https://localhost:$PORT/api/health"; then break; fi
  sleep 1
done
if ! curl -sk -o /dev/null --max-time 2 "https://localhost:$PORT/api/health"; then
  echo "the bundle did not start:"; tail -20 "$LOG"; kill $SERVER_PID 2>/dev/null; exit 1
fi

cd "$OLDPWD"
APP_URL="https://localhost:$PORT" ADMIN_PASSWORD="$BOOT_PASSWORD" BUNDLE_DIR="$BUNDLE" node scripts/first-day-drill.mjs
RESULT=$?

kill $SERVER_PID 2>/dev/null
# The bundle keeps no trace of the drill: a fresh .env.example is what ships.
rm -f "$BUNDLE/.env"
rm -rf "$BUNDLE/backups-elsewhere" "$BUNDLE/key-elsewhere" "$BUNDLE/server/data" "$BUNDLE/server/certs"
exit $RESULT
