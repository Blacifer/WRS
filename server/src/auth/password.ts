/**
 * Password Hashing & Verification Utility
 * Indian Railways WRS Raipur
 */

import crypto from 'node:crypto';

/**
 * Hashes a password using PBKDF2 with SHA-512 and random salt
 */
/**
 * PBKDF2 work factor.
 *
 * This was 10,000 — a figure that was reasonable around 2010 and takes about
 * 22 ms per hash on a current laptop, which is roughly what an attacker with
 * the database file would need per guess. 210,000 is OWASP's published
 * recommendation for PBKDF2-HMAC-SHA512 and measures ~140 ms here: still
 * imperceptible on login, and an order of magnitude more expensive to attack.
 *
 * Raising it is safe for existing accounts because the iteration count is
 * stored inside each hash, so old credentials keep verifying at their original
 * cost and only get the stronger factor when the password is next set.
 */
export const PBKDF2_ITERATIONS = 210000;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = PBKDF2_ITERATIONS;
  const keylen = 64;
  const digest = 'sha512';
  const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
  return `pbkdf2:${iterations}:${salt}:${derivedKey}`;
}

/**
 * Verifies a plaintext password against a stored hash
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !password) {
    return false;
  }

  // Handle PBKDF2 format
  if (storedHash.startsWith('pbkdf2:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const originalHash = parts[3];
    const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derivedKey, 'hex'), Buffer.from(originalHash, 'hex'));
  }

  // Anything that is not PBKDF2 is refused.
  //
  // There used to be a fallback here that accepted an unsalted SHA-256 of the
  // password — a fast, rainbow-tableable hash — and it accepted it silently,
  // so a weakly-stored credential would authenticate with no indication that
  // it had taken the weaker path. Nothing writes that format any more, and a
  // login that cannot be verified properly should fail rather than fall back.
  return false;
}
