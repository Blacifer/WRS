/**
 * JWT_EXPIRES_IN means what it says
 * Indian Railways WRS Raipur
 *
 * The setting was read into the config and never used; every token was
 * signed for a hardcoded day. Now it is parsed, applied, and refused when
 * it cannot be parsed — a setting that silently falls back is one nobody
 * can trust to have applied.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseDuration, config } from '../src/config/index.ts';
import { createApp } from '../src/app.ts';

describe('parseDuration', () => {
  it('TC-CFG-01 reads seconds, minutes, hours and days', () => {
    assert.strictEqual(parseDuration('3600', 'x'), 3600);
    assert.strictEqual(parseDuration('90s', 'x'), 90);
    assert.strictEqual(parseDuration('30m', 'x'), 1800);
    assert.strictEqual(parseDuration('24h', 'x'), 86400);
    assert.strictEqual(parseDuration('7d', 'x'), 7 * 86400);
    assert.strictEqual(parseDuration(' 12H ', 'x'), 43200);
  });

  it('TC-CFG-02 refuses what it cannot read, naming the setting', () => {
    assert.throws(() => parseDuration('soon', 'JWT_EXPIRES_IN'), /JWT_EXPIRES_IN="soon" is not a duration/);
    assert.throws(() => parseDuration('1w', 'JWT_EXPIRES_IN'), /not a duration/);
    assert.throws(() => parseDuration('10s', 'JWT_EXPIRES_IN'), /between 1 minute and 30 days/);
    assert.throws(() => parseDuration('31d', 'JWT_EXPIRES_IN'), /between 1 minute and 30 days/);
  });

  it('TC-CFG-03 the login response carries the configured lifetime, not a constant', async () => {
    const app = createApp(':memory:');
    const res = await app.dispatch({ method: 'POST', url: '/api/auth/login', body: { username: 'inspector1', password: 'password123' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.expiresIn, config.jwtExpiresInSeconds);
    // And the token itself says so.
    const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString('utf8'));
    assert.strictEqual(payload.exp - payload.iat, config.jwtExpiresInSeconds);
  });
});
