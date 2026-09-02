/**
 * CASNUB Bogie Parts Checklist & Phase 1 Integration Tests (Phase 2 - R2)
 * Indian Railways WRS Raipur
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Phase 2 R2: CASNUB Bogie Parts Checklist & Phase 1 Integration', () => {
  let app: ExpressApp;
  let inspectorToken: string;
  let supervisorToken: string;

  before(() => {
    app = createApp(':memory:');
    inspectorToken = generateToken({
      id: 'usr_insp_001',
      username: 'inspector1',
      role: 'INSPECTOR',
      name: 'Ramesh Kumar',
      employeeId: 'WRS-INSP-1042'
    });
    supervisorToken = generateToken({
      id: 'usr_sup_001',
      username: 'supervisor1',
      role: 'SUPERVISOR',
      name: 'S. K. Verma',
      employeeId: 'WRS-SUP-2019'
    });
  });

  test('TC-CHK-01: Auto-populates 8 RDSO CASNUB categories on wagon registration', async () => {
    const wagonNumber = 'NR/BOXNHL/88001';
    const regRes = await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' }
    });
    assert.equal(regRes.status, 201);

    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const categories = Object.keys(res.body.data.categories);

    const expectedCategories = [
      'SPRINGS',
      'WHEELS_AXLES',
      'BEARINGS',
      'BRAKE_SYSTEM',
      'COUPLERS_DRAFT_GEAR',
      'BOGIE_FRAME_BOLSTER',
      'FRICTION_WEDGES',
      'BODY_UNDERFRAME'
    ];

    for (const cat of expectedCategories) {
      assert.ok(categories.includes(cat), `Missing expected RDSO category ${cat}`);
      assert.ok(res.body.data.categories[cat].length > 0, `Category ${cat} has no default items`);
    }
  });

  test('TC-CHK-02: 5-state item condition lifecycle (PENDING -> FAIL -> REPLACED -> PASS)', async () => {
    const wagonNumber = 'NR/BOXNHL/88001';
    const chkRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    const brakeItem = chkRes.body.data.allItems.find((i: any) => i.partName.includes('Composite Brake Blocks'));
    assert.ok(brakeItem, 'Composite Brake Blocks item not found');
    assert.equal(brakeItem.status, 'PENDING');

    // 1. Log Inspection as FAIL
    const update1 = await app.dispatch({
      method: 'PUT',
      url: `/api/wagons/${wagonNumber}/checklist/items/${brakeItem.id}`,
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        status: 'FAIL',
        conditionNotes: 'Brake block thickness measured 8mm (< 10mm condemning limit)'
      }
    });
    assert.equal(update1.status, 200);
    assert.equal(update1.body.data.status, 'FAIL');

    // 2. Workshop replaces part: mark REPLACED
    const update2 = await app.dispatch({
      method: 'PUT',
      url: `/api/wagons/${wagonNumber}/checklist/items/${brakeItem.id}`,
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        status: 'REPLACED',
        repairAction: 'REPLACED_NEW',
        repairNotes: 'Installed new ' + 'K' + ' type composite brake blocks'
      }
    });
    assert.equal(update2.status, 200);
    assert.equal(update2.body.data.status, 'REPLACED');

    // 3. Re-inspection: Inspector certifies PASS
    const update3 = await app.dispatch({
      method: 'PUT',
      url: `/api/wagons/${wagonNumber}/checklist/items/${brakeItem.id}`,
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        status: 'PASS',
        reinspectedStatus: 'PASS',
        conditionNotes: 'New block thickness verified at 58mm'
      }
    });
    assert.equal(update3.status, 200);
    assert.equal(update3.body.data.status, 'PASS');
    assert.equal(update3.body.data.reinspectedStatus, 'PASS');
  });

  test('TC-CHK-03: Deep Phase 1 Spring Integration auto-syncs Phase 1 spring inspections', async () => {
    const wagonNumber = 'NR/BOXNHL/88002';
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' }
    });

    // 1. Inspector measures an under-height outer spring in Phase 1 -> CONDEMNED
    const inspRes = await app.dispatch({
      method: 'POST',
      url: '/api/inspections',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber,
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        springPosition: 'OUTER',
        bogiePosition: 'BOGIE_1',
        measuredFreeHeight: 241.0 // Below Band VI 245mm -> CONDEMNED
      }
    });
    assert.equal(inspRes.status, 201);
    assert.equal(inspRes.body.data.status, 'CONDEMNED');

    // 2. Query Wagon Checklist -> Category 'SPRINGS' outer spring should be auto-synced as CONDEMNED
    const chkRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    const outerSpringItem = chkRes.body.data.allItems.find((i: any) => i.category === 'SPRINGS' && i.partName.includes('Outer Spring (Bogie 1)'));
    assert.ok(outerSpringItem, 'Outer spring item not found in checklist');
    assert.equal(outerSpringItem.status, 'CONDEMNED');

    // 3. Replace spring and log passing inspection in Phase 1 (Band III Yellow)
    const inspRes2 = await app.dispatch({
      method: 'POST',
      url: '/api/inspections',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber,
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        springPosition: 'OUTER',
        bogiePosition: 'BOGIE_1',
        measuredFreeHeight: 257.5 // Band III Yellow -> PASS
      }
    });
    assert.equal(inspRes2.status, 201);
    assert.equal(inspRes2.body.data.status, 'PASS');

    // 4. Query Checklist again -> should now reflect PASS
    const chkRes2 = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    const outerSpringItem2 = chkRes2.body.data.allItems.find((i: any) => i.category === 'SPRINGS' && i.partName.includes('Outer Spring (Bogie 1)'));
    assert.equal(outerSpringItem2.status, 'PASS');
  });

  /*
   * A measurement must never overturn a person.
   *
   * The spring rows are refreshed from the latest Phase-1 measurement on
   * every read of the checklist, which is right while nobody has looked at
   * the part and catastrophic once somebody has. A supervisor could condemn a
   * spring by hand and the next read would rewrite it to PASS, replacing the
   * reason with "Auto-linked from spring measurement". No audit entry, and
   * the exit gate reads the same method, so the wagon became releasable.
   *
   * Free height is one failure mode out of several. A cracked spring measures
   * perfectly.
   */
  test('TC-CHK-03b: a hand-written condemnation is not erased by a passing measurement', async () => {
    const wagonNumber = 'NR/BOXNHL/88012';
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: { authorization: `Bearer ${inspectorToken}`, 'content-type': 'application/json' },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' }
    });

    // The spring measures in band and is auto-linked as PASS.
    await app.dispatch({
      method: 'POST',
      url: '/api/inspections',
      headers: { authorization: `Bearer ${inspectorToken}`, 'content-type': 'application/json' },
      body: {
        wagonNumber, bogieType: 'CASNUB_22_NLB', condition: 'USED',
        springPosition: 'OUTER', bogiePosition: 'BOGIE_1', measuredFreeHeight: 257.5
      }
    });

    const readItem = async () => {
      const res = await app.dispatch({
        method: 'GET',
        url: `/api/wagons/${wagonNumber}/checklist`,
        headers: { authorization: `Bearer ${inspectorToken}` }
      });
      return res.body.data.allItems.find(
        (i: any) => i.category === 'SPRINGS' && i.partName.includes('Outer Spring (Bogie 1)')
      );
    };

    const linked = await readItem();
    assert.equal(linked.status, 'PASS', 'the measurement fills in a row nobody has judged');

    // A supervisor looks at the spring and sees a crack. The height is fine.
    const put = await app.dispatch({
      method: 'PUT',
      url: `/api/wagons/${wagonNumber}/checklist/items/${linked.id}`,
      headers: { authorization: `Bearer ${supervisorToken}`, 'content-type': 'application/json' },
      body: { status: 'CONDEMNED', conditionNotes: 'Visible transverse crack near second coil' }
    });
    assert.equal(put.status, 200);

    // Anyone opens the checklist again.
    const after = await readItem();
    assert.equal(after.status, 'CONDEMNED', 'a measurement must not overturn a person');
    assert.match(
      after.conditionNotes,
      /transverse crack/,
      'and must not overwrite the evidence they recorded'
    );

    // ...and the gate must not release it.
    const gate = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/gate/status`,
      headers: { authorization: `Bearer ${supervisorToken}` }
    });
    assert.equal(gate.body.data.canRelease, false);
  });

  test('TC-CHK-03c: a condemning measurement over a human PASS blocks release rather than vanishing', async () => {
    /*
     * The other direction. The person is still not overruled — their verdict
     * stands on the row — but the measurement is not dropped either. It is
     * carried as a disagreement and blocks release until somebody reconciles
     * the two, because silently keeping either one loses a real finding.
     */
    const wagonNumber = 'NR/BOXNHL/88013';
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: { authorization: `Bearer ${inspectorToken}`, 'content-type': 'application/json' },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' }
    });

    const before = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });
    const target = before.body.data.allItems.find(
      (i: any) => i.category === 'SPRINGS' && i.partName.includes('Outer Spring (Bogie 1)')
    );

    // Passed by eye, by a person.
    await app.dispatch({
      method: 'PUT',
      url: `/api/wagons/${wagonNumber}/checklist/items/${target.id}`,
      headers: { authorization: `Bearer ${inspectorToken}`, 'content-type': 'application/json' },
      body: { status: 'PASS', conditionNotes: 'Looks fine' }
    });

    // Then measured, and the height condemns it.
    await app.dispatch({
      method: 'POST',
      url: '/api/inspections',
      headers: { authorization: `Bearer ${inspectorToken}`, 'content-type': 'application/json' },
      body: {
        wagonNumber, bogieType: 'CASNUB_22_NLB', condition: 'USED',
        springPosition: 'OUTER', bogiePosition: 'BOGIE_1', measuredFreeHeight: 241.0
      }
    });

    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });
    const item = res.body.data.allItems.find(
      (i: any) => i.category === 'SPRINGS' && i.partName.includes('Outer Spring (Bogie 1)')
    );
    assert.equal(item.status, 'PASS', 'the person who looked at it is not overruled by a number');
    assert.ok(item.measurementConflict, 'but the measurement is not thrown away either');
    assert.match(item.measurementConflict.reason, /241/);

    const gate = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/gate/status`,
      headers: { authorization: `Bearer ${supervisorToken}` }
    });
    assert.equal(gate.body.data.canRelease, false);
    assert.ok(
      gate.body.data.blockers.some((b: string) => /Outer Spring \(Bogie 1\)/.test(b)),
      'and the gate names the part rather than blocking for an unrelated reason'
    );
  });

  test('TC-CHK-04: Master Checklist Configuration endpoints (GET & POST /api/checklist/config)', async () => {
    // 1. Get default configs
    const getRes = await app.dispatch({
      method: 'GET',
      url: '/api/checklist/config?wagonType=BOXNHL',
      headers: { authorization: `Bearer ${inspectorToken}` }
    });
    assert.equal(getRes.status, 200);
    assert.ok(Array.isArray(getRes.body.data));
    assert.ok(getRes.body.data.length > 0);

    /*
     * 2. An administrator updates a rule — and a supervisor no longer can.
     *
     * This route was guarded by rank and accepted a supervisor. The checklist
     * template decides what must be inspected on every wagon of a type, so
     * editing it changes what the exit gate demands of every future wagon —
     * removing a mandatory item there weakens the gate everywhere at once.
     * The capability matrix holds that as checklist.configure, an
     * administrator's act, and the route now agrees with it. Nothing in the
     * interface calls this endpoint, so no screen changes.
     */
    const adminToken = generateToken({
      id: 'usr_adm_001',
      username: 'admin1',
      role: 'ADMIN',
      name: 'A. K. Mishra',
      employeeId: 'WRS-ADM-3001'
    });

    const refusedForSupervisor = await app.dispatch({
      method: 'POST',
      url: '/api/checklist/config',
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonType: 'BOXNHL', category: 'BODY_UNDERFRAME', partName: 'x', isMandatory: true }
    });
    assert.equal(refusedForSupervisor.status, 403, 'a supervisor can still rewrite the checklist template');

    const postRes = await app.dispatch({
      method: 'POST',
      url: '/api/checklist/config',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonType: 'BOXNHL',
        category: 'BODY_UNDERFRAME',
        partName: 'Roof Hatch Seal Inspection',
        isMandatory: true,
        standardReference: 'RDSO G-70 Special'
      }
    });
    assert.equal(postRes.status, 200);
    assert.equal(postRes.body.success, true);
  });
});
