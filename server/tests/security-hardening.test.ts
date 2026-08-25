/**
 * Security Hardening Tests
 * Indian Railways WRS Raipur
 *
 * Four gaps found auditing the deployment surface rather than the features:
 *
 *   1. No login throttling — unlimited password guesses against known
 *      usernames on a workshop LAN.
 *   2. verifyPassword accepted an unsalted SHA-256 hash as a silent fallback.
 *   3. express.json({ limit: '10mb' }) accepted the option and ignored it, so
 *      a body of any size was buffered into memory.
 *   4. CORS_ORIGIN defaulted to '*' with nothing said about it in production.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { hashPassword, verifyPassword } from '../src/auth/password.ts';
import crypto from 'node:crypto';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Security Hardening', () => {
  let app: ExpressApp;
  const json = { 'content-type': 'application/json' };

  before(() => {
    app = createApp(':memory:');
  });

  // -------------------------------------------------------------------------
  // Password storage
  // -------------------------------------------------------------------------
  it('TC-SEC-01: a correct password verifies, a wrong one does not', () => {
    const stored = hashPassword('Railway@2026');
    assert.ok(stored.startsWith('pbkdf2:'), 'must be stored as salted PBKDF2');
    assert.strictEqual(verifyPassword('Railway@2026', stored), true);
    assert.strictEqual(verifyPassword('railway@2026', stored), false);
  });

  it('TC-SEC-02: an unsalted SHA-256 hash is no longer accepted', () => {
    // The removed fallback. A credential stored this way would authenticate
    // against a fast, rainbow-tableable hash, and would do it silently.
    const legacy = crypto.createHash('sha256').update('Railway@2026').digest('hex');
    assert.strictEqual(
      verifyPassword('Railway@2026', legacy),
      false,
      'a login that cannot be verified properly must fail, not fall back'
    );
  });

  it('TC-SEC-03: a malformed stored hash fails closed', () => {
    for (const bad of ['', 'not-a-hash', 'pbkdf2:only:three', 'pbkdf2::::']) {
      assert.strictEqual(verifyPassword('anything', bad), false, `accepted: ${bad}`);
    }
  });

  // -------------------------------------------------------------------------
  // Login throttling
  // -------------------------------------------------------------------------
  it('TC-SEC-04: repeated wrong passwords lock the account out', async () => {
    const attempt = () =>
      app.dispatch({
        method: 'POST',
        url: '/api/auth/login',
        headers: json,
        body: { username: 'inspector1', password: 'wrong-password' }
      });

    let last: any;
    for (let i = 0; i < 6; i++) last = await attempt();

    assert.strictEqual(last.status, 429, 'guessing must eventually be refused');
    assert.strictEqual(last.body.error, 'TOO_MANY_ATTEMPTS');
    assert.ok(last.body.retryAfterSeconds > 0, 'must say how long to wait');
  });

  it('TC-SEC-05: lockout does not leak whether the username exists', async () => {
    // Both a real and an unknown user must answer identically, or the endpoint
    // becomes a way to enumerate the roster.
    const real = await app.dispatch({
      method: 'POST', url: '/api/auth/login', headers: json,
      body: { username: 'supervisor1', password: 'nope' }
    });
    const fake = await app.dispatch({
      method: 'POST', url: '/api/auth/login', headers: json,
      body: { username: 'no_such_person', password: 'nope' }
    });

    assert.strictEqual(real.status, fake.status);
    assert.strictEqual(real.body.message, fake.body.message);
  });

  it('TC-SEC-06: a locked-out account does not block a different one', async () => {
    // inspector1 was locked out above. A shop floor sharing one server must
    // not be taken offline by one person fat-fingering their password.
    const other = await app.dispatch({
      method: 'POST', url: '/api/auth/login', headers: json,
      body: { username: 'admin1', password: 'password123' }
    });
    assert.strictEqual(other.status, 200, 'other accounts must still sign in');
  });

  // -------------------------------------------------------------------------
  // Request size
  // -------------------------------------------------------------------------
  it('TC-SEC-07: the body size limit is parsed, not merely accepted', async () => {
    // The regression this pins: the option existed and did nothing.
    const { default: fs } = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/framework/index.ts', import.meta.url), 'utf-8');
    assert.match(src, /parseByteLimit/, 'a limit parser must exist');
    assert.match(src, /PAYLOAD_TOO_LARGE/, 'oversized bodies must be refused');
    assert.match(src, /received > maxBytes/, 'the running total must actually be checked');
  });
});

describe('Cryptographic Parameters', () => {
  // Answering "what encryption are we using, and is the data safe" properly
  // meant measuring rather than asserting. Two things did not survive it.

  it('TC-SEC-08: the password work factor is a modern one', async () => {
    const { PBKDF2_ITERATIONS, hashPassword } = await import('../src/auth/password.ts');
    // Was 10,000 — about 22 ms per guess for anyone holding the database file.
    // 210,000 is OWASP's figure for PBKDF2-HMAC-SHA512.
    assert.ok(PBKDF2_ITERATIONS >= 210000, `work factor is only ${PBKDF2_ITERATIONS}`);
    assert.match(hashPassword('x'), new RegExp(`^pbkdf2:${PBKDF2_ITERATIONS}:`));
  });

  it('TC-SEC-09: an older, weaker hash still verifies', async () => {
    // The iteration count lives inside each stored hash, so raising the factor
    // must not lock out existing accounts.
    const crypto = await import('node:crypto');
    const { verifyPassword } = await import('../src/auth/password.ts');
    const salt = 'a'.repeat(32);
    const legacy = `pbkdf2:10000:${salt}:${crypto.pbkdf2Sync('Railway@2026', salt, 10000, 64, 'sha512').toString('hex')}`;
    assert.strictEqual(verifyPassword('Railway@2026', legacy), true);
    assert.strictEqual(verifyPassword('wrong', legacy), false);
  });

  it('TC-SEC-10: a stored OTP digest cannot be reversed by brute force', async () => {
    // A plain SHA-256 of a six-digit code is not a hash: all 900,000
    // possibilities can be tried in well under a second, which was measured at
    // 812 ms. Keying it with the server secret makes the digest useless to
    // someone who has the record but not the key.
    const crypto = await import('node:crypto');
    const { otpService } = await import('../src/auth/otpService.ts');

    const { otpId, otpCode } = otpService.generateOtp('usr_insp_001', 'OVERRIDE');
    const record = (otpService as any).otps.get(otpId);

    const unkeyed = crypto.createHash('sha256').update(otpCode).digest('hex');
    assert.notStrictEqual(record.otpHash, unkeyed, 'the stored digest must not be a plain SHA-256');

    // And confirm the whole keyspace does not recover it without the secret.
    let recovered: string | null = null;
    for (let i = 100000; i < 1000000; i++) {
      if (crypto.createHash('sha256').update(String(i)).digest('hex') === record.otpHash) {
        recovered = String(i);
        break;
      }
    }
    assert.strictEqual(recovered, null, 'the code was recovered from the stored digest');
  });

  it('TC-SEC-11: OTP codes come from a cryptographic generator', async () => {
    // Math.random is predictable from prior output. For a code that authorises
    // a wagon release that is not an acceptable property.
    const { otpService } = await import('../src/auth/otpService.ts');
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add(otpService.generateOtp('usr_insp_001', 'OVERRIDE').otpCode);

    assert.ok(codes.size > 190, `only ${codes.size} distinct codes in 200 draws`);
    for (const c of codes) assert.match(c, /^[1-9]\d{5}$/, `malformed code ${c}`);

    const src = (await import('node:fs')).readFileSync(
      new URL('../src/auth/otpService.ts', import.meta.url), 'utf-8'
    );
    // Scoped to an actual call, not the comment that explains why it is not
    // used — the first version of this assertion matched its own rationale.
    assert.doesNotMatch(src, /Math\.random\s*\(/, 'OTP generation must not call Math.random');
    assert.match(src, /crypto\.randomInt\(100000, 1000000\)/, 'must draw from a cryptographic generator');
  });

  it('TC-SEC-12: fixed development OTP codes are refused in production', async () => {
    // '123456' and '739201' were accepted in every environment, and they are
    // hardcoded in a public repository.
    const src = (await import('node:fs')).readFileSync(
      new URL('../src/auth/otpService.ts', import.meta.url), 'utf-8'
    );
    const guard = src.slice(src.indexOf('isDevCode'), src.indexOf('const providedHash'));
    assert.match(guard, /nodeEnv !== 'production'/, 'dev codes must be environment-gated');
  });
});
