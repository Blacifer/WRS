/**
 * Smart Acoustic Bearing & Pneumatic Leak Detection Integration Tests (Phase 3 - M5 / R3)
 * Indian Railways WRS Raipur
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Phase 3 M5: Smart Acoustic Bearing & Pneumatic Leak Detection (R3)', () => {
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

  test('TC-ACOUSTIC-01: Validates required fields on POST /api/acoustic/diagnose', async () => {
    // 1. Missing wagonNumber
    const res1 = await app.dispatch({
      method: 'POST',
      url: '/api/acoustic/diagnose',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        dominantFrequencyHz: 4500,
        peakDb: 70,
        anomalyType: 'AIR_LEAK'
      }
    });
    assert.equal(res1.status, 400);
    assert.equal(res1.body.error, 'INVALID_WAGON_NUMBER');

    // 2. Invalid anomalyType
    const res2 = await app.dispatch({
      method: 'POST',
      url: '/api/acoustic/diagnose',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'SECR/BOXNHL/9001',
        dominantFrequencyHz: 4500,
        peakDb: 70,
        anomalyType: 'INVALID_TYPE'
      }
    });
    assert.equal(res2.status, 400);
    assert.equal(res2.body.error, 'INVALID_ANOMALY_TYPE');

    // 3. Invalid frequency
    const res3 = await app.dispatch({
      method: 'POST',
      url: '/api/acoustic/diagnose',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'SECR/BOXNHL/9001',
        dominantFrequencyHz: -50,
        peakDb: 70,
        anomalyType: 'AIR_LEAK'
      }
    });
    assert.equal(res3.status, 400);
    assert.equal(res3.body.error, 'INVALID_FREQUENCY');

    // 4. Invalid peakDb
    const res4 = await app.dispatch({
      method: 'POST',
      url: '/api/acoustic/diagnose',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'SECR/BOXNHL/9001',
        dominantFrequencyHz: 4500,
        peakDb: 'invalid',
        anomalyType: 'AIR_LEAK'
      }
    });
    assert.equal(res4.status, 400);
    assert.equal(res4.body.error, 'INVALID_PEAK_DB');
  });

  test('TC-ACOUSTIC-02: Normal acoustic spectrum recording does not trigger blocker', async () => {
    const wagonNumber = 'SECR/BOXNHL/77010';

    // Register wagon
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    const res = await app.dispatch({
      method: 'POST',
      url: '/api/acoustic/diagnose',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber,
        dominantFrequencyHz: 420.5,
        peakDb: 48.2,
        anomalyType: 'NONE',
        confidence: 0.96,
        details: 'Workshop ambient sound nominal'
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.diagnosticResult.anomalyType, 'NONE');
    assert.equal(res.body.data.diagnosticResult.dominantFrequencyHz, 420.5);
    assert.equal(res.body.data.checklistItem, null);
  });

  test('TC-ACOUSTIC-03: Air leak hiss (>4.5 kHz) logs defect to BRAKE_SYSTEM and creates exit gate blocker', async () => {
    const wagonNumber = 'SECR/BOXNHL/77020';

    // Register wagon
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    // Run acoustic diagnostic detecting air leak
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/acoustic/diagnose',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber,
        dominantFrequencyHz: 6480.0,
        peakDb: 76.8,
        anomalyType: 'AIR_LEAK',
        confidence: 0.97,
        details: 'Continuous high-frequency pneumatic hiss detected at 6480 Hz'
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.diagnosticResult.anomalyType, 'AIR_LEAK');
    assert.equal(res.body.data.checklistItem.category, 'BRAKE_SYSTEM');
    assert.equal(res.body.data.checklistItem.status, 'FAIL');
    assert.equal(res.body.data.gateBlocked, true);
    assert.ok(res.body.data.blockers.some((b: string) => b.includes('BRAKE_SYSTEM') || b.includes('Air Hose')));

    // Check checklist state
    const chkRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    assert.equal(chkRes.status, 200);
    const brakeItems = chkRes.body.data.categories['BRAKE_SYSTEM'];
    const failedItem = brakeItems.find((i: any) => i.partName === 'Air Hose & Angle Cocks');
    assert.ok(failedItem, 'Air Hose checklist item should exist');
    assert.equal(failedItem.status, 'FAIL');
    assert.ok(failedItem.conditionNotes.includes('Acoustic defect detected'));
  });

  test('TC-ACOUSTIC-04: CTRB bearing defect (1.2 kHz periodic pulse) logs defect to BEARINGS and blocks gate signoff', async () => {
    const wagonNumber = 'SECR/BOXNHL/77030';

    // Register wagon
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    // Run acoustic diagnostic detecting bearing defect
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/acoustic/diagnose',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber,
        dominantFrequencyHz: 1205.0,
        peakDb: 84.5,
        anomalyType: 'BEARING_DEFECT',
        confidence: 0.94,
        details: 'Periodic CTRB impact pulse detected at 1205 Hz with crest factor 4.2'
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.diagnosticResult.anomalyType, 'BEARING_DEFECT');
    assert.equal(res.body.data.checklistItem.category, 'BEARINGS');
    assert.equal(res.body.data.checklistItem.status, 'FAIL');
    assert.equal(res.body.data.gateBlocked, true);

    // Verify Exit Gate API reflects active blocker
    const gateRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/gate/status`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    assert.equal(gateRes.status, 200);
    assert.equal(gateRes.body.data.canRelease, false);
    assert.ok(gateRes.body.data.blockers.some((b: string) => b.includes('BEARINGS') || b.includes('CTRB Cartridge Bearing')));

    // Attempting supervisor signoff must fail due to zero-defect blocker
    const signoffRes = await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/gate/signoff`,
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        'content-type': 'application/json'
      },
      body: {
        digitalSignature: 'SIG_SHA256_TEST',
        notes: 'Attempted signoff with bearing acoustic blocker'
      }
    });

    assert.equal(signoffRes.status, 422);
    assert.equal(signoffRes.body.success, false);
  });

  test('TC-ACOUSTIC-05: Query acoustic diagnostic history on GET /api/acoustic/history/:wagonNumber', async () => {
    const wagonNumber = 'SECR/BOXNHL/77040';

    // Register wagon
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    // Log multiple acoustic readings
    await app.dispatch({
      method: 'POST',
      url: '/api/acoustic/diagnose',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber,
        dominantFrequencyHz: 450,
        peakDb: 42.0,
        anomalyType: 'NONE'
      }
    });

    await app.dispatch({
      method: 'POST',
      url: '/api/acoustic/diagnose',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber,
        dominantFrequencyHz: 6520,
        peakDb: 79.2,
        anomalyType: 'AIR_LEAK'
      }
    });

    // Query history
    const historyRes = await app.dispatch({
      method: 'GET',
      url: `/api/acoustic/history/${wagonNumber}`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    assert.equal(historyRes.status, 200);
    assert.equal(historyRes.body.success, true);
    assert.equal(historyRes.body.data.length, 2);
    assert.equal(historyRes.body.data[0].anomalyType, 'AIR_LEAK');
    assert.equal(historyRes.body.data[1].anomalyType, 'NONE');
  });
});
