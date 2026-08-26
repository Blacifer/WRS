/**
 * Signing release certificates
 * Indian Railways WRS Raipur
 *
 * WHY NOT AN HMAC
 * ---------------
 * Certificates used to be signed with HMAC-SHA256 keyed on the server secret.
 * That is a real signature and it does detect alteration, but it has a
 * property that matters here: verifying requires the same key that signs.
 *
 * A release certificate is the document asserting that a named supervisor
 * found a particular wagon fit to leave. The people who will eventually want
 * to check one — a CRIS reviewer, an auditor, a different railway receiving
 * the wagon — are exactly the people who must NOT be able to produce one. With
 * a shared key there is no way to give them the first ability without the
 * second, so in practice nobody outside this server can ever check anything,
 * and the signature is only as good as the promise that it exists.
 *
 * Ed25519 separates the two. The private key signs; the public key verifies
 * and can be published, printed on the certificate, or handed to anyone who
 * asks. Verification becomes something a third party does independently,
 * which is the entire point of signing a safety document.
 *
 * WHY NOW
 * -------
 * Changing a signature scheme invalidates every certificate already issued
 * under the old one. There are none yet — the pilot has not started. This is
 * the last moment it is free.
 *
 * KEY MANAGEMENT
 * --------------
 * The key pair is derived deterministically from the server secret via HKDF,
 * so deployment stays a single secret to look after and the same server always
 * produces the same key. That does mean whoever holds JWT_SECRET can sign
 * certificates — but they can already mint an admin token, so it grants
 * nothing new. What it buys is the half that matters: verification without
 * the ability to forge.
 */

import crypto from 'node:crypto';
import { config } from '../config/index.ts';

/** Names the scheme in the stored signature, so a future change is legible. */
export const SIGNATURE_ALGORITHM = 'Ed25519';

/**
 * PKCS#8 prefix for a raw Ed25519 private key.
 *
 * Node will not build a key object from 32 raw seed bytes, but it will read
 * PKCS#8 DER, and for Ed25519 that is this fixed header followed by the seed.
 */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

let cached: { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } | null = null;

function keyPair(): { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } {
  if (cached) return cached;

  // A distinct info string, so this key is not the same value as anything else
  // derived from the same secret.
  const seed = Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(config.jwtSecret, 'utf8'), Buffer.alloc(0),
      Buffer.from('wrs-raipur-certificate-ed25519-v1', 'utf8'), 32)
  );

  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8'
  });

  cached = { privateKey, publicKey: crypto.createPublicKey(privateKey) };
  return cached;
}

/** Signs the canonical certificate content. Returns `Ed25519:<base64>`. */
export function signCertificate(canonicalContent: string): string {
  const sig = crypto.sign(null, Buffer.from(canonicalContent, 'utf8'), keyPair().privateKey);
  return `${SIGNATURE_ALGORITHM}:${sig.toString('base64')}`;
}

/**
 * Checks a signature against the content it should cover.
 *
 * Takes the public key as an argument so a verifier can pass one obtained
 * from somewhere other than this process — which is the whole reason for
 * using an asymmetric scheme. Defaults to this server's own public key for
 * the ordinary case.
 */
export function verifyCertificate(
  canonicalContent: string,
  signature: string,
  publicKeyPem?: string
): boolean {
  if (typeof signature !== 'string') return false;

  const [algorithm, encoded] = signature.split(':');
  // Refuse anything not claiming to be this scheme rather than guessing. An
  // HMAC-labelled signature from before this change is not valid here and
  // should read as unverifiable, not as a pass.
  if (algorithm !== SIGNATURE_ALGORITHM || !encoded) return false;

  try {
    const key = publicKeyPem ? crypto.createPublicKey(publicKeyPem) : keyPair().publicKey;
    return crypto.verify(
      null,
      Buffer.from(canonicalContent, 'utf8'),
      key,
      Buffer.from(encoded, 'base64')
    );
  } catch {
    // A malformed key or signature is a failed verification, not a crash.
    return false;
  }
}

/** The public key, for publishing. Safe to hand to anyone. */
export function certificatePublicKeyPem(): string {
  return keyPair().publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

/**
 * A short fingerprint of the public key, for printing on the certificate.
 *
 * Lets someone holding a paper certificate confirm they are checking it
 * against the right key, without transcribing the whole thing.
 */
export function certificateKeyFingerprint(): string {
  const der = keyPair().publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16).toUpperCase();
}
