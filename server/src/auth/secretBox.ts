/**
 * Application-layer encryption for secrets held in the database
 * Indian Railways WRS Raipur
 *
 * The SQLite file is not encrypted — `node:sqlite` has no support for it, and
 * protecting the file is a host concern (see docs/SECURITY_POSTURE.md). That is
 * an acceptable posture for inspection records, which are sensitive but not
 * secret.
 *
 * A TOTP secret is different. It is a credential: anyone holding it can
 * generate valid codes for that supervisor indefinitely, and unlike a password
 * hash it cannot be one-way. Storing enrolment secrets in the clear would mean
 * a single copied backup hands over every supervisor's second factor — which
 * would make the second factor worth less than not having one, because it
 * would be trusted.
 *
 * So these are sealed with AES-256-GCM under a key derived from the server
 * secret. GCM is authenticated, so a tampered ciphertext fails to open rather
 * than decrypting to rubbish that then gets used.
 */

import crypto from 'node:crypto';
import { config } from '../config/index.ts';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

/**
 * Derives the encryption key from the server secret.
 *
 * A fixed salt is used deliberately: the key must be reproducible across
 * restarts or nothing sealed before the restart could be opened after it. The
 * secrecy here rests on JWT_SECRET, which the server already refuses to start
 * without in production.
 */
function key(): Buffer {
  return crypto.hkdfSync(
    'sha256',
    Buffer.from(config.jwtSecret, 'utf8'),
    Buffer.from('wrs-raipur-secretbox-v1', 'utf8'),
    Buffer.from('totp-secret-encryption', 'utf8'),
    32
  ) as unknown as Buffer;
}

/** Seals a value. Output is safe to store as text. */
export function seal(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Opens a sealed value, or returns null.
 *
 * Returns null rather than throwing for anything that is not openable —
 * tampered, truncated, or sealed under a different server secret. A caller
 * that cannot read a credential should treat the user as not enrolled and say
 * so, not crash the endpoint.
 */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    return null;
  }
}
