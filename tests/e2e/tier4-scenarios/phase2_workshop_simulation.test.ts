/**
 * Tier 4 Test Suite — Real-World Workshop E2E Simulation Scenarios (Phase 2)
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Implements high-fidelity end-to-end simulations of Raipur workshop operations:
 * 1. Multi-Wagon Overhaul Simulation across BOXNHL, BCNHL, BOBRN classes with repairs,
 *    photos, gate clearances, digital sign-offs, and compliance exports.
 * 2. Mobile Yard Offline Shift Ingestion with bulk reconnection sync.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type {
  WagonRecord,
  ChecklistItem,
  GateStatusResponse,
  ReleaseCertificate,
  AnalyticsPipelineResponse,
  AnalyticsTATResponse,
  PhotoRecord,
  WagonBatchSyncPayload,
  WagonBatchSyncResponse
} from '../../../shared/types.ts';

describe('Tier 4 — Workshop E2E Simulation Scenarios (Phase 2)', () => {
  let app: TestApp;
  let adminToken: string;
  let inspectorToken: string;
  let supervisorToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const adminLogin = await app.post('/api/auth/login', { username: 'admin1', password: 'password123' });
    adminToken = (adminLogin.body as { token: string }).token;

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;
  });

  // Scenario 1: Multi-Wagon Workshop Overhaul Simulation Across 3 Wagon Classes
  it('TC-P2-SIM-01: Multi-Wagon Workshop Overhaul Simulation across BOXNHL, BCNHL, BOBRN classes', async () => {
    const wagonTypes = ['BOXNHL', 'BCNHL', 'BOBRN'] as const;
    const railways = ['SECR', 'NR', 'WR', 'CR', 'ER'] as const;
    const registeredWagons: string[] = [];

    // 1. Register 15 wagons (5 per wagon type)
    let wagonIdx = 1;
    for (const wType of wagonTypes) {
      for (let i = 1; i <= 5; i++) {
        const railway = railways[(wagonIdx - 1) % railways.length];
        const wagonNumber = `${railway}/${wType}/${1000 + wagonIdx}`;
        registeredWagons.push(wagonNumber);

        const entryRes = await app.post(
          '/api/wagons/register',
          {
            wagonNumber,
            wagonType: wType,
            owningRailway: railway,
            entryNotes: `POH Overhaul Batch 2026-${wType}-${i}`
          },
          { Authorization: `Bearer ${inspectorToken}` }
        );
        assert.strictEqual(entryRes.status, 201, `Failed registering ${wagonNumber}`);
        wagonIdx++;
      }
    }

    assert.strictEqual(registeredWagons.length, 15);

    // 2. Perform Phase 1 Spring Inspections on all 15 wagons
    for (let i = 0; i < registeredWagons.length; i++) {
      const wNumber = registeredWagons[i];
      const isDefective = i % 5 === 0; // 20% condemnation rate (3 wagons have defective springs)

      await app.post(
        '/api/inspections',
        {
          wagonNumber: wNumber,
          bogieType: 'CASNUB_22_NLB',
          springPosition: 'OUTER',
          condition: 'USED',
          measuredFreeHeight: isDefective ? 238.0 : 261.0, // Defective is condemned
          damageType: isDefective ? 'CORROSION' : 'NONE',
          damageNotes: isDefective ? 'Severe pitting corrosion on outer coil' : undefined
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );
    }

    // 3. Progress wagons through overhaul lifecycle stages
    const stages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;

    for (const wNumber of registeredWagons) {
      for (const s of stages) {
        await app.post(
          `/api/wagons/${encodeURIComponent(wNumber)}/transition`,
          { targetStage: s, notes: `Advancing to ${s}` },
          { Authorization: `Bearer ${inspectorToken}` }
        );
      }
    }

    // 4. Overhaul Operations & Defect Remediation in Workshop
    for (let i = 0; i < registeredWagons.length; i++) {
      const wNumber = registeredWagons[i];
      const isDefective = i % 5 === 0;

      // Upload quality inspection photo
      const photoRes = await app.post(
        '/api/photos/upload',
        {
          wagonNumber: wNumber,
          partCategory: 'BRAKE_SYSTEM',
          partName: 'Brake Rigging & Lever',
          imageBase64: 'data:image/jpeg;base64,INSP_PHOTO_DATA',
          tags: ['POH_INSPECTION', 'BRAKE_SYSTEM']
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      const photoId = (photoRes.body as PhotoRecord).id;

      // Update checklist items
      const chkRes = await app.get(`/api/wagons/${encodeURIComponent(wNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
      const items = (chkRes.body as { items: ChecklistItem[] }).items;

      for (const item of items) {
        if (item.category === 'SPRINGS' && isDefective) {
          // Log replacement spring in Phase 1
          await app.post(
            '/api/inspections',
            {
              wagonNumber: wNumber,
              bogieType: 'CASNUB_22_NLB',
              springPosition: 'OUTER',
              condition: 'NEW',
              measuredFreeHeight: 262.0 // Table 31 Band I (Green)
            },
            { Authorization: `Bearer ${inspectorToken}` }
          );

          await app.put(
            `/api/wagons/${encodeURIComponent(wNumber)}/checklist/items/${item.id}`,
            {
              status: 'REPLACED',
              repairAction: 'REPLACED_NEW',
              repairNotes: 'Replaced corroded spring with new unit lot 2026-N-12',
              photoId
            },
            { Authorization: `Bearer ${inspectorToken}` }
          );
        } else {
          await app.put(
            `/api/wagons/${encodeURIComponent(wNumber)}/checklist/items/${item.id}`,
            {
              status: 'PASS',
              repairNotes: 'POH inspection passed'
            },
            { Authorization: `Bearer ${inspectorToken}` }
          );
        }
      }
    }

    // 5. Zero-Defect Exit Gate Verification & Digital Sign-off for All 15 Wagons
    for (const wNumber of registeredWagons) {
      const gateRes = await app.get(`/api/wagons/${encodeURIComponent(wNumber)}/gate/status`, { Authorization: `Bearer ${inspectorToken}` });
      const gate = gateRes.body as GateStatusResponse;
      assert.strictEqual(gate.summary.failedMandatory, 0, `Wagon ${wNumber} has failing mandatory items`);
      assert.strictEqual(gate.summary.totalCondemned, 0, `Wagon ${wNumber} has condemned items`);

      // Sign off wagon
      const signoffRes = await app.post(
        `/api/wagons/${encodeURIComponent(wNumber)}/gate/signoff`,
        {
          supervisorId: 'supervisor1',
          digitalSignature: `SIG-SIM-RELEASE-${wNumber}`,
          notes: '100% Zero-Defect Exit Gate clearance confirmed. Released for freight traffic.'
        },
        { Authorization: `Bearer ${supervisorToken}` }
      );
      assert.strictEqual(signoffRes.status, 200, `Signoff failed for ${wNumber}`);
      const body = signoffRes.body as { certificate: ReleaseCertificate; wagon: WagonRecord };
      assert.strictEqual(body.wagon.currentStage, 'RELEASE');
      assert.strictEqual(body.wagon.isReleased, true);
      assert.ok(body.certificate.certificateNumber.startsWith('WRS-RC-'));
    }

    // 6. DRM Analytics Verification
    const pipelineRes = await app.get('/api/analytics/pipeline', { Authorization: `Bearer ${adminToken}` });
    const pipeline = pipelineRes.body as AnalyticsPipelineResponse;
    assert.strictEqual(pipeline.counts.RELEASE, 15);
    assert.strictEqual(pipeline.totalActive, 0);
    assert.strictEqual(pipeline.totalReleased, 15);

    const tatRes = await app.get('/api/analytics/tat', { Authorization: `Bearer ${adminToken}` });
    const tat = tatRes.body as AnalyticsTATResponse;
    assert.strictEqual(tat.completedWagonsCount, 15);
    assert.ok(tat.averageHours >= 0);

    // 7. Full Compliance CSV Export
    const exportRes = await app.get('/api/analytics/export?format=csv', { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(exportRes.status, 200);
    const csv = exportRes.body as string;
    assert.ok(csv.split('\n').length >= 16); // Header + 15 wagons
  });

  // Scenario 2: Mobile Offline Shift Simulation with Bulk Reconnection Ingestion
  it('TC-P2-SIM-02: Offline Mobile Shift Simulation with Bulk Reconnection Ingestion', async () => {
    const offlinePayload: WagonBatchSyncPayload = {
      wagons: [
        {
          id: 'shift-w-1',
          wagonNumber: 'SECR/BOXNHL/OFFLINE-101',
          wagonType: 'BOXNHL',
          owningRailway: 'SECR',
          currentStage: 'COMPONENT_INSPECTION',
          entryDate: new Date().toISOString(),
          isReleased: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'shift-w-2',
          wagonNumber: 'NR/BCNHL/OFFLINE-201',
          wagonType: 'BCNHL',
          owningRailway: 'NR',
          currentStage: 'REPAIR_REPLACEMENT',
          entryDate: new Date().toISOString(),
          isReleased: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      transitions: [
        {
          id: 'shift-t-1',
          wagonNumber: 'SECR/BOXNHL/OFFLINE-101',
          fromStage: 'ENTRY_REGISTRATION',
          toStage: 'DISMANTLING',
          timestamp: new Date().toISOString(),
          userId: 'inspector1',
          userRole: 'INSPECTOR',
          isOverride: false
        },
        {
          id: 'shift-t-2',
          wagonNumber: 'SECR/BOXNHL/OFFLINE-101',
          fromStage: 'DISMANTLING',
          toStage: 'COMPONENT_INSPECTION',
          timestamp: new Date().toISOString(),
          userId: 'inspector1',
          userRole: 'INSPECTOR',
          isOverride: false
        }
      ],
      checklistItems: [
        {
          id: 'shift-chk-1',
          wagonNumber: 'SECR/BOXNHL/OFFLINE-101',
          category: 'BRAKE_SYSTEM',
          partName: 'Brake Beam',
          status: 'PASS',
          criticality: 'MANDATORY',
          inspectedBy: 'inspector1'
        },
        {
          id: 'shift-chk-2',
          wagonNumber: 'SECR/BOXNHL/OFFLINE-101',
          category: 'BEARINGS',
          partName: 'Cartridge Tapered Roller Bearing (CTRB)',
          status: 'PASS',
          criticality: 'MANDATORY',
          inspectedBy: 'inspector1'
        }
      ],
      photos: [
        {
          id: 'shift-p-1',
          wagonNumber: 'SECR/BOXNHL/OFFLINE-101',
          partCategory: 'BEARINGS',
          partName: 'CTRB',
          imageBase64: 'data:image/jpeg;base64,CTRB_OFFLINE_IMG',
          inspectorId: 'user-insp-001',
          inspectorName: 'inspector1',
          tags: ['OFFLINE_INSPECTION']
        }
      ]
    };

    // Bulk sync upon network reconnection
    const syncRes = await app.post('/api/sync/wagon-batch', offlinePayload, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(syncRes.status, 200);
    const syncBody = syncRes.body as WagonBatchSyncResponse;

    assert.strictEqual(syncBody.success, true);
    assert.strictEqual(syncBody.syncedWagons, 2);
    assert.strictEqual(syncBody.syncedTransitions, 2);
    assert.strictEqual(syncBody.syncedChecklistItems, 2);
    assert.strictEqual(syncBody.syncedPhotos, 1);

    // Verify synchronized wagon details
    const wagon1Res = await app.get('/api/wagons/SECR%2FBOXNHL%2FOFFLINE-101', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(wagon1Res.status, 200);
    const w1 = wagon1Res.body as { wagon: WagonRecord; timeline: any[]; photosCount: number };
    assert.strictEqual(w1.wagon.currentStage, 'COMPONENT_INSPECTION');
    assert.strictEqual(w1.timeline.length, 2);
    assert.strictEqual(w1.photosCount, 1);
  });

});
