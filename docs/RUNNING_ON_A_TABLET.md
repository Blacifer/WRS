# Running it on a tablet

## The short version

On your laptop:

```
nvm use
npm run start:live          # http://localhost:5173
```

On a tablet, or anywhere that isn't the laptop itself:

```
nvm use
bash scripts/pilot-tunnel.sh   # builds the client, serves it, opens a tunnel
```

Use `scripts/pilot-tunnel.sh`, not `npm run demo`, for anything that has to
behave like the real thing. `npm run demo` runs the Vite **dev** server, and
`vite-plugin-pwa` is configured here without `devOptions` — so in dev **no
service worker is registered at all**. Measured, not assumed: registrations
under the dev server, 0; under the built client, 1.

What that costs is the half of offline-first that people actually notice.
The IndexedDB queue still works in dev, so sorting survives a dropped
connection — but close the tab while offline and the app cannot reload,
because nothing is cached to serve it. `scripts/pilot-tunnel.sh` builds the
client first and serves it from the API server, which is the production
topology and the one to demonstrate.

`npm run demo` prints a line like:

```
https://something-random-words.trycloudflare.com
```

Open that on the tablet. It changes every time the tunnel restarts, which is
fine for testing and is the reason it is not written down anywhere.

## Why a tunnel, and not just the laptop's IP address

A tablet can reach `http://192.168.1.19:5173` over the shop wifi and the app
will load. Three things will then be missing, and none of them announce
themselves:

| | localhost | `http://192.168.x.x` | through the tunnel |
|---|---|---|---|
| Secure context | yes | **no** | yes |
| Camera API exists | yes | **no** | yes |
| Service worker (install to home screen) | built client only | **no** | built client only |
| Offline sorting queue | yes | yes | yes |

Measured, not assumed. On a plain-HTTP address that isn't localhost,
`navigator.mediaDevices.getUserMedia` is not blocked — it **does not exist**.
So the spring evidence camera, the caliper OCR and the QR scanner are simply
absent, and the code that would use them never runs.

The offline sorting queue is the exception and keeps working, because it is
IndexedDB, which browsers allow on insecure origins. An inspector on a plain
LAN address can still sort springs and survive a dropped connection. They just
cannot photograph anything.

## What the tunnel actually carries

One tunnel is enough for the whole app, either way it is served.

Under `scripts/pilot-tunnel.sh` the API server serves the built client itself,
so the app and `/api` are one origin behind one tunnel — nothing to proxy and
no CORS to configure.

Under `npm run demo` the tunnel points at the Vite dev server on :5173 and Vite
proxies `/api` onward to the API on :3000 from inside the machine, which gets
the same single-connection result — but with no service worker, as above.

`client/vite.config.ts` already allows `.trycloudflare.com` in `allowedHosts`.
Without that entry Vite answers a tunnelled request with "Blocked request.
This host is not allowed" rather than the app — it is a DNS-rebinding defence
and it is doing its job, so add a suffix there rather than disabling the check
if you switch tunnel providers.

## If the URL does not open

- **Give it a minute.** cloudflared says so itself: "it may take some time to
  be reachable". The hostname is new and has to propagate.
- **Try another DNS resolver.** On the machine that created it, the name may
  return NXDOMAIN from a resolver that cached the miss, while resolving fine
  elsewhere. That is a caching artefact, not a broken tunnel — the tablet is
  usually on a different resolver and unaffected.
- **Check cloudflared is on PATH.** `cloudflared --version`. Homebrew installs
  it to `/opt/homebrew/bin`.

## Before this leaves a test bench

A quick tunnel has no uptime guarantee and no access control — anybody with
the URL reaches the app, and the only thing between them and the data is the
login. That is acceptable for a demo on a shop floor for an afternoon. It is
not acceptable as the way the pilot runs.

For anything longer, use a named tunnel tied to a Cloudflare account with
Access in front of it, or put the app behind a real certificate on a machine
the workshop controls. `deploy/README.md` covers the hosting options.


## Keeping it up

The server handles SIGINT and SIGTERM: it stops accepting connections, folds
the write-ahead log back into the database, closes it, and exits. Ctrl+C is
the signal that actually arrives in a workshop, and it is handled — a second
Ctrl+C will not race the first, and a held-open connection cannot delay the
exit beyond five seconds.

It also stops deliberately on an unhandled rejection or an uncaught
exception, after logging the cause in full. That is a choice, not an
oversight. The router awaits every request handler and routes a thrown error
to the error middleware, so a failing request cannot bring the process down;
what remains is background work, and continuing after an unknown failure in
something that writes safety records risks writing them wrongly. A server
that is plainly down is a better failure than one that is quietly unreliable.

**Which means it needs something to restart it.** On a laptop, the simplest
honest answer is to run it from a terminal somebody can see. For anything
longer-lived, put it under whatever the host already has — `launchd` on
macOS, `systemd` on Linux — with `Restart=always`. Without that, a stop is a
stop, and the first anyone knows is an inspector saying the app will not load.


## Two drills to run before a deployment

Neither is part of `npm test` — both need Playwright, a running server and a
real browser — so both have to be run deliberately. The offline one had
already gone stale once by not being run, which is the failure mode of every
check that lives outside the suite.

```
node scripts/offline-drill.mjs      # sort offline, close the tab, reconnect
node scripts/role-walkthrough.mjs   # every role, every screen
```

The first needs a BUILT client, for the service worker. The second runs
against either.
