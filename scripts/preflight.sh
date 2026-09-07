#!/usr/bin/env bash
#
# Everything that can be checked before this goes in front of the shop.
# Indian Railways WRS Raipur
#
# WHY THIS EXISTS
# ---------------
# There are six things worth running before a deployment and they live in six
# places: three test suites, a type check, a production build, and three
# drills that the suites structurally cannot replace. Six things to remember
# is how the offline drill went stale — nobody skipped it on purpose, it just
# was not on any list.
#
# So this is the list. It runs everything it can, says plainly what it could
# not run and why, and refuses to end on a cheerful note when something failed.
#
#   bash scripts/preflight.sh
#
# The browser drills need Playwright and a running server. When either is
# missing they are reported as NOT RUN rather than skipped quietly — an
# unrun check and a passing check are different things, and a script that
# blurs them is worse than no script.

set -uo pipefail
cd "$(dirname "$0")/.."

pass=0; fail=0; skipped=0
FAILED_NAMES=""
SKIPPED_NAMES=""

step() {
  local label="$1"; shift
  printf '  %-34s' "$label"
  if "$@" >/tmp/wrs_preflight_step.log 2>&1; then
    echo "PASS"; pass=$((pass + 1))
  else
    echo "FAIL"; fail=$((fail + 1)); FAILED_NAMES="$FAILED_NAMES\n    - $label"
    sed 's/^/      /' /tmp/wrs_preflight_step.log | tail -8
  fi
}

skip() {
  printf '  %-34s%s\n' "$1" "NOT RUN — $2"
  skipped=$((skipped + 1)); SKIPPED_NAMES="$SKIPPED_NAMES\n    - $1 ($2)"
}

# ---------------------------------------------------------------------------
# Node 22 or later, checked first.
#
# The server runs TypeScript directly with --experimental-strip-types, which
# older releases reject outright: `node: bad option`. Every step here then
# fails with the same unhelpful line and nothing says why.
#
# Found by running this script on a machine whose shell had resolved Node 20 —
# pilot-tunnel.sh already checks for exactly this, and the check belonged here
# too.
# ---------------------------------------------------------------------------
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo
  echo "  Node 22 or later is required (found $(node -v 2>/dev/null || echo none))."
  echo "  The server runs TypeScript directly and older releases reject the flag."
  echo "  If you use nvm:  nvm use 22"
  exit 1
fi

echo
echo "  WRS Raipur — preflight"
echo "  ----------------------"

step "Type check"                 npm run typecheck
step "Server suite"               npm test --prefix server
step "Client suite"               npm test --prefix client
step "End-to-end tiers"           npm test
step "Production build"           npm run build

# The one drill that needs neither a browser nor a server. It guards the
# cross-process fault no suite can reach, so it is not optional.
step "Concurrent lifecycle drill" node --experimental-strip-types scripts/concurrent-lifecycle-drill.mjs

# ---------------------------------------------------------------------------
# The two that need a browser. Reported honestly rather than skipped silently.
#
# Both need the API as well as a page to load, and the API is checked
# separately: when :3000 was down, both drills failed with a browser timeout
# and a SecurityError, neither of which says "the server is not running". A
# check that fails for a reason it cannot name costs more time than no check.
#
# The offline drill is then run against a PREVIEW OF THE BUILT CLIENT that
# this script starts itself. vite-plugin-pwa registers no service worker in
# dev, so against :5173 the reopen-while-offline step can never pass — which
# meant the drill was skipped in every ordinary run. Skipping it every time is
# how it went stale in the first place, so the gate now makes its own
# conditions rather than waiting for someone to arrange them.
# ---------------------------------------------------------------------------
PREVIEW_PID=""
stop_preview() {
  if [ -n "$PREVIEW_PID" ]; then kill "$PREVIEW_PID" 2>/dev/null; PREVIEW_PID=""; fi
}
trap stop_preview EXIT

if ! node -e "import('playwright')" >/dev/null 2>&1; then
  skip "Role walkthrough" "playwright not installed"
  skip "Offline drill"    "playwright not installed"
elif ! curl -s -o /dev/null --max-time 2 http://localhost:3000/api/health; then
  skip "Role walkthrough" "the API is not answering on :3000"
  skip "Offline drill"    "the API is not answering on :3000"
else
  if curl -s -o /dev/null --max-time 2 http://localhost:5173; then
    step "Role walkthrough" node scripts/role-walkthrough.mjs
  else
    skip "Role walkthrough" "nothing serving on :5173"
  fi

  # The production build ran above, so client/dist is current.
  if [ -f client/dist/sw.js ]; then
    npm run preview --prefix client >/tmp/wrs_preflight_preview.log 2>&1 &
    PREVIEW_PID=$!
    preview_up=0
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if curl -s -o /dev/null --max-time 2 http://localhost:4173; then preview_up=1; break; fi
      sleep 1
    done
    if [ "$preview_up" -eq 1 ]; then
      DRILL_URL=http://localhost:4173 step "Offline drill" node scripts/offline-drill.mjs
    else
      skip "Offline drill" "the preview server did not come up on :4173"
    fi
    stop_preview
  else
    skip "Offline drill" "client/dist/sw.js missing — the production build did not produce a service worker"
  fi
fi

echo
echo "  ----------------------"
printf '  %d passed, %d failed, %d not run\n' "$pass" "$fail" "$skipped"
[ -n "$FAILED_NAMES" ]  && printf '  failed:%b\n'  "$FAILED_NAMES"
[ -n "$SKIPPED_NAMES" ] && printf '  not run:%b\n' "$SKIPPED_NAMES"

echo
if [ "$fail" -gt 0 ]; then
  echo "  NOT READY — fix the failures above."
  exit 1
fi
if [ "$skipped" -gt 0 ]; then
  echo "  Everything that ran, passed — but $skipped check(s) did not run."
  echo "  Start the app (bash scripts/pilot-tunnel.sh) and run this again to cover them."
  exit 0
fi
echo "  READY — everything ran and everything passed."
