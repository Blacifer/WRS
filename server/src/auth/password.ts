/**
 * Password Hashing & Verification Utility
 * Indian Railways WRS Raipur
 */

import crypto from 'node:crypto';

/**
 * Hashes a password using PBKDF2 with SHA-512 and random salt
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 10000;
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

  // Handle plain SHA-256 fallback or legacy hash
  const shaHash = crypto.createHash('sha256').update(password).digest('hex');
  if (storedHash === shaHash) {
    return true;
  }

  return false;
}
