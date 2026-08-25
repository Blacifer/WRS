# Security Posture

What this system protects, what it does not, and where the gaps are. Written
plainly so that nobody deploying it has to guess, and so a CERT-In auditor is
not the first person to discover any of it.

The short version: **integrity is strong, confidentiality is weak.** The system
is very good at proving that a record has not been altered. It does almost
nothing to stop someone who obtains the database file from reading it.

---

## What is protected, and how

| Concern | Mechanism | Assessment |
|---|---|---|
| Password storage | PBKDF2-HMAC-SHA512, 16-byte random salt per password, 210,000 iterations, constant-time comparison | Sound. Matches OWASP guidance. |
| Session tokens | JWT, HS256 over the server secret | Sound for a single server. |
| Record integrity | SHA-256 hash chain over every audit event, covering actor and role | Strong, and verifiable at `GET /api/audit/verify`. |
| Record immutability | 16 database-level `RAISE(ABORT)` triggers | Strong. Enforced by the storage engine, not the application. |
| Release certificates | Keyed HMAC-SHA256 over canonical contents, re-derivable from the stored record | Strong as an integrity proof. **Not** a legal digital signature — see below. |
| One-time codes | `crypto.randomInt`, stored as a keyed HMAC, constant-time comparison, 5-minute expiry, single use | Sound as a confirmation step. Not a second factor — see below. |
| Login abuse | 5 failures locks that username-and-address pair for 15 minutes; identical response whether or not the user exists | Sound. |
| Injection | Bound parameters throughout; no interpolated user input in SQL | Sound. |
| Request flooding | Body size limit enforced at 10 MB | Sound. |
| Transport | TLS, self-signed certificate for LAN use | Encrypted, but unauthenticated — see below. |

---

## What is NOT protected

These are real and should be read before deployment, not after.

### 1. The database is not encrypted at rest

`server/data/wrs_inspections.db` is a plaintext SQLite file. Anyone who obtains
it — a stolen laptop, a copied backup, a misconfigured share — can read
everything in it with freely available tools:

- every defect photograph (stored base64 inside the file)
- every inspection, checklist verdict and release certificate
- names, employee IDs and roles
- the complete audit trail

Password hashes are in there too, but those are separately protected by PBKDF2
and are the *least* exposed thing in the file.

The hash chain does not help here. It proves nobody **changed** the data. It
does nothing to stop someone **reading** it.

**What to do about it.** `node:sqlite` has no encryption support, so this is an
operating-system concern rather than an application one:

- Full-disk encryption on the host (LUKS on Linux, BitLocker on Windows).
- Encrypted backups — `backup-db.sh` currently produces plaintext copies, and
  those copies are as sensitive as the original.
- File permissions restricting the database to the service account.

None of that is difficult. It just has to be decided and done.

### 2. TLS is self-signed

Traffic is encrypted, so a passive listener on the workshop wifi learns
nothing. But a self-signed certificate proves no identity, so users are trained
to click through a browser warning — which is exactly the habit that makes an
interception attack work. For anything beyond a closed LAN pilot, use a
certificate from a real authority.

### 3. The OTP is not a second factor

`/auth/request-otp` returns the code in its own response, because no SMS
gateway is integrated. Possession of nothing extra is proven. It is a
deliberate, audited, two-step confirmation — genuinely useful for preventing a
careless release — but it is not multi-factor authentication and should not be
described as such. `OTP_DELIVERY` in the environment makes the posture explicit.

### 4. The certificate HMAC is not a legal signature

It proves the certificate has not been altered and that this server produced
it. Under the IT Act 2000, a legally recognised digital signature needs a
certificate from a CCA-licensed Certifying Authority. If release certificates
are ever to carry legal weight outside the workshop, that is the gap — and it
is an integration rather than a rewrite, since the canonical content already
being HMAC'd is exactly what a DSC would sign.

### 5. There is no encryption of data in transit to backups or exports

Anything exported leaves the system's protection entirely.

---

## Things that were found and fixed

Recorded because they indicate the kind of fault worth looking for, and because
a posture document that lists only strengths is not worth reading.

- **Password work factor of 10,000 iterations** — about 22 ms per guess for
  anyone holding the file. Now 210,000.
- **One-time codes hashed with unsalted SHA-256.** A six-digit code has 900,000
  possibilities; recovering one from its stored digest was measured at **812
  milliseconds**. Now a keyed HMAC.
- **OTP codes drawn from `Math.random`**, which is predictable from prior
  output. Now `crypto.randomInt`.
- **Hardcoded OTP codes `123456` and `739201`** accepted in every environment,
  in a public repository. Now refused outside development.
- **Fixed OTP action tokens** (`valid_otp_token` and others) accepted in every
  environment. Now refused outside development.
- **An unsalted SHA-256 password fallback** silently accepted whenever a stored
  hash was not PBKDF2. Removed.
- **No login throttling at all.** Now rate-limited.
- **`express.json({ limit: '10mb' })` accepted the option and ignored it** — no
  body size limit existed. Now enforced.
- **Five places conjured user accounts** with a password of `'none'` when the
  actor was unknown, one of them taking the role from the caller. All removed.
- **The audit hash did not cover `user_role`**, so an action could be
  re-attributed without breaking the chain. Now covered.
- **Release sign-off**: OTP was optional, the "signature" was random bytes, and
  the signatory fell back to a hardcoded demo user. All fixed.

---

## Before a government deployment

`deploy/README.md` covers this in more detail. In short: a CERT-In empanelled
security audit, GIGW compliance, and a decision on hosting (CRIS/RailTel rather
than NIC, most likely) are each separate exercises with their own lead times.
Start them before the code is finished, not after.
