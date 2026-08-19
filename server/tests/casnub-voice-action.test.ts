/**
 * Hands-Free Voice Action API & Audit Logging Tests (Milestone 3)
 * Indian Railways WRS Raipur
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Milestone 3: Voice Action API & Audit Trail Tests', () => {
  let app: ExpressApp;
  let inspectorToken: string;

  before(() => {
    app = createApp(':memory:');
    inspectorToken = generateToken({
      id: 'usr_insp_001',
      username: 'inspector1',
      role: 'INSPECTOR',
      name: 'Ramesh Kumar',
      employeeId: 'WRS-INSP-1042'
    });
  });

  test('TC-VOICE-01: Rejects voice action with missing wagonNumber (400)', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/checklist/voice-action',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        status: 'PASS',
        transcript: 'Outer spring passes'
      }
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'MISSING_WAGON_NUMBER');
  });

  test('TC-VOICE-02: Rejects voice action with invalid status (400)', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/checklist/voice-action',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'NR/BOXNHL/99001',
        status: 'INVALID_STATUS_CODE',
        transcript: 'Outer spring something'
      }
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'INVALID_STATUS');
  });

  test('TC-VOICE-03: Records valid voice action for existing wagon checklist item and logs immutable audit trail', async () => {
    const wagonNumber = 'NR/BOXNHL/99001';
    // 1. Register wagon
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' }
    });

    // 2. Submit voice action: "Outer spring passes"
    const voiceRes = await app.dispatch({
      method: 'POST',
      url: '/api/checklist/voice-action',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber,
        itemName: 'Outer Spring (Bogie 1)',
        category: 'SPRINGS',
        status: 'PASS',
        transcript: 'Outer spring passes',
        language: 'en-IN',
        confidence: 0.98
      }
    });

    assert.equal(voiceRes.status, 200);
    assert.equal(voiceRes.body.success, true);
    assert.equal(voiceRes.body.data.item.status, 'PASS');
    assert.ok(voiceRes.body.data.auditLogId);
    assert.equal(voiceRes.body.data.actionRecorded.status, 'PASS');
    assert.equal(voiceRes.body.data.actionRecorded.transcript, 'Outer spring passes');

    // 3. Verify checklist item state updated
    const chkRes = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });
    assert.equal(chkRes.status, 200);
    const springs = chkRes.body.data.categories.SPRINGS;
    const outer1 = springs.find((s: any) => s.partName === 'Outer Spring (Bogie 1)');
    assert.ok(outer1);
    assert.equal(outer1.status, 'PASS');
  });

  test('TC-VOICE-04: Records voice action with defect notes: "Condemn friction wedge - deep crack 3mm"', async () => {
    const wagonNumber = 'NR/BOXNHL/99001';
    const voiceRes = await app.dispatch({
      method: 'POST',
      url: '/api/checklist/voice-action',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber,
        itemName: 'Wedge Main Slope Surface',
        category: 'FRICTION_WEDGES',
        status: 'CONDEMNED',
        defectNotes: 'Deep crack / fracture detected (3mm gap)',
        transcript: 'Friction wedge condemn deep crack',
        language: 'en-IN',
        confidence: 0.95
      }
    });

    assert.equal(voiceRes.status, 200);
    assert.equal(voiceRes.body.success, true);
    assert.equal(voiceRes.body.data.item.status, 'CONDEMNED');
    assert.equal(voiceRes.body.data.item.conditionNotes, 'Deep crack / fracture detected (3mm gap)');
  });

  test('TC-VOICE-05: Handles REPAIRED and REPLACED status with automatic repair action assignment', async () => {
    const wagonNumber = 'NR/BOXNHL/99001';
    const voiceRes = await app.dispatch({
      method: 'POST',
      url: '/api/checklist/voice-action',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber,
        itemName: 'CTRB Cartridge Bearing Rotation',
        category: 'BEARINGS',
        status: 'REPLACED',
        transcript: 'CTRB bearing replaced with new',
        language: 'en-IN'
      }
    });

    assert.equal(voiceRes.status, 200);
    assert.equal(voiceRes.body.success, true);
    assert.equal(voiceRes.body.data.item.status, 'REPLACED');
    assert.equal(voiceRes.body.data.item.repairAction, 'REPLACED_NEW');
    assert.equal(voiceRes.body.data.item.reinspectedStatus, 'PASS');
  });
});
