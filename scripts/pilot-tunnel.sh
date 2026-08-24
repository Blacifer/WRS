#!/usr/bin/env bash
#
# Real-device test tunnel for WRS Raipur
# ---------------------------------------
# Puts the app on a public HTTPS URL so it can be opened on an actual phone
# or workshop tablet. HTTPS is the point: browsers refuse camera access over
# plain HTTP from anything but localhost, so QR scanning and photo capture
# cannot be tested any other way.
#
# This serves the PRODUCTION BUILD through the single Node server, exactly as
# a real deployment would — client and API on one origin. Tunnelling the Vite
# dev server instead would test a code path that never runs in production and
# would need host-allowlist fiddling on every new tunnel URL.
#
# Free, no account, nothing provisioned, nothing billed. Ctrl-C tears it all
# down.
#
#   ./scripts/pilot-tunnel.sh
#
set -uo pipefail

# macOS ships bash 3.2. Under a non-UTF-8 locale it parses the bytes of a
# multi-byte character as part of an adjacent variable name, so pin UTF-8.
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"

# Homebrew's bin is not always on PATH in a non-interactive shell, which made
# the script fall back to localtunnel even with cloudflared installed.
for brewbin in /opt/homebrew/bin /usr/local/bin; do
  # Appended, never prepended: Homebrew may carry an older node (node@20 here)
  # and this addition exists only so cloudflared can be found. Putting it first
  # silently downgraded the runtime and failed the Node 22 check.
  [[ -d "$brewbin" ]] && [[ ":$PATH:" != *":$brewbin:"* ]] && export PATH="$PATH:$brewbin"
done

PORT="${PORT:-3000}"

# This machine's address on the local network. A phone on the same Wi-Fi can
# reach the app here directly — no tunnel, no third party, and nothing to drop.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || \
          ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YEL=$'\033[1;33m'; CYA=$'\033[0;36m'; BLD=$'\033[1m'; NC=$'\033[0m'

say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s%s%s\n' "${CYA}" "${NC}" "${BLD}" "$*" "${NC}"; }
warn() { printf '%s!%s  %s\n' "${YEL}" "${NC}" "$*"; }
die()  { printf '%s✗%s  %s\n' "${RED}" "${NC}" "$*" >&2; exit 1; }
ok()   { printf '%s✓%s  %s\n' "${GRN}" "${NC}" "$*"; }

SERVER_PID=""
TUNNEL_PID=""
cleanup() {
  printf '\n'
  step "Shutting down"
  [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null && ok "tunnel closed"
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null && ok "server stopped"
  # The npm wrapper does not forward signals to the node child, so free the port directly.
  lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null
  ok "port $PORT released"
  exit 0
}
trap cleanup INT TERM

# ---------------------------------------------------------------- node version
step "Checking Node"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[[ "$NODE_MAJOR" -ge 22 ]] || die "Node 22+ required (found $(node -v 2>/dev/null || echo none)). The server uses the built-in node:sqlite module."
ok "node $(node -v)"

# ------------------------------------------------------------------- jwt secret
step "Session secret"
if [[ -z "${JWT_SECRET:-}" ]]; then
  JWT_SECRET="$(openssl rand -hex 32)"
  export JWT_SECRET
  warn "JWT_SECRET was not set — generated a throwaway one for this session."
  warn "Everyone is logged out when this script restarts. That is intended for a test."
else
  ok "using the JWT_SECRET already in the environment"
fi

# ------------------------------------------------------------------------ build
step "Building the client"
( cd client && npm run build >/tmp/wrs_pilot_build.log 2>&1 ) \
  || die "client build failed — see /tmp/wrs_pilot_build.log"
ok "production bundle built"

# ------------------------------------------------------------------------- data
step "Database"
if [[ ! -f server/data/wrs_inspections.db ]]; then
  ( cd server && npm run seed >/tmp/wrs_pilot_seed.log 2>&1 ) \
    && ok "seeded demo data (13 wagons)" \
    || warn "seeding failed — see /tmp/wrs_pilot_seed.log"
else
  ok "existing database kept — delete server/data/wrs_inspections.db to start fresh"
fi

MANUAL_PAGES="$(cd server && node --experimental-strip-types -e "
import { getDatabase } from './src/db/connection.ts';
import { getManualStats } from './src/manual/manualIndex.ts';
try { const s = getManualStats(getDatabase()); process.stdout.write(String(s.passageCount || 0)); }
catch { process.stdout.write('0'); }
" 2>/dev/null || echo 0)"
if [[ "$MANUAL_PAGES" == "0" ]]; then
  # Look for the manual where it usually is rather than making someone paste a
  # path. Indexing is a one-off per database, so doing it automatically here
  # removes the single most likely reason "Ask the Manual" comes up empty.
  MANUAL_PDF=""
  for candidate in \
    "$HOME/Downloads/Vol-I (System Documentation)_merged.pdf" \
    "$HOME/Downloads/Vol-I (System Documentation).pdf" \
    "$HOME/Desktop/Vol-I (System Documentation).pdf" \
    "$ROOT/docs/Vol-I (System Documentation).pdf"
  do
    [[ -f "$candidate" ]] && { MANUAL_PDF="$candidate"; break; }
  done

  if [[ -z "$MANUAL_PDF" ]]; then
    MANUAL_PDF="$(find "$HOME/Downloads" "$HOME/Desktop" -maxdepth 1 -iname '*System Documentation*.pdf' 2>/dev/null | head -1)"
  fi

  if [[ -n "$MANUAL_PDF" ]]; then
    step "Indexing the maintenance manual (one-off)"
    say "found: $(basename "$MANUAL_PDF")"
    if ( cd server && npm run index-manual -- "$MANUAL_PDF" >/tmp/wrs_pilot_manual.log 2>&1 ); then
      ok "$(grep -oE 'Indexed [0-9,]+ passages across [0-9]+ pages' /tmp/wrs_pilot_manual.log | head -1)"
    else
      warn "indexing failed — see /tmp/wrs_pilot_manual.log"
      warn "'Ask the Manual' will say it has nothing indexed rather than guessing."
    fi
  else
    warn "Maintenance manual not found — 'Ask the Manual' will say so instead of answering."
    warn "Put the PDF in ~/Downloads, or index it by hand:"
    warn "  cd server && npm run index-manual -- <path-to-manual.pdf>"
  fi
else
  ok "manual indexed ($MANUAL_PAGES passages)"
fi

# -------------------------------------------------------------------------- tls
# Camera and voice input are gated behind a secure context, and localhost is
# the only exemption — so a phone on the LAN needs real TLS or it silently
# loses hands-free entry. A self-signed certificate is enough: the phone warns
# once, then every browser API works.
step "TLS certificate"
CERT_DIR="$ROOT/server/certs"
TLS_KEY_PATH="$CERT_DIR/lan-key.pem"
TLS_CERT_PATH="$CERT_DIR/lan-cert.pem"

if [[ -n "$LAN_IP" ]] && { [[ ! -f "$TLS_CERT_PATH" ]] || ! openssl x509 -in "$TLS_CERT_PATH" -noout -text 2>/dev/null | grep -q "IP Address:$LAN_IP"; }; then
  mkdir -p "$CERT_DIR"
  if openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
       -keyout "$TLS_KEY_PATH" -out "$TLS_CERT_PATH" \
       -subj "/CN=$LAN_IP" \
       -addext "subjectAltName=IP:$LAN_IP,IP:127.0.0.1,DNS:localhost" >/dev/null 2>&1; then
    ok "generated a certificate for $LAN_IP"
  else
    warn "could not generate a certificate — falling back to plain HTTP"
    warn "camera and voice input will be unavailable on the LAN address"
  fi
else
  [[ -f "$TLS_CERT_PATH" ]] && ok "using the existing certificate for $LAN_IP"
fi

if [[ -f "$TLS_KEY_PATH" && -f "$TLS_CERT_PATH" ]]; then
  export TLS_KEY_PATH TLS_CERT_PATH
  SCHEME="https"
else
  SCHEME="http"
fi

# ----------------------------------------------------------------------- server
step "Starting the server on :$PORT"
lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null
( cd server && NODE_ENV=production PORT="$PORT" node --experimental-strip-types src/index.ts \
    >/tmp/wrs_pilot_server.log 2>&1 ) &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -skf "$SCHEME://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -skf "$SCHEME://localhost:$PORT/api/health" >/dev/null 2>&1 \
  || die "server did not come up — see /tmp/wrs_pilot_server.log"
ok "API healthy"

curl -skf "$SCHEME://localhost:$PORT/" 2>/dev/null | grep -qi '<div id="root"' \
  && ok "client is being served on the same origin" \
  || warn "the built client did not load — check that client/dist exists"

# ----------------------------------------------------------------------- tunnel
# Wrapped in a function so a dropped tunnel can be re-established without
# taking the server down with it. localtunnel in particular drops fairly
# often, and losing an inspection session because of that would be absurd.
TUNNEL_KIND=""
# Set once a provider is proven to route on this network, so a reconnect does
# not go back to one that already failed.
WORKING_KIND=""
start_tunnel() {
  # $1 optionally forces a kind ("cloudflared" | "localtunnel"); default: prefer
  # cloudflared when installed.
  local want="${1:-auto}"
  PUBLIC_URL=""
  : > /tmp/wrs_pilot_tunnel.log

  if [[ "$want" != "localtunnel" ]] && command -v cloudflared >/dev/null 2>&1; then
    TUNNEL_KIND="cloudflared"
    cloudflared tunnel --url "$SCHEME://localhost:$PORT" --no-autoupdate \
      >/tmp/wrs_pilot_tunnel.log 2>&1 &
    TUNNEL_PID=$!
    for _ in $(seq 1 40); do
      PUBLIC_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/wrs_pilot_tunnel.log 2>/dev/null | head -1)"
      [[ -n "$PUBLIC_URL" ]] && break
      sleep 1
    done
  else
    TUNNEL_KIND="localtunnel"
    npx --yes localtunnel --port "$PORT" >/tmp/wrs_pilot_tunnel.log 2>&1 &
    TUNNEL_PID=$!
    for _ in $(seq 1 45); do
      PUBLIC_URL="$(grep -oE 'https://[a-z0-9-]+\.loca\.lt' /tmp/wrs_pilot_tunnel.log 2>/dev/null | head -1)"
      [[ -n "$PUBLIC_URL" ]] && break
      sleep 1
    done
  fi
}

# The URL appearing is not the same as the tunnel being usable — cloudflared in
# particular publishes its hostname ~20s before the edge can route to it.
# Handing someone a link that 404s is worse than making them wait.
wait_for_tunnel() {
  [[ -z "$PUBLIC_URL" ]] && return 1
  local i code
  for i in $(seq 1 20); do
    code="$(curl -s -o /dev/null -w '%{http_code}' \
              -H 'bypass-tunnel-reminder: 1' \
              "$PUBLIC_URL/api/health" --max-time 10 2>/dev/null)"
    [[ "$code" == "200" ]] && return 0
    sleep 3
  done
  return 1
}

step "Opening a public HTTPS tunnel"
if ! command -v cloudflared >/dev/null 2>&1; then
  warn "cloudflared not installed — falling back to localtunnel via npx."
  warn "localtunnel drops often and shows a one-time click-through page."
  warn "Strongly recommended:  brew install cloudflared"
fi

start_tunnel

if [[ -z "$PUBLIC_URL" ]]; then
  warn "Could not read a public URL from the tunnel (see /tmp/wrs_pilot_tunnel.log)."
  warn "The app is still reachable on this machine at http://localhost:$PORT"
else
  say "waiting for the tunnel to start routing…"
  if wait_for_tunnel; then
    WORKING_KIND="$TUNNEL_KIND"
    ok "tunnel is live via $TUNNEL_KIND and serving"
  else
    # A registered-but-unroutable tunnel is worse than a slower one that works,
    # so fall back to the other provider rather than handing over a dead link.
    warn "$TUNNEL_KIND published a URL but never started routing."
    if [[ "$TUNNEL_KIND" == "cloudflared" ]]; then
      warn "falling back to localtunnel…"
      kill "$TUNNEL_PID" 2>/dev/null
      for _ in $(seq 1 10); do
        kill -0 "$TUNNEL_PID" 2>/dev/null || break
        sleep 1
      done
      sleep 2
      start_tunnel localtunnel
      if wait_for_tunnel; then
        WORKING_KIND="$TUNNEL_KIND"
        ok "tunnel is live via $TUNNEL_KIND and serving"
      else
        warn "neither tunnel routed — the app still works locally at http://localhost:$PORT"
      fi
    else
      warn "the app still works locally at http://localhost:$PORT"
    fi
  fi
fi

# ------------------------------------------------------------------------- brief
cat <<BRIEF

${BLD}────────────────────────────────────────────────────────────────${NC}
${BLD}  OPEN THIS ON THE PHONE OR TABLET${NC}

  ${BLD}1. On the same Wi-Fi — stable, recommended${NC}

     ${GRN}${SCHEME}://${LAN_IP:-<no LAN address found>}:${PORT}${NC}

     Nothing to drop, and nothing between the phone and this machine.
     The certificate is self-signed, so the browser warns once — accept it
     and continue. Camera, QR scanning and hands-free voice entry all work
     after that.

  ${BLD}2. From anywhere — needed for Raipur, but drops often${NC}

     ${GRN}${PUBLIC_URL:-<no public URL — see the log>}${NC}

     Free tunnel. If it returns 503 the URL has changed — check this
     terminal for a new one.

${BLD}  Sign in${NC}
     inspector1  / password123    (shop-floor view)
     supervisor1 / password123    (pipeline, gate, learning)
     admin1      / password123    (everything + user accounts)

${BLD}  Worth testing on the real device — these cannot be tested here${NC}
     1. Add to Home Screen, then open it from the icon
     2. Spring Batch — is manual entry fast enough with gloves on?
     3. QR scan on a real wagon plate or component tag
     4. Photograph a genuinely condemned component (mandatory now)
     5. Switch to Hindi and re-walk the same screens
     6. Turn airplane mode on mid-inspection, save a reading, turn it back
        on — the queue should sync on its own
     7. Ask the Manual: "brake block condemning limit"

${BLD}  The question that matters most${NC}
     How is spring free height actually measured at Raipur? If it is a
     manual gauge with no digital display, the app is now built for that —
     please confirm the flow matches what an inspector really does.

${YEL}  Ctrl-C stops the server and closes the tunnel.${NC}
${BLD}────────────────────────────────────────────────────────────────${NC}

BRIEF

# Watchdog. The server dying is fatal; the tunnel dying is not — reconnect it
# and carry on, because the inspection data lives on the server, not the tunnel.
TUNNEL_RESTARTS=0
while true; do
  sleep 5

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    warn "the server exited — see /tmp/wrs_pilot_server.log"
    cleanup
  fi

  if [[ -n "$TUNNEL_PID" ]] && ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    TUNNEL_RESTARTS=$((TUNNEL_RESTARTS + 1))
    warn "tunnel dropped (#$TUNNEL_RESTARTS) — reconnecting; the server is untouched"
    OLD_URL="$PUBLIC_URL"
    start_tunnel "${WORKING_KIND:-auto}"
    if ! wait_for_tunnel && [[ -n "$WORKING_KIND" ]]; then
      # Even the known-good provider can stall; try the other one before giving up.
      warn "$TUNNEL_KIND did not come back — trying the alternative"
      kill "$TUNNEL_PID" 2>/dev/null
      for _ in $(seq 1 10); do kill -0 "$TUNNEL_PID" 2>/dev/null || break; sleep 1; done
      sleep 2
      start_tunnel "$([[ "$WORKING_KIND" == "localtunnel" ]] && echo cloudflared || echo localtunnel)"
      wait_for_tunnel || true
    fi
    if [[ -n "$PUBLIC_URL" ]]; then
      if [[ "$PUBLIC_URL" != "$OLD_URL" ]]; then
        printf '\n%s  THE URL CHANGED — reopen this on the device:%s\n' "${BLD}" "${NC}"
        printf '     %s%s%s\n\n' "${GRN}" "$PUBLIC_URL" "${NC}"
      else
        ok "tunnel back up on the same URL"
      fi
    else
      warn "could not re-establish the tunnel; retrying in 15s"
      warn "the app is still running locally at http://localhost:$PORT"
      sleep 15
    fi
  fi
done
