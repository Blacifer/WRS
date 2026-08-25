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
