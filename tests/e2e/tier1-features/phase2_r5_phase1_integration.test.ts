/**
 * Tier 1 Test Suite — Feature R5: Deep Phase 1 Spring System Integration
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Verifies auto-population of Phase 1 spring classifications into wagon QC checklist,
 * spring condemnation gate blocker propagation, unified wagon detail view, and unified RBAC.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type {
  ChecklistItem,
  GateStatusResponse,
  WagonRecord,
  InspectionRecord
} from '../../../shared/types.ts';

describe('Tier 1 — R5: Deep Phase 1 Spring Integration', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  const wagonNumber = 'NR/BOXNHL/54321';

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    await app.post(
      '/api/wagons/register',
      { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
  });

  // Test Case 1: Auto-population of Phase 1 Spring Classifications
  it('TC-P2-R5-01: Phase 1 spring inspection results automatically sync into the wagon checklist (SPRINGS category)', async () => {
    // 1. Log 3 passing springs for the wagon in Phase 1
    const spring1 = await app.post(
      '/api/inspections',
      {
        wagonNumber,
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 262.0 // Band I (Blue) - PASS
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(spring1.status, 201);

    const spring2 = await app.post(
      '/api/inspections',
      {
        wagonNumber,
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'INNER',
        condition: 'USED',
        measuredFreeHeight: 264.0 // Band I (Blue) - PASS
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(spring2.status, 201);

    // 2. Query wagon checklist and verify SPRINGS category is auto-populated and PASS
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(chkRes.status, 200);
    const { items } = chkRes.body as { items: ChecklistItem[] };
    const springItems = items.filter(i => i.category === 'SPRINGS');

    assert.ok(springItems.length > 0);
    for (const item of springItems) {
      assert.strictEqual(item.status, 'PASS');
      assert.ok(item.conditionNotes?.includes('Phase 1 verified'));
    }
  });

  // Test Case 2: Condemned Spring in Phase 1 Blocks Exit Gate
  it('TC-P2-R5-02: A condemned spring logged in Phase 1 directly blocks Exit Gate release in Phase 2', async () => {
    // 1. Log a condemned spring in Phase 1 (e.g. out of range height 240mm for NLB Outer Used)
    const badSpring = await app.post(
      '/api/inspections',
      {
        wagonNumber,
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 240.0 // Below 245mm -> CONDEMNED
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(badSpring.status, 201);
    assert.strictEqual((badSpring.body as InspectionRecord).status, 'CONDEMNED');

    // 2. Advance wagon to Stage 6 (FINAL_QC_GATE)
    const stages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of stages) {
      await app.post(`/api/wagons/${encodeURIComponent(wagonNumber)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // 3. Mark all other checklist items as PASS
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;
    for (const item of items) {
      if (item.category !== 'SPRINGS') {
        await app.put(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${item.id}`, { status: 'PASS' }, { Authorization: `Bearer ${inspectorToken}` });
      }
    }

    // 4. Verify Exit Gate evaluator blocks release specifically due to Phase 1 condemned spring
    const gateRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/gate/status`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(gateRes.status, 200);
    const gate = gateRes.body as GateStatusResponse;

    assert.strictEqual(gate.canRelease, false);
    assert.ok(gate.blockers.some(b => b.includes('condemned spring(s) that must be replaced')));
    assert.strictEqual(gate.summary.springCheck.hasCondemnedSprings, true);
  });

  // Test Case 3: Remediation of Condemned Spring Clears Blocker
  it('TC-P2-R5-03: Replacing and logging a new passing spring in Phase 1 clears the spring Exit Gate blocker', async () => {
    // 1. Initial condemned spring
    await app.post(
      '/api/inspections',
      { wagonNumber, bogieType: 'CASNUB_22_NLB', springPosition: 'OUTER', condition: 'USED', measuredFreeHeight: 240.0 },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 2. In Stage 4 (REPAIR_REPLACEMENT), defective spring is replaced with a brand new spring
    // Create new inspection showing replacement spring is PASS
    const newSpring = await app.post(
      '/api/inspections',
      {
        wagonNumber,
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'NEW',
        measuredFreeHeight: 262.0 // Table 31 Band I (Green) - PASS
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(newSpring.status, 201);
    assert.strictEqual((newSpring.body as InspectionRecord).status, 'PASS');

    // 3. Mark spring checklist item as REPLACED
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;
    for (const item of items) {
      await app.put(
        `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${item.id}`,
        { status: item.category === 'SPRINGS' ? 'REPLACED' : 'PASS', repairAction: 'REPLACED_NEW', repairNotes: 'Replaced condemned spring with new unit' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
    }

    // 4. Verify gate status for wagon
    const gateRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/gate/status`, { Authorization: `Bearer ${inspectorToken}` });
    const gate = gateRes.body as GateStatusResponse;
    assert.strictEqual(gate.summary.failedMandatory, 0);
  });

  // Test Case 4: Unified Wagon Detail View
  it('TC-P2-R5-04: Unified wagon detail endpoint combines Phase 1 spring stats, CASNUB checklist, photos, and timeline', async () => {
    // Log spring
    await app.post(
      '/api/inspections',
      { wagonNumber, bogieType: 'CASNUB_22_NLB', springPosition: 'OUTER', condition: 'USED', measuredFreeHeight: 260.0 },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // Upload photo
    await app.post(
      '/api/photos/upload',
      { wagonNumber, partCategory: 'SPRINGS', partName: 'Outer Springs Bogie-1', imageBase64: 'data:image/jpeg;base64,dGVzdA==' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    const detailRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(detailRes.status, 200);
    const detail = detailRes.body as {
      wagon: WagonRecord;
      timeline: any[];
      checklistSummary: any;
      springSummary: { totalSprings: number; passedSprings: number; condemnedSprings: number };
      photosCount: number;
    };

    assert.ok(detail.wagon);
    assert.strictEqual(detail.wagon.wagonNumber, wagonNumber);
    assert.ok(detail.timeline.length >= 1);
    assert.ok(detail.checklistSummary.totalItems > 0);
    assert.strictEqual(detail.springSummary.totalSprings, 1);
    assert.strictEqual(detail.springSummary.passedSprings, 1);
    assert.strictEqual(detail.photosCount, 1);
  });

  // Test Case 5: Single Auth Session and Unified RBAC
  it('TC-P2-R5-05: Single auth token grants access across both Phase 1 and Phase 2 endpoints with unified RBAC boundaries', async () => {
    // Inspector token can classify in Phase 1 AND register/transition in Phase 2
    const classRes = await app.post(
      '/api/classification/classify',
      { bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'OUTER', measuredHeight: 260.0 },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(classRes.status, 200);

    const p2Checklist = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(p2Checklist.status, 200);

    // Inspector is forbidden from supervisor actions in both Phase 1 (override without supervisor role) and Phase 2 (exit gate sign-off)
    const p2SignoffForbidden = await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/gate/signoff`,
      { supervisorId: 'inspector1', digitalSignature: 'unauthorized-hash' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(p2SignoffForbidden.status, 403);
  });

});
