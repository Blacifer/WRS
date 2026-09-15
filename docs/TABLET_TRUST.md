# Making a tablet trust the workshop PC

One job, done once per tablet, taking about two minutes. After it, the
browser on that tablet opens `https://<PC address>:3000` with no warning, and
the camera, the microphone and offline reload all work.

## Why this is needed

A browser hands a web page the camera only from a *secure context* — `https`,
or `localhost`. The tablets reach the PC over the shop wifi, not as localhost,
so the PC must serve `https`. It does: the first time `START.cmd` runs it
makes a certificate for this PC's own address, with Node alone, and serves
with it from then on.

That certificate is *self-signed*: nobody outside the workshop vouches for it.
A browser meeting it for the first time therefore warns — "Your connection is
not private" — and will let you proceed, but it will warn again, and a warning
people learn to click through is worse than none. Installing the certificate
on the tablet as a trusted one is what removes the warning for good. It says,
in effect, "this tablet trusts this PC", which is exactly the truth.

## What to copy

On the PC, in the folder you installed to:

    server\certs\lan-cert.crt

That is the certificate in the form tablets install from a tap. (`lan-cert.pem`
is the same certificate for the server; `lan-key.pem` is the private key and
**never leaves the PC**.)

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
   full trust for "WRS Raipur workshop server".
4. Open Safari at `https://<PC address>:3000`.

## Windows (a second PC or laptop)

Double-click `lan-cert.crt` → **Install Certificate** → **Local Machine** →
**Place all certificates in the following store** → **Trusted Root
Certification Authorities**.

## When it stops working

- **The warning is back on every tablet.** The PC's address has changed
  (a new router, a new DHCP lease). The certificate names the address it was
  made for. Give the PC a fixed address on the router, then on the PC delete
  `server\certs\` and run `START.cmd` again — it makes a new certificate —
  and install the new `lan-cert.crt` on each tablet.
- **The warning is back on one tablet.** That tablet was reset, or its
  certificate was removed. Install it again.
- **It says the certificate expired.** They last 825 days. Same fix as a
  changed address: delete `server\certs\`, restart, reinstall.

## What this does not do

It does not encrypt anything beyond the wifi hop, does not prove the PC's
identity to anyone outside the workshop, and is not a substitute for a
certificate from a real authority if the app is ever reachable from outside
the LAN. `docs/SECURITY_POSTURE.md` §2 says the rest.
