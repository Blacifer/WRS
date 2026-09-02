/**
 * The demo password must not open a production deployment
 * Indian Railways WRS Raipur
 *
 * seed.ts refuses to create the demo accounts when NODE_ENV=production, and
 * that guard is right as far as it goes. It does not go far enough. The
 * realistic path to a live workshop is a database seeded during development
 * and then deployed, or a production server pointed at that same file. Those
 * accounts already exist, and production authenticated them without comment —
 * admin1 / password123, a full administrator, on whatever address the shop is
 * reachable from, with the password printed in the README.
 *
 * Verified against a real production-mode server before the fix: all four
 * demo logins were accepted.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

const DEMO_PASSWORD = 'password123';

async function withServer(
  env: Record<string, string | undefined>,
  fn: (base: string) => Promise<void>
) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  // Imported fresh so config/index.ts re-reads the environment above.
  const { createApp } = await import(`../src/app.ts?cred=${Math.random()}`);
  const app = createApp();
  let server: Server;
  const base: string = await new Promise(resolve => {
    server = app.listen(0, () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });

  try {
    await fn(base);
  } finally {
    server!.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const login = (base: string, username: string, password: string) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

describe('Demonstration credentials in production', () => {
  it('refuses every demo account when NODE_ENV is production', async () => {
    await withServer(
      { NODE_ENV: 'production', JWT_SECRET: 'test-only-secret', SEED_DEMO_USERS: undefined },
      async base => {
        for (const username of ['admin1', 'supervisor1', 'inspector1', 'drm1']) {
          const res = await login(base, username, DEMO_PASSWORD);
          assert.equal(
            res.status,
            403,
            `${username} still signs in on a production build with the published password`
          );
          const body = await res.json();
          assert.equal(body.error, 'DEMO_CREDENTIAL_REFUSED');
          assert.ok(
            !body.token,
            'a refused production login still handed back a token'
          );
        }
      }
    );
  });

  it('tells the operator what to do rather than just refusing', async () => {
    /*
     * A deployment that refuses every login with "invalid credentials" reads
     * as broken, and the person on the other end has no way to know the cause
     * is a password rather than a bug.
     */
    await withServer(
      { NODE_ENV: 'production', JWT_SECRET: 'test-only-secret', SEED_DEMO_USERS: undefined },
      async base => {
        const body = await (await login(base, 'admin1', DEMO_PASSWORD)).json();
        assert.match(body.message, /demonstration password/i);
        assert.match(body.message, /BOOTSTRAP_ADMIN_USERNAME/);
      }
    );
  });

  it('still lets the demo accounts in outside production', async () => {
    // The whole development workflow, and every other test file, rests on it.
    await withServer({ NODE_ENV: 'test', JWT_SECRET: undefined }, async base => {
      const res = await login(base, 'supervisor1', DEMO_PASSWORD);
      assert.equal(res.status, 200, 'the demo login broke outside production');
    });
  });

  it('honours the deliberate escape hatch for a supervised demonstration', async () => {
    await withServer(
      { NODE_ENV: 'production', JWT_SECRET: 'test-only-secret', SEED_DEMO_USERS: 'true' },
      async base => {
        const res = await login(base, 'supervisor1', DEMO_PASSWORD);
        assert.equal(
          res.status,
          200,
          'SEED_DEMO_USERS=true no longer permits a demonstration on a production build'
        );
      }
    );
  });
});
