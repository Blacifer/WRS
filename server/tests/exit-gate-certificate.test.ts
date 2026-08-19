/**
 * Zero-Defect Exit Gate & Release Certification Tests (Phase 2 - R3)
 * Indian Railways WRS Raipur
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Phase 2 R3: Zero-Defect Exit Gate & Release Certification', () => {
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

  test('TC-GATE-01: Exit Gate correctly evaluates active blockers on incomplete wagon', async () => {
    const wagonNumber = 'NR/BOXNHL/77001';
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' }
    });

    const gateRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/gate/status`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    assert.equal(gateRes.status, 200);
    assert.equal(gateRes.body.data.canRelease, false);
    assert.ok(gateRes.body.data.blockers.length > 0);
    // Should flag missing inspections and wrong stage
    assert.ok(gateRes.body.data.blockers.some((b: string) => b.includes('has not been inspected')));
    assert.ok(gateRes.body.data.blockers.some((b: string) => b.includes('FINAL_QC_GATE')));
  });

  test('TC-GATE-02: Condemned spring in Phase 1 creates a critical release blocker', async () => {
    const wagonNumber = 'NR/BOXNHL/77002';
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' }
    });

    // Log condemned spring
    await app.dispatch({
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
        measuredFreeHeight: 240.0 // Condemned
      }
    });

    const gateRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/gate/status`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    assert.equal(gateRes.body.data.canRelease, false);
    assert.ok(gateRes.body.data.blockers.some((b: string) => b.includes('Condemned spring in Bogie')));
  });

  test('TC-GATE-03: Supervisor sign-off rejected with 422 when blockers are active', async () => {
    const wagonNumber = 'NR/BOXNHL/77001';
    const signoffRes = await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/gate/signoff`,
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        'content-type': 'application/json'
      },
      body: {
        digitalSignature: 'HMAC-SHA256-TEST-SIG',
        otpToken: 'test_token_override'
      }
    });

    assert.equal(signoffRes.status, 422);
    assert.equal(signoffRes.body.success, false);
    assert.equal(signoffRes.body.error, 'RELEASE_GATE_BLOCKED');
    assert.ok(Array.isArray(signoffRes.body.blockers));
  });

  test('TC-GATE-04: Full Zero-Defect clearance, Supervisor Sign-off with OTP, and Certificate Generation', async () => {
    const wagonNumber = 'SECR/BOXNHL/77003';
    // 1. Register wagon
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    // 2. Advance through stages 1 -> 6 (FINAL_QC_GATE)
    const stages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'];
    for (const stg of stages) {
      await app.dispatch({
        method: 'POST',
        url: `/api/wagons/${wagonNumber}/transition`,
        headers: {
          authorization: `Bearer ${inspectorToken}`,
          'content-type': 'application/json'
        },
        body: { targetStage: stg }
      });
    }

    // 3. Mark all checklist items as PASS
    const chkRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    for (const item of chkRes.body.data.allItems) {
      await app.dispatch({
        method: 'PUT',
        url: `/api/wagons/${wagonNumber}/checklist/items/${item.id}`,
        headers: {
          authorization: `Bearer ${inspectorToken}`,
          'content-type': 'application/json'
        },
        body: { status: 'PASS', reinspectedStatus: 'PASS' }
      });
    }

    // 4. Log Phase 1 spring inspection with PASS
    await app.dispatch({
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
        measuredFreeHeight: 258.0 // Band III Yellow
      }
    });

    // 5. Evaluate Exit Gate -> should be CLEARED (canRelease = true)
    const gateRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/gate/status`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    assert.equal(gateRes.status, 200);
    assert.equal(gateRes.body.data.canRelease, true, `Expected canRelease true but got blockers: ${gateRes.body.data.blockers.join(', ')}`);
    assert.equal(gateRes.body.data.blockers.length, 0);

    // 6. Supervisor Digital Sign-off
    const signoffRes = await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/gate/signoff`,
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        'content-type': 'application/json'
      },
      body: {
        digitalSignature: 'HMAC-SHA256-SUPERVISOR-SIGNATURE-HEX-001',
        otpToken: 'test_token_override',
        notes: 'Final QC Gate cleared with zero defects. Wagon approved for release.'
      }
    });

    assert.equal(signoffRes.status, 200);
    assert.equal(signoffRes.body.success, true);
    assert.ok(signoffRes.body.data.certificateNumber.startsWith('WRS/QC-REL/'));
    assert.ok(signoffRes.body.data.certificateHash.length >= 32);

    // 7. Verify Wagon is now in Stage 7 (RELEASE)
    const wagonDetail = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });
    assert.equal(wagonDetail.body.data.currentStage, 'RELEASE');
    assert.equal(wagonDetail.body.data.status, 'RELEASED');

    // 8. Generate Official Release Certificate (JSON)
    const certJsonRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/certificate?format=json`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });
    assert.equal(certJsonRes.status, 200);
    assert.equal(certJsonRes.body.data.wagon.wagonNumber, wagonNumber);
    assert.ok(certJsonRes.body.data.qrData.includes('INDIAN_RAILWAYS'));

    // 9. Generate Official Release Certificate (HTML printable format)
    const certHtmlRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/certificate?format=html`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });
    assert.equal(certHtmlRes.status, 200);
    assert.ok(certHtmlRes.body.includes('INDIAN RAILWAYS'));
    assert.ok(certHtmlRes.body.includes(wagonNumber));
    assert.ok(certHtmlRes.body.includes('SUPERVISOR DIGITAL SIGN-OFF'));
  });
});
