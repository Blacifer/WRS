/**
 * Who may read the divisional figures
 * Indian Railways WRS Raipur
 *
 * Every analytics endpoint was mounted on optionalAuthMiddleware, which takes
 * a token when one is offered and carries on cheerfully when none is. On a
 * workshop LAN that reads as harmless. What it meant in practice is that
 * anyone able to reach the server, with no account at all, could ask
 * /api/analytics/inspectors and be handed named railway employees along with
 * how many parts each of them had condemned. The moment this is served over a
 * tunnel or hosted anywhere, that is public.
 *
 * The gates are deliberately not uniform, so this test is not uniform either.
 * /pipeline is stage counts, which the supervisor's own wagon list is built
 * from and which anyone allowed onto that screen could total up by hand — it
 * takes wagon.view. Everything else is divisional reading and takes
 * analytics.read, which a supervisor deliberately does not hold.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.ts';

const app = createApp();
let server: Server;
let base: string;

const DIVISIONAL = ['tat', 'throughput', 'parts', 'inspectors', 'blockers', 'export'];

before(async () => {
  await new Promise<void>(resolve => {
    server = app.listen(0, () => {
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

after(() => server?.close());

async function tokenFor(username: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' })
  });
  assert.equal(res.status, 200, `${username} could not sign in`);
  return (await res.json()).data.token;
}

const hit = (ep: string, token?: string) =>
  fetch(`${base}/api/analytics/${ep}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });

describe('Divisional analytics access', () => {
  let inspector: string;
  let supervisor: string;
  let drm: string;
  let admin: string;

  before(async () => {
    inspector = await tokenFor('inspector1');
    supervisor = await tokenFor('supervisor1');
    drm = await tokenFor('drm1');
    admin = await tokenFor('admin1');
  });

  it('answers nothing at all to a request with no account', async () => {
    for (const ep of ['pipeline', ...DIVISIONAL]) {
      const res = await hit(ep);
      assert.equal(res.status, 401, `/${ep} was readable with no token`);
    }
  });

  it('never hands out named inspector figures to an anonymous caller', async () => {
    /*
     * Named separately from the loop above because this is the one that
     * carries personal data about identifiable people, and a future change
     * that loosened only this endpoint should fail loudly.
     */
    const res = await hit('inspectors');
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.ok(
      !/inspectorName|Ramesh|Praveen/.test(text),
      'a refused response still leaked inspector names'
    );
  });

  it('is closed to an inspector, including the pipeline', async () => {
    for (const ep of ['pipeline', ...DIVISIONAL]) {
      const res = await hit(ep, inspector);
      assert.equal(res.status, 403, `/${ep} was open to an inspector`);
    }
  });

  it('lets a supervisor read the pipeline their own wagon list is built from', async () => {
    const res = await hit('pipeline', supervisor);
    assert.equal(res.status, 200, 'gating the pipeline broke the supervisor wagon list');
  });

  it('keeps divisional reading away from a supervisor', async () => {
    for (const ep of DIVISIONAL) {
      const res = await hit(ep, supervisor);
      assert.equal(res.status, 403, `/${ep} was open to a supervisor`);
    }
  });

  it('opens everything to the DRM and to an administrator', async () => {
    for (const token of [drm, admin]) {
      for (const ep of ['pipeline', ...DIVISIONAL]) {
        const res = await hit(ep, token);
        assert.equal(res.status, 200, `/${ep} was refused to an oversight account`);
      }
    }
  });
});
