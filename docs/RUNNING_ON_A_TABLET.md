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
npm run demo                # seeds, starts both servers, and opens a tunnel
```

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
| Service worker (install to home screen) | yes | **no** | yes |
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

One tunnel is enough for the whole app. It points at the Vite dev server on
:5173, and Vite proxies `/api` onward to the API on :3000 from inside the
machine — so the API rides the same HTTPS connection without a second tunnel
and without any CORS configuration.

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
