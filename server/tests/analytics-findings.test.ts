/**
 * What keeps going wrong, across the whole shop
 * Indian Railways WRS Raipur
 *
 * The parts breakdown counts categories — "how many springs failed" — which
 * makes a chart and settles nothing. The question a workshop manager asks is
 * which PART keeps coming back and on how many different wagons, because a
 * part that fails on one wagon in three is invisible to anyone who only ever
 * sees one wagon at a time.
 *
 * The counting rule is the substance of it: distinct wagons, not rows. A part
 * listed twice on one wagon (two bogies) is that wagon's problem; the same
 * part on nine wagons is the shop's, and only the second is worth acting on.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Recurring findings across the shop', () => {
  let app: ExpressApp;
  let inspectorToken: string;
  let drmToken: string;
  let supervisorToken: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  before(async () => {
    app = createApp(':memory:');
    inspectorToken = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR',
      name: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042'
    });
    /*
     * analytics.read is deliberately not a supervisor's — the strategic
     * dashboards belong to the DRM and the administrator, and this view sits
     * with the rest of the divisional reporting.
     */
    drmToken = generateToken({
      id: 'usr_drm_001', username: 'drm1', role: 'DRM',
      name: 'DRM (Divisional Railway Manager)', employeeId: 'SECR-DRM-0001'
    });
    supervisorToken = generateToken({
      id: 'usr_sup_001', username: 'supervisor1', role: 'SUPERVISOR',
      name: 'S. K. Verma', employeeId: 'WRS-SUP-2019'
    });

    // Three wagons. One part condemned on all three; another on one only.
    for (let i = 1; i <= 3; i++) {
      const w = `SECR/BOXNHL/FND00${i}`;
      await app.dispatch({
        method: 'POST', url: '/api/wagons/register', headers: auth(inspectorToken),
        body: { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }
      });

      const chk = await app.dispatch({
        method: 'GET', url: `/api/wagons/${w}/checklist`, headers: auth(inspectorToken)
      });
      const items = chk.body.data.allItems;

      // The same named part on every wagon — this is the recurring one. Some
      // parts appear twice (one per bogie), which is what makes counting rows
      // rather than wagons wrong.
      const common = items.filter((it: any) => it.partName === items[0].partName);
      for (const c of common) {
        await app.dispatch({
          method: 'PUT', url: `/api/wagons/${w}/checklist/items/${c.id}`,
          headers: auth(inspectorToken), body: { status: 'CONDEMNED' }
        });
      }

      if (i === 1) {
        const other = items.find((it: any) => it.partName !== items[0].partName);
        await app.dispatch({
          method: 'PUT', url: `/api/wagons/${w}/checklist/items/${other.id}`,
          headers: auth(inspectorToken), body: { status: 'FAIL' }
        });
      }
    }
  });

  test('TC-FND-01: the part on the most wagons is reported first', async () => {
    const res = await app.dispatch({
      method: 'GET', url: '/api/analytics/findings', headers: auth(drmToken)
    });
    assert.equal(res.status, 200);

    const { findings, totalWagons } = res.body.data;
    assert.ok(findings.length >= 2);
    assert.equal(totalWagons, 3, 'the denominator must be there, or a count cannot be read as a rate');

    assert.equal(findings[0].wagonsAffected, 3, 'the recurring part is on all three wagons');
    assert.ok(
      findings[0].wagonsAffected >= findings[1].wagonsAffected,
      'ordering is by wagons affected, which is the whole point of the view'
    );
  });

  test('TC-FND-02: a part on two bogies of one wagon counts as one wagon', async () => {
    const res = await app.dispatch({
      method: 'GET', url: '/api/analytics/findings', headers: auth(drmToken)
    });
    for (const f of res.body.data.findings) {
      assert.ok(
        f.wagonsAffected <= res.body.data.totalWagons,
        `${f.partName} claims ${f.wagonsAffected} wagons out of ${res.body.data.totalWagons} — rows are being counted, not wagons`
      );
    }
  });

  test('TC-FND-03: the percentage is of wagons seen, not of findings', async () => {
    const res = await app.dispatch({
      method: 'GET', url: '/api/analytics/findings', headers: auth(drmToken)
    });
    const top = res.body.data.findings[0];
    assert.equal(top.wagonsAffectedPct, 100, '3 of 3 wagons is 100%');
  });

  test('TC-FND-04: a clean part is absent rather than listed with zeros', async () => {
    const res = await app.dispatch({
      method: 'GET', url: '/api/analytics/findings', headers: auth(drmToken)
    });
    for (const f of res.body.data.findings) {
      const total = f.failed + f.condemned + f.repaired + f.replaced;
      assert.ok(total > 0, `${f.partName} has no finding against it and should not be in a findings list`);
    }
  });

  test('TC-FND-05: neither an inspector nor a supervisor reads shop-wide analytics', async () => {
    /*
     * The same boundary as the rest of /api/analytics, and it is deliberate:
     * analytics.read is held by the DRM and the administrator. A supervisor
     * runs a shift and is measured by these figures; they are not their
     * figures to read. Pinned here so this view cannot quietly widen it.
     */
    for (const [who, token] of [['inspector', inspectorToken], ['supervisor', supervisorToken]] as const) {
      const res = await app.dispatch({
        method: 'GET', url: '/api/analytics/findings', headers: auth(token)
      });
      assert.ok(res.status === 403 || res.status === 401, `${who}: expected refusal, got ${res.status}`);
    }
  });

  test('TC-FND-06: the limit is bounded so one request cannot pull the whole table', async () => {
    const res = await app.dispatch({
      method: 'GET', url: '/api/analytics/findings?limit=99999', headers: auth(drmToken)
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.findings.length <= 200);
  });
});
