/**
 * Time-Based One-Time Passwords (RFC 6238)
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The supervisor OTP was not a second factor. `/auth/request-otp` generated a
 * code and returned it in its own response, because no SMS gateway is
 * integrated — so possession of nothing extra was proven, and anyone who could
 * call the endpoint received the code.
 *
 * TOTP fixes that without procuring anything. The code is generated on the
 * supervisor's own phone from a secret shared once, at enrolment, by QR scan.
 * After that the secret never crosses the network again.
 *
 * WHY THIS RATHER THAN SMS
 * ------------------------
 * A workshop LAN has no reliable outside connectivity, so an SMS may simply
 * never arrive — and a second factor that fails when the network does is not
 * one you can depend on at a release gate. TOTP needs only the device clock.
 * It also costs nothing per use, which matters in a shop signing off many
 * wagons a day, and RFC 6238 is a published standard an auditor recognises
 * rather than something bespoke that has to be defended.
 *
 * IMPLEMENTED HERE RATHER THAN TAKEN FROM A LIBRARY
 * -------------------------------------------------
 * The algorithm is small and completely specified, and this avoids adding a
 * dependency to a system that will go through a government security audit.
 * Correctness is not asserted — it is proved against the test vectors printed
 * in RFC 4648 (base32) and RFC 6238 Appendix B (TOTP), in totp.test.ts.
 */

import crypto from 'node:crypto';

/** RFC 4648 base32 alphabet, as used by every authenticator app. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  // Authenticator apps accept unpadded secrets, and padding only makes the
  // string a person may have to type by hand longer.
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new enrolment secret. 20 bytes is the RFC 4226 recommendation. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export interface TotpOptions {
  /** Seconds per code. 30 is the universal default. */
  step?: number;
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
  /** Unix seconds; defaults to now. */
  now?: number;
}

/**
 * HOTP (RFC 4226) — the counter-based primitive TOTP is built on.
 */
function hotp(secret: Buffer, counter: number, digits: number, algorithm: string): string {
  const buf = Buffer.alloc(8);
  // Counter is 64-bit big-endian. Written as two 32-bit halves because
  // bitwise operators in JS are 32-bit, and shifting a 64-bit value with them
  // silently truncates.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);

  const digest = crypto.createHmac(algorithm, secret).update(buf).digest();

  // Dynamic truncation, RFC 4226 §5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** The code that should be showing on the supervisor's phone right now. */
export function generateTotp(secretBase32: string, options: TotpOptions = {}): string {
  const step = options.step ?? 30;
  const digits = options.digits ?? 6;
  const algorithm = options.algorithm ?? 'sha1';
  const now = options.now ?? Math.floor(Date.now() / 1000);
  return hotp(base32Decode(secretBase32), Math.floor(now / step), digits, algorithm);
}

/**
 * Verifies a code, allowing for clock drift.
 *
 * `window` is how many 30-second steps either side are accepted. One step —
 * the default — tolerates up to about a minute of drift between the phone and
 * the server, which is what unsynchronised devices actually exhibit. Widening
 * it further trades security for convenience: every extra step is another
 * valid code at any moment.
 *
 * Comparison is constant-time so the response cannot be timed to recover a
 * code digit by digit.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: TotpOptions & { window?: number } = {}
): boolean {
  const trimmed = (code || '').replace(/\s/g, '');
  const digits = options.digits ?? 6;
  if (!new RegExp(`^\\d{${digits}}$`).test(trimmed)) return false;

  const step = options.step ?? 30;
  const algorithm = options.algorithm ?? 'sha1';
  const window = options.window ?? 1;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / step);
  const secret = base32Decode(secretBase32);

  const provided = Buffer.from(trimmed);
  for (let offset = -window; offset <= window; offset++) {
    const candidate = Buffer.from(hotp(secret, counter + offset, digits, algorithm));
    if (candidate.length === provided.length && crypto.timingSafeEqual(candidate, provided)) {
      return true;
    }
  }
  return false;
}

/**
 * The enrolment URI an authenticator app reads from a QR code.
 *
 * The issuer and account name are what the supervisor will see in their app,
 * so they need to identify both the system and the person — a phone with
 * several work accounts on it is common.
 */
export function buildTotpUri(params: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? 'WRS Raipur QC';
  const label = encodeURIComponent(`${issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30'
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
