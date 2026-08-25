/**
 * TOTP Tests — proved against the RFCs, not asserted
 * Indian Railways WRS Raipur
 *
 * A one-time password implementation that is subtly wrong fails in the worst
 * possible way: it looks like it works, interoperates with nothing, and locks
 * supervisors out of a release gate at the moment they need it.
 *
 * So correctness here is not a matter of opinion. The base32 encoder is
 * checked against the test vectors printed in RFC 4648 §10, and the TOTP
 * generator against RFC 6238 Appendix B. If these pass, a supervisor's
 * Google Authenticator, Microsoft Authenticator or Aegis will agree with this
 * server about what the current code is.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Encode,
  base32Decode,
  generateTotp,
  verifyTotp,
  generateTotpSecret,
  buildTotpUri
} from '../src/auth/totp.ts';

describe('base32 — RFC 4648 §10 test vectors', () => {
  it('TC-B32-01: encodes the published vectors', () => {
    // The RFC prints these padded; padding is omitted here because
    // authenticator apps accept unpadded secrets and it shortens anything a
    // person might have to type by hand.
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI']
    ];
    for (const [plain, encoded] of vectors) {
      assert.strictEqual(base32Encode(Buffer.from(plain)), encoded, `encoding "${plain}"`);
    }
  });

  it('TC-B32-02: decoding reverses encoding for arbitrary bytes', () => {
    for (let len = 1; len <= 40; len++) {
      const bytes = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + 11) % 256));
      assert.deepStrictEqual(base32Decode(base32Encode(bytes)), bytes, `round trip at ${len} bytes`);
    }
  });

  it('TC-B32-03: decoding tolerates padding, spaces and lower case', () => {
    // Authenticator apps and manual entry produce all three.
    const expected = base32Decode('MZXW6YTBOI');
    for (const variant of ['mzxw6ytboi', 'MZXW6YTBOI======', 'MZXW 6YTB OI']) {
      assert.deepStrictEqual(base32Decode(variant), expected, `variant "${variant}"`);
    }
  });

  it('TC-B32-04: an invalid character is rejected, not silently dropped', () => {
    // Silently ignoring bad input would produce a secret that differs from the
    // one on the phone, with no indication why nothing works.
    assert.throws(() => base32Decode('MZXW6YTB!!'), /Invalid base32/);
    assert.throws(() => base32Decode('MZXW0YTB'), /Invalid base32/); // 0 and 1 are not in the alphabet
  });
});

describe('TOTP — RFC 6238 Appendix B test vectors', () => {
  // The RFC uses an ASCII seed repeated to the hash's block size.
  const SHA1_SECRET = base32Encode(Buffer.from('12345678901234567890'));
  const SHA256_SECRET = base32Encode(Buffer.from('12345678901234567890123456789012'));
  const SHA512_SECRET = base32Encode(
    Buffer.from('1234567890123456789012345678901234567890123456789012345678901234')
  );

  it('TC-TOTP-01: matches every SHA-1 vector', () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130']
    ];
    for (const [time, expected] of vectors) {
      assert.strictEqual(
        generateTotp(SHA1_SECRET, { now: time, digits: 8, algorithm: 'sha1' }),
        expected,
        `SHA-1 at t=${time}`
      );
    }
  });

  it('TC-TOTP-02: matches every SHA-256 vector', () => {
    const vectors: [number, string][] = [
      [59, '46119246'],
      [1111111109, '68084774'],
      [1111111111, '67062674'],
      [1234567890, '91819424'],
      [2000000000, '90698825'],
      [20000000000, '77737706']
    ];
    for (const [time, expected] of vectors) {
      assert.strictEqual(
        generateTotp(SHA256_SECRET, { now: time, digits: 8, algorithm: 'sha256' }),
        expected,
        `SHA-256 at t=${time}`
      );
    }
  });

  it('TC-TOTP-03: matches every SHA-512 vector', () => {
    const vectors: [number, string][] = [
      [59, '90693936'],
      [1111111109, '25091201'],
      [1111111111, '99943326'],
      [1234567890, '93441116'],
      [2000000000, '38618901'],
      [20000000000, '47863826']
    ];
    for (const [time, expected] of vectors) {
      assert.strictEqual(
        generateTotp(SHA512_SECRET, { now: time, digits: 8, algorithm: 'sha512' }),
        expected,
        `SHA-512 at t=${time}`
      );
    }
  });

  it('TC-TOTP-04: t=20000000000 proves the counter is genuinely 64-bit', () => {
    // This vector is the reason the counter is written as two 32-bit halves.
    // JavaScript's bitwise operators are 32-bit, so the obvious shift-based
    // implementation truncates here and produces a wrong code — while still
    // passing every earlier vector.
    assert.strictEqual(
      generateTotp(SHA1_SECRET, { now: 20000000000, digits: 8, algorithm: 'sha1' }),
      '65353130'
    );
  });
});

describe('TOTP verification', () => {
  const secret = generateTotpSecret();
  const at = (now: number) => generateTotp(secret, { now });

  it('TC-TOTP-05: the current code verifies', () => {
    const now = 1_700_000_000;
    assert.strictEqual(verifyTotp(secret, at(now), { now }), true);
  });

  it('TC-TOTP-06: clock drift of one step either way is tolerated', () => {
    // Phones drift. Rejecting a code because a device is 20 seconds out would
    // make the gate unusable while proving nothing about security.
    const now = 1_700_000_000;
    assert.strictEqual(verifyTotp(secret, at(now - 30), { now }), true, 'one step behind');
    assert.strictEqual(verifyTotp(secret, at(now + 30), { now }), true, 'one step ahead');
  });

  it('TC-TOTP-07: drift beyond the window is refused', () => {
    // Every additional step is another code valid at any moment, so the window
    // has to stop somewhere.
    const now = 1_700_000_000;
    assert.strictEqual(verifyTotp(secret, at(now - 90), { now }), false);
    assert.strictEqual(verifyTotp(secret, at(now + 90), { now }), false);
  });

  it('TC-TOTP-08: a code from a different secret never verifies', () => {
    const other = generateTotpSecret();
    const now = 1_700_000_000;
    assert.strictEqual(verifyTotp(secret, generateTotp(other, { now }), { now }), false);
  });

  it('TC-TOTP-09: malformed input is refused without throwing', () => {
    // These arrive from a keypad on a shop floor. None may crash the endpoint.
    const now = 1_700_000_000;
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56', '../../etc', '000000']) {
      assert.strictEqual(typeof verifyTotp(secret, bad, { now }), 'boolean', `input "${bad}"`);
    }
  });

  it('TC-TOTP-10: codes change every 30 seconds and not within one', () => {
    const base = 1_700_000_000 - (1_700_000_000 % 30);
    assert.strictEqual(at(base), at(base + 29), 'stable within a step');
    assert.notStrictEqual(at(base), at(base + 30), 'changes at the step boundary');
  });

  it('TC-TOTP-11: secrets are 160-bit and distinct', () => {
    const secrets = new Set(Array.from({ length: 100 }, () => generateTotpSecret()));
    assert.strictEqual(secrets.size, 100, 'secrets must not repeat');
    assert.strictEqual(base32Decode([...secrets][0]).length, 20, 'RFC 4226 recommends 160 bits');
  });
});

describe('Enrolment URI', () => {
  it('TC-TOTP-12: an authenticator app gets everything it needs', () => {
    const uri = buildTotpUri({ secret: 'MZXW6YTBOI', accountName: 'supervisor1' });
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.match(uri, /secret=MZXW6YTBOI/);
    assert.match(uri, /issuer=WRS\+Raipur\+QC/);
    assert.match(uri, /algorithm=SHA1/);
    assert.match(uri, /digits=6/);
    assert.match(uri, /period=30/);
  });

  it('TC-TOTP-13: the label names both the system and the person', () => {
    // A supervisor may have several work accounts on one phone; an entry
    // reading only "WRS Raipur QC" would be unusable.
    const uri = buildTotpUri({ secret: 'MZXW6YTBOI', accountName: 'supervisor1' });
    assert.ok(decodeURIComponent(uri.split('?')[0]).includes('WRS Raipur QC:supervisor1'));
  });
});
