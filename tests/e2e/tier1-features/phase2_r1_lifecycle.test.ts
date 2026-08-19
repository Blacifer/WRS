/**
 * Tier 1 Test Suite — Feature R1: 7-Stage Wagon Lifecycle Tracking
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Verifies wagon registration, sequential stage progression, transition audit logging,
 * supervisor override rules, and timeline queries.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type { WagonRecord, LifecycleTransition } from '../../../shared/types.ts';

describe('Tier 1 — R1: 7-Stage Wagon Lifecycle Tracking', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;
  });

  // Test Case 1: Valid Wagon Registration
  it('TC-P2-R1-01: Valid wagon registration initializes wagon at Stage 1 (ENTRY_REGISTRATION) with CASNUB checklist', async () => {
    const regRes = await app.post(
      '/api/wagons/register',
      {
        wagonNumber: 'NR/BOXNHL/12345',
        wagonType: 'BOXNHL',
        owningRailway: 'NR',
        entryNotes: 'Routine 18-month POH arrival from Northern Railway'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(regRes.status, 201);
    const body = regRes.body as { wagon: WagonRecord; checklistCount: number };

    assert.ok(body.wagon);
    assert.strictEqual(body.wagon.wagonNumber, 'NR/BOXNHL/12345');
    assert.strictEqual(body.wagon.wagonType, 'BOXNHL');
    assert.strictEqual(body.wagon.owningRailway, 'NR');
    assert.strictEqual(body.wagon.currentStage, 'ENTRY_REGISTRATION');
    assert.strictEqual(body.wagon.isReleased, false);
    assert.ok(body.wagon.entryDate);
    assert.ok(body.checklistCount >= 20, 'Initial CASNUB checklist should have items across all categories');

    // Verify timeline has initial entry
    const timelineRes = await app.get('/api/wagons/NR%2FBOXNHL%2F12345/timeline', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(timelineRes.status, 200);
    const timeline = timelineRes.body as { transitions: LifecycleTransition[] };
    assert.strictEqual(timeline.transitions.length, 1);
    assert.strictEqual(timeline.transitions[0].toStage, 'ENTRY_REGISTRATION');
  });

  // Test Case 2: Sequential Stage Progression
  it('TC-P2-R1-02: Progresses sequentially through all 7 stages with audit transition logging', async () => {
    const wagonNumber = 'SECR/BCNHL/99001';
    await app.post(
      '/api/wagons/register',
      {
        wagonNumber,
        wagonType: 'BCNHL',
        owningRailway: 'SECR',
        entryNotes: 'Overhaul entry'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    const stages = [
      'DISMANTLING',
      'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT',
      'REASSEMBLY',
      'FINAL_QC_GATE'
    ] as const;

    for (const stage of stages) {
      const transRes = await app.post(
        `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
        {
          targetStage: stage,
          notes: `Transitioning to ${stage}`
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );

      assert.strictEqual(transRes.status, 200, `Failed transitioning to ${stage}`);
      const body = transRes.body as { wagon: WagonRecord; transition: LifecycleTransition };
      assert.strictEqual(body.wagon.currentStage, stage);
      assert.strictEqual(body.transition.toStage, stage);
      assert.strictEqual(body.transition.isOverride, false);
    }

    // Verify wagon details reflect current stage
    const detailRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(detailRes.status, 200);
    const detail = detailRes.body as { wagon: WagonRecord; timeline: LifecycleTransition[] };
    assert.strictEqual(detail.wagon.currentStage, 'FINAL_QC_GATE');
    assert.strictEqual(detail.timeline.length, 6); // 1 register + 5 transitions
  });

  // Test Case 3: Immutable Transition Audit Trail
  it('TC-P2-R1-03: Stage transitions generate immutable timeline history with monotonic sequence tracking', async () => {
    const wagonNumber = 'CR/BOBRN/55123';
    await app.post(
      '/api/wagons/register',
      { wagonNumber, wagonType: 'BOBRN', owningRailway: 'CR' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      { targetStage: 'DISMANTLING', notes: 'Bogie dismantled into frame, wheelsets, and brake gear' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      { targetStage: 'COMPONENT_INSPECTION', notes: 'Inspection underway on all 8 CASNUB categories' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    const timelineRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/timeline`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(timelineRes.status, 200);
    const { transitions } = timelineRes.body as { transitions: LifecycleTransition[] };

    assert.strictEqual(transitions.length, 3);
    assert.strictEqual(transitions[0].fromStage, 'ENTRY_REGISTRATION');
    assert.strictEqual(transitions[0].toStage, 'ENTRY_REGISTRATION');
    assert.strictEqual(transitions[1].fromStage, 'ENTRY_REGISTRATION');
    assert.strictEqual(transitions[1].toStage, 'DISMANTLING');
    assert.strictEqual(transitions[2].fromStage, 'DISMANTLING');
    assert.strictEqual(transitions[2].toStage, 'COMPONENT_INSPECTION');

    for (const t of transitions) {
      assert.ok(t.userId);
      assert.ok(t.timestamp);
      assert.strictEqual(t.wagonNumber, wagonNumber);
    }
  });

  // Test Case 4: Non-sequential Forward Skipping & Supervisor Override
  it('TC-P2-R1-04: Non-sequential forward stage skipping is blocked for inspectors and permitted for supervisors with justification', async () => {
    const wagonNumber = 'WR/BOXNHL/77112';
    await app.post(
      '/api/wagons/register',
      { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'WR' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 1. Inspector attempts to skip Stage 2 (DISMANTLING) straight to Stage 3 (COMPONENT_INSPECTION) -> 400
    const skipFail = await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      { targetStage: 'COMPONENT_INSPECTION', notes: 'Attempting skip without override' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.ok(skipFail.status === 400 || skipFail.status === 403);

    // 2. Supervisor attempts skip without justification -> 400
    const supNoJust = await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      { targetStage: 'COMPONENT_INSPECTION', supervisorOverride: true, overrideJustification: '' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(supNoJust.status, 400);

    // 3. Supervisor provides valid justification -> 200
    const justification = 'Unitary bogie overhaul skip permitted per Chief Workshop Engineer authorization CWE/2026/WRS-77';
    const supSkipSuccess = await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      {
        targetStage: 'COMPONENT_INSPECTION',
        supervisorOverride: true,
        overrideJustification: justification
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );

    assert.strictEqual(supSkipSuccess.status, 200);
    const body = supSkipSuccess.body as { wagon: WagonRecord; transition: LifecycleTransition };
    assert.strictEqual(body.wagon.currentStage, 'COMPONENT_INSPECTION');
    assert.strictEqual(body.transition.isOverride, true);
    assert.strictEqual(body.transition.overrideJustification, justification);
  });

  // Test Case 5: Backward Stage Transition
  it('TC-P2-R1-05: Backward stage transitions strictly require supervisor override and mandatory justification', async () => {
    const wagonNumber = 'ER/BOXN/33445';
    await app.post(
      '/api/wagons/register',
      { wagonNumber, wagonType: 'BOXN', owningRailway: 'ER' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // Advance to Stage 2 and Stage 3
    await app.post(`/api/wagons/${encodeURIComponent(wagonNumber)}/transition`, { targetStage: 'DISMANTLING' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post(`/api/wagons/${encodeURIComponent(wagonNumber)}/transition`, { targetStage: 'COMPONENT_INSPECTION' }, { Authorization: `Bearer ${inspectorToken}` });

    // Inspector tries to move backward from Stage 3 to Stage 2 -> Rejected
    const inspBack = await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      { targetStage: 'DISMANTLING', notes: 'Rollback' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.ok(inspBack.status === 400 || inspBack.status === 403);

    // Supervisor moves backward with justification -> Success
    const rollbackReason = 'Secondary bolster defect discovered requiring full frame re-dismantling';
    const supBack = await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      {
        targetStage: 'DISMANTLING',
        supervisorOverride: true,
        overrideJustification: rollbackReason
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );

    assert.strictEqual(supBack.status, 200);
    const body = supBack.body as { wagon: WagonRecord; transition: LifecycleTransition };
    assert.strictEqual(body.wagon.currentStage, 'DISMANTLING');
    assert.strictEqual(body.transition.fromStage, 'COMPONENT_INSPECTION');
    assert.strictEqual(body.transition.toStage, 'DISMANTLING');
    assert.strictEqual(body.transition.isOverride, true);
    assert.strictEqual(body.transition.overrideJustification, rollbackReason);
  });

  // Test Case 6: Wagon Querying and Filtering
  it('TC-P2-R1-06: Wagon list API filters by stage, wagonType, owningRailway, and search query', async () => {
    const w1 = 'NR/BOXNHL/101';
    const w2 = 'SECR/BCNHL/202';
    const w3 = 'CR/BOBRN/303';

    await app.post('/api/wagons/register', { wagonNumber: w1, wagonType: 'BOXNHL', owningRailway: 'NR' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post('/api/wagons/register', { wagonNumber: w2, wagonType: 'BCNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post('/api/wagons/register', { wagonNumber: w3, wagonType: 'BOBRN', owningRailway: 'CR' }, { Authorization: `Bearer ${inspectorToken}` });

    await app.post(`/api/wagons/${encodeURIComponent(w2)}/transition`, { targetStage: 'DISMANTLING' }, { Authorization: `Bearer ${inspectorToken}` });

    // Filter by stage
    const filterStage = await app.get('/api/wagons?stage=DISMANTLING', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(filterStage.status, 200);
    const stageWagons = (filterStage.body as { wagons: WagonRecord[] }).wagons;
    assert.strictEqual(stageWagons.length, 1);
    assert.strictEqual(stageWagons[0].wagonNumber, w2);

    // Filter by railway
    const filterRailway = await app.get('/api/wagons?owningRailway=NR', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(filterRailway.status, 200);
    const nrWagons = (filterRailway.body as { wagons: WagonRecord[] }).wagons;
    assert.strictEqual(nrWagons.length, 1);
    assert.strictEqual(nrWagons[0].wagonNumber, w1);

    // Filter by search query
    const searchRes = await app.get('/api/wagons?search=BOBRN', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(searchRes.status, 200);
    const searched = (searchRes.body as { wagons: WagonRecord[] }).wagons;
    assert.strictEqual(searched.length, 1);
    assert.strictEqual(searched[0].wagonNumber, w3);
  });

});
