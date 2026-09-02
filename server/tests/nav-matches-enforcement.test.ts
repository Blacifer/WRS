/**
 * A screen a role is offered must be a screen that role can open
 * Indian Railways WRS Raipur
 *
 * The DRM's navigation offers Audit Chain, because the nav is drawn from
 * capabilities and the DRM holds audit.read. The endpoint behind it was
 * guarded with requireRole('SUPERVISOR') — a seniority ladder the DRM does
 * not sit on — so the divisional officer opened his own screen and was told
 * "Insufficient permissions. Requires minimum role: SUPERVISOR".
 *
 * The two systems disagreed, and the one that lost was the officer this whole
 * system is being built for. A menu entry that bounces the person it was
 * drawn for is worse than no entry at all.
 *
 * This file pins the endpoints behind each role's navigation to that role.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.ts';

const app = createApp();
let server: Server;
let base: string;

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

const get = (path: string, token: string) =>
  fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

/*
 * What each role's navigation offers, and the endpoint that screen depends
 * on. Adding a nav entry without adding its endpoint here is the gap this
 * file exists to close.
 */
const NAV: Record<string, Array<[string, string]>> = {
  drm1: [
    ['Audit Chain', '/api/audit/verify'],
    ['History & Logs', '/api/audit/activity'],
    ['Spring Analytics', '/api/inspections/stats'],
    ['DRM Dashboard', '/api/analytics/tat'],
    ['Wagons Pipeline', '/api/wagons'],
    ['Component Passports', '/api/components'],
    ['Ask the Manual', '/api/manual/status'],
    ['System Learning', '/api/learning/dashboard']
  ],
  admin1: [
    ['Audit Chain', '/api/audit/verify'],
    ['History & Logs', '/api/audit/activity'],
    ['Spring Analytics', '/api/inspections/stats'],
    ['DRM Dashboard', '/api/analytics/tat'],
    ['Stores & Depot Inventory', '/api/inventory'],
    ['Component Passports', '/api/components'],
    ['User Accounts', '/api/auth/users'],
    ['Gauge register', '/api/gauges'],
    ['System Learning', '/api/learning/dashboard']
  ],
  supervisor1: [
    ['Wagons Pipeline', '/api/wagons'],
    ['Audit Chain', '/api/audit/verify'],
    ['Ask the Manual', '/api/manual/status'],
    ['Gauge picker on sorting', '/api/gauges'],
    ['System Learning', '/api/learning/dashboard']
  ],
  inspector1: [
    ['Spring sorting gauge picker', '/api/gauges'],
    ['Ask the Manual', '/api/manual/status']
  ]
};

describe('Every screen a role is offered, that role can open', () => {
  for (const [username, entries] of Object.entries(NAV)) {
    it(`${username} is not refused by anything in their own navigation`, async () => {
      const token = await tokenFor(username);
      const refused: string[] = [];

      for (const [screen, endpoint] of entries) {
        const res = await get(endpoint, token);
        if (res.status === 401 || res.status === 403) {
          refused.push(`${screen} → ${endpoint} returned ${res.status}`);
        }
      }

      assert.deepEqual(
        refused,
        [],
        `${username} is offered screens that then refuse them:\n  ${refused.join('\n  ')}`
      );
    });
  }

  it('still refuses an inspector the things they are not offered', async () => {
    /*
     * The counterpart. Making the nav and the enforcement agree must not be
     * achieved by opening everything to everybody.
     */
    const token = await tokenFor('inspector1');
    for (const endpoint of [
      '/api/audit/verify',
      '/api/audit/activity',
      '/api/analytics/inspectors',
      '/api/auth/users',
      '/api/learning/dashboard'
    ]) {
      const res = await get(endpoint, token);
      assert.equal(res.status, 403, `${endpoint} was open to an inspector`);
    }
  });
});
