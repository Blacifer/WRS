/**
 * Rate limiting and what the logs are allowed to contain
 * Indian Railways WRS Raipur
 *
 * Two gaps that only matter once this is reachable from outside a workshop
 * LAN — which is now one command away.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import {
  rateLimit,
  resetRateLimits,
  DEFAULT_MAX_REQUESTS,
  ANONYMOUS_MAX_REQUESTS
} from '../src/middleware/rateLimit.ts';

describe('Rate limiting', () => {
  beforeEach(() => resetRateLimits());

  const call = (mw: any, req: any) => {
    let status = 0;
    let body: any = null;
    let nexted = false;
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) { this.headers[k] = v; },
      status(s: number) { status = s; return this; },
      json(b: any) { body = b; return this; }
    };
    mw(req, res as any, () => { nexted = true; });
    return { status, body, nexted, headers: res.headers };
  };

  const anon = { headers: {}, socket: { remoteAddress: '10.0.0.7' }, method: 'GET', url: '/api/x' };

  it('lets a full offline queue drain without being throttled', () => {
    /*
     * The number that matters, and the case that set it. An inspector who
     * worked a whole shift offline has around 700 springs queued, and the
     * sync sends one request per spring as fast as the network allows. A
     * ceiling below that turns a normal reconnection into a stream of
     * refusals — the app appearing to break under exactly the conditions it
     * was built for.
     */
    const mw = rateLimit();
    const inspector = { ...anon, user: { id: 'usr_insp_001', role: 'INSPECTOR' } };
    for (let i = 0; i < 700; i++) {
      assert.equal(call(mw, inspector).nexted, true, `queued spring ${i + 1} should sync`);
    }
    assert.ok(DEFAULT_MAX_REQUESTS >= 700, 'the ceiling must clear a full shift’s queue');
  });

  it('holds an anonymous caller to a much tighter allowance', () => {
    /*
     * Signed out, there is almost nothing legitimate to do here: sign in, and
     * ask for health. So the anonymous ceiling is far below the authenticated
     * one rather than equal to it.
     */
    assert.ok(ANONYMOUS_MAX_REQUESTS < DEFAULT_MAX_REQUESTS / 10);
    const mw = rateLimit();
    for (let i = 0; i < ANONYMOUS_MAX_REQUESTS; i++) call(mw, anon);
    assert.equal(call(mw, anon).status, 429);
  });

  it('refuses the one after the ceiling, and says when to retry', () => {
    const mw = rateLimit({ max: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) call(mw, anon);
    const r = call(mw, anon);

    assert.equal(r.nexted, false);
    assert.equal(r.status, 429);
    assert.equal(r.body.error, 'RATE_LIMITED');
    assert.ok(r.body.retryAfterSeconds > 0);
    assert.match(r.body.message, /already recorded is safe/,
      'an inspector who thinks their work was lost reaches for paper');
    assert.ok(r.headers['Retry-After']);
  });

  it('recognises a signed-in caller before any route has authenticated them', () => {
    /*
     * The limiter runs on /api, ahead of the per-route auth middleware, so
     * req.user is not set yet. It used to read only req.user and therefore
     * treated every caller as anonymous — the authenticated ceiling could
     * never be reached, which the adversarial suite found by being refused
     * while holding a valid token.
     *
     * It verifies the signature rather than trusting the header, because
     * trusting it would let anyone claim an id for the larger allowance, or
     * invent ids for an unlimited number of buckets.
     */
    const mw = rateLimit({ max: 5, anonymousMax: 2, windowMs: 60_000 });
    const token = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR', name: 'Ramesh Kumar'
    } as any);
    const withToken = { ...anon, headers: { authorization: `Bearer ${token}` } };

    for (let i = 0; i < 5; i++) {
      assert.equal(call(mw, withToken).nexted, true, `authenticated request ${i + 1}`);
    }
    assert.equal(call(mw, withToken).status, 429, 'and is limited at the authenticated ceiling');
  });

  it('does not accept a forged token as identity', () => {
    // An unsigned or tampered token falls through to the address, and the
    // tighter anonymous allowance.
    const mw = rateLimit({ max: 50, anonymousMax: 2, windowMs: 60_000 });
    const forged = { ...anon, headers: { authorization: 'Bearer not.a.real.token' } };
    call(mw, forged); call(mw, forged);
    assert.equal(call(mw, forged).status, 429, 'a forged token must not buy the larger allowance');
  });

  it('counts each authenticated person separately', () => {
    /*
     * A shop floor shares one router. Keying on address would let one busy
     * inspector throttle everybody else — the usual way a rate limit causes
     * more harm than the abuse it was added for.
     */
    const mw = rateLimit({ max: 2, windowMs: 60_000 });
    const asUser = (id: string) => ({ ...anon, user: { id, role: 'INSPECTOR' } });

    call(mw, asUser('usr_a')); call(mw, asUser('usr_a'));
    assert.equal(call(mw, asUser('usr_a')).status, 429, 'the heavy user is limited');
    assert.equal(call(mw, asUser('usr_b')).nexted, true, 'their colleague is not');
  });

  it('starts a fresh allowance once the window has passed', () => {
    const mw = rateLimit({ max: 1, windowMs: 1 });
    call(mw, anon);
    const later = { ...anon };
    // The window is a millisecond, so anything after this instant is a new one.
    return new Promise<void>((resolve) => setTimeout(() => {
      assert.equal(call(mw, later).nexted, true);
      resolve();
    }, 5));
  });
});

describe('What a log line may contain', () => {
  it('never writes a password, a token or a body', async () => {
    /*
     * Logs are copied, mailed and pasted into tickets by people who would
     * never handle the database that way, so a credential in one travels
     * further than a credential anywhere else. This drives a real login
     * through the app with the logger enabled and reads what was written.
     */
    const app = createApp(':memory:');
    const written: string[] = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (chunk: any, ...rest: any[]) => {
      written.push(String(chunk));
      return realWrite(chunk, ...rest);
    };
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await app.dispatch({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json' },
        body: { username: 'inspector1', password: 'password123' }
      });
    } finally {
      (process.stdout as any).write = realWrite;
      process.env.NODE_ENV = previous;
    }

    const logs = written.join('');
    assert.ok(!logs.includes('password123'), 'a password must never reach a log');
    assert.ok(!logs.includes('eyJ'), 'a JWT must never reach a log');
  });
});
