/**
 * Wagon Lifecycle State Machine & Transition Tests (Phase 2 - R1)
 * Indian Railways WRS Raipur
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Phase 2 R1: 7-Stage Wagon Lifecycle Tracking & State Machine', () => {
  let app: ExpressApp;
  let inspectorToken: string;
  let supervisorToken: string;
  let adminToken: string;

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
    adminToken = generateToken({
      id: 'usr_adm_001',
      username: 'admin1',
      role: 'ADMIN',
      name: 'A. K. Mishra',
      employeeId: 'WRS-ADM-0001'
    });
  });

  test('TC-WAG-01: Successfully registers new wagon in Stage 1 (ENTRY_REGISTRATION)', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'NR/BOXNHL/99001',
        wagonType: 'BOXNHL',
        owningRailway: 'NR',
        entryNotes: 'Intake inspection for 100T rake'
      }
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.wagonNumber, 'NR/BOXNHL/99001');
    assert.equal(res.body.data.currentStage, 'ENTRY_REGISTRATION');
    assert.equal(res.body.data.status, 'IN_PROGRESS');
  });

  test('TC-WAG-02: Duplicate wagon registration returns 409 Conflict', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'NR/BOXNHL/99001',
        wagonType: 'BOXNHL',
        owningRailway: 'NR'
      }
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'WAGON_ALREADY_EXISTS');
  });

  test('TC-WAG-03: Sequential forward progression from Stage 1 through Stage 6', async () => {
    const wagonNumber = 'NR/BOXNHL/99002';
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' }
    });

    const stages = [
      'DISMANTLING',
      'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT',
      'REASSEMBLY',
      'FINAL_QC_GATE'
    ];

    for (const targetStage of stages) {
      const res = await app.dispatch({
        method: 'POST',
        url: `/api/wagons/${wagonNumber}/transition`,
        headers: {
          authorization: `Bearer ${inspectorToken}`,
          'content-type': 'application/json'
        },
        body: { targetStage, notes: `Advancing to ${targetStage}` }
      });

      assert.equal(res.status, 200, `Failed transitioning to ${targetStage}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.data.wagon.currentStage, targetStage);
    }
  });

  test('TC-WAG-04: Direct transition to Stage 7 (RELEASE) rejected on generic transition endpoint without override', async () => {
    const wagonNumber = 'NR/BOXNHL/99002';
    const res = await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/transition`,
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { targetStage: 'RELEASE' }
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Exit Gate Digital Sign-off/);
  });

  test('TC-WAG-05: Stage skipping by Inspector without override is rejected with 400', async () => {
    const wagonNumber = 'NR/BOXNHL/99003';
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' }
    });

    // Try jumping Stage 1 -> Stage 3 directly
    const res = await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/transition`,
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { targetStage: 'COMPONENT_INSPECTION' }
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Sequential workflow violation/);
  });

  test('TC-WAG-06: Stage skipping with Inspector role even with override flag is rejected with 403 Forbidden', async () => {
    const wagonNumber = 'NR/BOXNHL/99003';
    const res = await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/transition`,
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        targetStage: 'COMPONENT_INSPECTION',
        supervisorOverride: true,
        overrideJustification: 'Bypassing dismantling for quick inspection'
      }
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /strictly requires SUPERVISOR or ADMIN/);
  });

  test('TC-WAG-07: Stage skipping with Supervisor role and justification >= 10 chars is permitted', async () => {
    const wagonNumber = 'NR/BOXNHL/99003';
    const res = await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/transition`,
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        'content-type': 'application/json'
      },
      body: {
        targetStage: 'COMPONENT_INSPECTION',
        supervisorOverride: true,
        overrideJustification: 'Fast-track POH inspection approved by CWM',
        otpToken: 'test_token_override'
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.wagon.currentStage, 'COMPONENT_INSPECTION');
    assert.equal(res.body.data.transition.isOverride, true);
  });

  test('TC-WAG-08: Backward transition requires Supervisor role and non-empty justification', async () => {
    const wagonNumber = 'NR/BOXNHL/99003';
    // Currently at COMPONENT_INSPECTION (Stage 3), try going back to DISMANTLING (Stage 2)

    // 1. Without supervisor role
    const res1 = await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/transition`,
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { targetStage: 'DISMANTLING', supervisorOverride: true, overrideJustification: 'Need re-strip' }
    });
    assert.equal(res1.status, 403);

    // 2. With supervisor role but short justification
    const res2 = await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/transition`,
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        'content-type': 'application/json'
      },
      body: { targetStage: 'DISMANTLING', supervisorOverride: true, overrideJustification: 'Short' }
    });
    assert.equal(res2.status, 400);

    // 3. With supervisor role and valid justification
    const res3 = await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/transition`,
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        'content-type': 'application/json'
      },
      body: {
        targetStage: 'DISMANTLING',
        supervisorOverride: true,
        overrideJustification: 'Defect discovered during inspection requiring full re-dismantling',
        otpToken: 'test_token_override'
      }
    });
    assert.equal(res3.status, 200);
    assert.equal(res3.body.data.wagon.currentStage, 'DISMANTLING');
  });

  test('TC-WAG-09: Wagon timeline endpoint returns chronological history and dwell times', async () => {
    const wagonNumber = 'NR/BOXNHL/99003';
    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/timeline`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 3);
    assert.equal(res.body.data[0].fromStage, 'ENTRY_REGISTRATION');
  });
});
