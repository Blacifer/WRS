# Making a tablet trust the workshop PC

One job, done once per tablet, taking about two minutes. After it, the
browser on that tablet opens `https://<PC address>:3000` with no warning, and
the camera, the microphone and offline reload all work.

## Why this is needed

A browser hands a web page the camera only from a *secure context* — `https`,
or `localhost`. The tablets reach the PC over the shop wifi, not as localhost,
so the PC must serve `https`. It does: the first time `START.cmd` runs it
makes, with Node alone, the **workshop's own certificate authority** (a CA)
and a server certificate signed by it for this PC's addresses. Every later
start reissues the server certificate if the PC's address has changed — a
new DHCP lease, a different Wi‑Fi, a phone hotspot — without touching the CA.

Nobody outside the workshop vouches for that CA, so a browser meeting it for
the first time warns — "Your connection is not private" — and will let you
proceed, but it will warn again, and a warning people learn to click through
is worse than none. Installing the CA on the tablet as a trusted one removes
the warning for good, **for every address the PC will ever have**. It says,
in effect, "this tablet trusts this workshop", which is exactly the truth.

## What to copy

On the PC, in the folder you installed to:

    server\certs\lan-cert.crt

That is the workshop CA in the form tablets install from a tap. It is the
only file that ever leaves the PC. (`lan-cert.pem` and `lan-key.pem` are the
server's own certificate and key; `lan-ca-key.pem` is the CA's key; **none of
those leave the PC**.)

Get `lan-cert.crt` onto the tablet however is easiest: a USB cable, or an
email to an account the tablet reads. (The app deliberately does not offer
the certificate for download from itself — a page that hands out the thing
that makes it trusted is the wrong page to trust for it.)

## Android (Chrome)

1. **Settings → Security & privacy → More security settings → Encryption &
   credentials → Install a certificate → CA certificate.** (Exact wording
   varies by maker; search Settings for "CA certificate".)
2. Tap **Install anyway** on the warning about CA certificates — this is the
   one time that warning is right to accept, because the certificate is the
   workshop's own.
3. Pick `lan-cert.crt`.
4. Open Chrome and go to `https://<PC address>:3000`. No warning. Add it to
   the home screen from Chrome's menu, so it opens like an app.

## iPad (Safari)

1. Open `lan-cert.crt` (from Files or Mail). iOS says a profile was
   downloaded.
2. **Settings → Profile Downloaded → Install**, and enter the passcode.
3. **Settings → General → About → Certificate Trust Settings**, and switch on
   full trust for **"WRS Raipur workshop CA"**. Without this switch iOS keeps
   the profile but does not trust it, and Safari still warns.
4. Open Safari at `https://<PC address>:3000`. Share → **Add to Home Screen**.

## Windows (the demonstration laptop, the shop PC's own browser, a second PC)

The PC that runs the server shows "Not secure" in its own browser for the same
reason a tablet does: the certificate is the shop's own, not from an
authority the browser was born trusting. One install fixes it for good:

Double-click `server\certs\lan-cert.crt` → **Install Certificate** →
**Local Machine** → **Place all certificates in the following store** →
**Browse → Trusted Root Certification Authorities** → Finish. Close every
browser window and open the address again: the padlock is closed and the
warning is gone. Do this on the demonstration laptop the evening before, so
the projector never shows a red "Not secure".

## macOS (rehearsing on a Mac)

One command, once (the rehearsal keeps its certificates in `.rehearsal-certs/`;
the bundle keeps them in `server/certs/`):

    security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db .rehearsal-certs/lan-ca.pem

Or by hand: double-click `lan-ca.pem` → Keychain Access → *login* →
double-click "WRS Raipur workshop CA" → **Trust** → *When using this
certificate:* **Always Trust** → close and enter your password. Restart the
browser. Safari and Chrome then show the padlock; Firefox keeps its own store
(*Settings → Privacy → Certificates → View → Import*).

**A phone on its own internet cannot reach this address at all.**
`192.168.1.x` is an address inside one Wi‑Fi; mobile data is a different
network with no road to it. "This page isn't working" from a phone on mobile
data is the network, not the app. Join the same Wi‑Fi as the PC (and turn
mobile data off so Android does not drift back to it — next section).

## Two Android habits that look like the app failing

Found on the first phone that tried the rehearsal (18 Sep 2026):

1. **"Proceed anyway" is not trust.** If the certificate is only clicked
   past, the page loads but the browser refuses to keep the app for offline
   use — no service worker, no camera, no queue. Turn Wi‑Fi off and the app
   simply does not open. Installing the `.crt` as above is what makes the
   offline copy and the camera possible; there is no shortcut.
2. **A Wi‑Fi with no internet gets abandoned.** Android decides the shop's
   Wi‑Fi is "no internet" and quietly routes everything over mobile data —
   which cannot reach the shop PC. The page then "stops loading" even though
   Wi‑Fi shows connected. Two fixes, either is enough: on the tablet, open
   *Settings → Wi‑Fi → (the network) → Advanced* and turn on **"Connect even
   when the network has no internet"** (wording varies by make), or simply
   **turn mobile data off** on the shop tablets — they do not need it. Do this
   the evening before, with the certificate.

## When it stops working

- **The PC's address has changed** (a new router, a new DHCP lease, a
  hotspot). Close the `START.cmd` window and open it again: it reissues the
  server certificate for the new address by itself, signed by the same CA.
  Nothing to install on any tablet. (On the Mac: `bash scripts/rehearsal.sh
  stop`, then `start`.)
- **The warning is back on one tablet.** That tablet was reset, or its
  certificate was removed, or on an iPad the *Certificate Trust Settings*
  switch was never turned on. Install it again.
- **It says the certificate expired.** The server certificate lasts 825 days
  and is reissued on the next start once it is within thirty days of expiry;
  the CA lasts ten years. Nothing to reinstall.
- **Tablets that trusted the old, single certificate** (before 21 Sep 2026)
  must install the new `lan-cert.crt` once — it is a different thing, the CA.

## What this does not do

It does not encrypt anything beyond the wifi hop, does not prove the PC's
identity to anyone outside the workshop, and is not a substitute for a
certificate from a real authority if the app is ever reachable from outside
the LAN. `docs/SECURITY_POSTURE.md` §2 says the rest.
