/**
 * Tier 3 Test Suite — Cross-Feature Integration Flows (Phase 2)
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Verifies complex multi-feature integration workflows:
 * 1. Full 7-Stage Overhaul Flow with Spring Auto-Population & Release Certification
 * 2. Defect Remediation with Condemned Spring, Photo Evidence, & Gate Clearance
 * 3. Dynamic Criticality Configuration Alteration & Gate Block Enforcement
 * 4. Bilingual Hindi/English End-to-End Audit & Analytics Lifecycle
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
  PhotoRecord,
  ChecklistConfigEntry
} from '../../../shared/types.ts';
import { getLocalizedStage, getLocalizedCategory } from '../../harness/i18n_data.ts';

describe('Tier 3 — Cross-Feature Integration Flows (Phase 2)', () => {
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

  // Flow 1: Full 7-Stage Overhaul Flow with Spring Auto-Population
  it('TC-P2-XF-01: End-to-End Overhaul Flow from Stage 1 Registration to Stage 7 Release & Certificate', async () => {
    const wagonNumber = 'NR/BOXNHL/POH-2026-01';

    // 1. Stage 1: Registration
    const regRes = await app.post(
      '/api/wagons/register',
      {
        wagonNumber,
        wagonType: 'BOXNHL',
        owningRailway: 'NR',
        entryNotes: 'Scheduled Periodic Overhaul (POH)'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(regRes.status, 201);

    // 2. Phase 1 Spring Inspection
    await app.post(
      '/api/inspections',
      {
        wagonNumber,
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 261.5 // Band I (Blue)
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 3. Stage 2: Dismantling
    await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      { targetStage: 'DISMANTLING', notes: 'Bogie stripped and wheelsets removed' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 4. Stage 3: Component Inspection
    await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      { targetStage: 'COMPONENT_INSPECTION', notes: 'All CASNUB parts inspected per RDSO standards' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // Inspect checklist items: pass all non-spring items (springs auto-sync from Phase 1)
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;
    for (const item of items) {
      if (item.category !== 'SPRINGS') {
        await app.put(
          `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${item.id}`,
          { status: 'PASS', repairNotes: 'POH inspection passed' },
          { Authorization: `Bearer ${inspectorToken}` }
        );
      }
    }

    // 5. Stage 4: Repair / Replacement
    await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      { targetStage: 'REPAIR_REPLACEMENT', notes: 'Brake rigging rebushed and CTRB lubricated' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 6. Stage 5: Reassembly
    await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      { targetStage: 'REASSEMBLY', notes: 'Bogie reassembled under wagon body' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 7. Stage 6: Final QC Gate
    await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
      { targetStage: 'FINAL_QC_GATE', notes: 'Zero-defect pre-release audit' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // Verify Exit Gate status
    const gateStatusRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/gate/status`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(gateStatusRes.status, 200);
    const gateStatus = gateStatusRes.body as GateStatusResponse;
    assert.strictEqual(gateStatus.summary.failedMandatory, 0);
    assert.strictEqual(gateStatus.summary.totalCondemned, 0);

    // 8. Supervisor Digital Sign-off
    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/gate/signoff`,
      {
        supervisorId: 'supervisor1',
        digitalSignature: 'SIG-SHA256-FLOW1-VERIFIED',
        notes: 'Final inspection complete. Cleared for main line freight operations.'
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(signoffRes.status, 200);
    const signoffBody = signoffRes.body as { certificate: ReleaseCertificate; wagon: WagonRecord };
    assert.strictEqual(signoffBody.wagon.currentStage, 'RELEASE');
    assert.strictEqual(signoffBody.wagon.isReleased, true);

    // 9. Verify DRM Pipeline shows 1 released wagon
    const pipelineRes = await app.get('/api/analytics/pipeline', { Authorization: `Bearer ${adminToken}` });
    const pipeline = pipelineRes.body as AnalyticsPipelineResponse;
    assert.strictEqual(pipeline.counts.RELEASE, 1);
  });

  // Flow 2: Defect Remediation with Condemned Spring & Photo Evidence
  it('TC-P2-XF-02: Defect Remediation Flow with Condemned Spring, Photo Evidence, and Gate Clearance', async () => {
    const wagonNumber = 'SECR/BCNHL/DEFECT-02';
    await app.post('/api/wagons/register', { wagonNumber, wagonType: 'BCNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Advance to Stage 3
    await app.post(`/api/wagons/${encodeURIComponent(wagonNumber)}/transition`, { targetStage: 'DISMANTLING' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post(`/api/wagons/${encodeURIComponent(wagonNumber)}/transition`, { targetStage: 'COMPONENT_INSPECTION' }, { Authorization: `Bearer ${inspectorToken}` });

    // 1. Log a condemned spring in Phase 1 (crack observed)
    await app.post(
      '/api/inspections',
      {
        wagonNumber,
        bogieType: 'CASNUB_22_HS',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 260.0,
        damageType: 'CRACK',
        damageNotes: 'Coil longitudinal crack at lower turn'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 2. Attach defect photo evidence
    const photoUpload = await app.post(
      '/api/photos/upload',
      {
        wagonNumber,
        partCategory: 'SPRINGS',
        partName: 'Outer Springs Bogie-1',
        imageBase64: 'data:image/jpeg;base64,CRACK_PHOTO_BASE64',
        tags: ['CRACK_DEFECT', 'CONDEMNED']
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(photoUpload.status, 201);
    const photoId = (photoUpload.body as PhotoRecord).id;

    // 3. Advance to Stage 4 (REPAIR_REPLACEMENT)
    await app.post(`/api/wagons/${encodeURIComponent(wagonNumber)}/transition`, { targetStage: 'REPAIR_REPLACEMENT' }, { Authorization: `Bearer ${inspectorToken}` });

    // 4. In Stage 4, log new replacement spring in Phase 1 (passing)
    await app.post(
      '/api/inspections',
      {
        wagonNumber,
        bogieType: 'CASNUB_22_HS',
        springPosition: 'OUTER',
        condition: 'NEW',
        measuredFreeHeight: 262.0 // Table 32 Band I (Green)
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 5. Update checklist item to REPLACED linking photo
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;
    for (const item of items) {
      const isSpring = item.category === 'SPRINGS';
      await app.put(
        `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${item.id}`,
        {
          status: isSpring ? 'REPLACED' : 'PASS',
          repairAction: isSpring ? 'REPLACED_NEW' : undefined,
          repairNotes: isSpring ? 'Replaced cracked coil with new spring' : 'POH OK',
          photoId: isSpring ? photoId : undefined
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );
    }

    // 6. Advance through Reassembly to Final QC Gate
    await app.post(`/api/wagons/${encodeURIComponent(wagonNumber)}/transition`, { targetStage: 'REASSEMBLY' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post(`/api/wagons/${encodeURIComponent(wagonNumber)}/transition`, { targetStage: 'FINAL_QC_GATE' }, { Authorization: `Bearer ${inspectorToken}` });

    // 7. Verify gate cleared and sign off
    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/gate/signoff`,
      { supervisorId: 'supervisor1', digitalSignature: 'SIG-DEFECT-REMEDY' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(signoffRes.status, 200);
    assert.strictEqual((signoffRes.body as { success: boolean }).success, true);
  });

  // Flow 3: Dynamic Criticality Alteration & Exit Gate Enforcement
  it('TC-P2-XF-03: Dynamic Criticality Configuration Alteration & Gate Block Enforcement', async () => {
    // 1. Admin configures Center Sill to be MANDATORY for BOBRN hopper wagons
    const configPayload: ChecklistConfigEntry[] = [
      {
        wagonType: 'BOBRN',
        category: 'BODY_UNDERFRAME',
        partName: 'Underframe Center Sill & Cross Members',
        criticality: 'MANDATORY'
      }
    ];
    await app.post('/api/checklist/config', configPayload, { Authorization: `Bearer ${adminToken}` });

    // 2. Register BOBRN wagon
    const wagonNumber = 'CR/BOBRN/CONFIG-03';
    await app.post('/api/wagons/register', { wagonNumber, wagonType: 'BOBRN', owningRailway: 'CR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Advance to Stage 6
    const stages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of stages) {
      await app.post(`/api/wagons/${encodeURIComponent(wagonNumber)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // Pass all items EXCEPT Center Sill (leave as FAIL)
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;
    for (const item of items) {
      if (!item.partName.includes('Center Sill')) {
        await app.put(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${item.id}`, { status: 'PASS' }, { Authorization: `Bearer ${inspectorToken}` });
      }
    }

    // 3. Verify gate status blocks release due to failed mandatory Center Sill
    const gateRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/gate/status`, { Authorization: `Bearer ${inspectorToken}` });
    const gate = gateRes.body as GateStatusResponse;
    assert.strictEqual(gate.canRelease, false);
    assert.ok(gate.blockers.some(b => b.includes('Center Sill')));

    // 4. Repair Center Sill and verify gate clears
    const centerSillItem = items.find(i => i.partName.includes('Center Sill'))!;
    await app.put(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${centerSillItem.id}`,
      { status: 'REPAIRED', repairAction: 'REPAIRED', repairNotes: 'Center sill web reinforced per RDSO mod 2026' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    const gateCleared = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/gate/status`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual((gateCleared.body as GateStatusResponse).summary.failedMandatory, 0);
  });

  // Flow 4: Bilingual End-to-End Audit & Analytics Lifecycle
  it('TC-P2-XF-04: Bilingual Hindi/English End-to-End Audit & Analytics Flow', async () => {
    const wagonNumber = 'NR/BOXNHL/BILINGUAL-04';
    await app.post('/api/wagons/register', { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Fetch bilingual dictionary
    const hiRes = await app.get('/api/i18n/hi');
    assert.strictEqual(hiRes.status, 200);
    const hiDict = hiRes.body as any;

    assert.strictEqual(hiDict.stages.ENTRY_REGISTRATION, 'प्रवेश पंजीकरण');
    assert.strictEqual(hiDict.stages.FINAL_QC_GATE, 'अंतिम गुणवत्ता गेट');
    assert.strictEqual(hiDict.categories.BRAKE_SYSTEM, 'ब्रेक प्रणाली');

    // Checklist category group includes both en and hi labels
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const { categories } = chkRes.body as { categories: any[] };
    const brakeGroup = categories.find(c => c.category === 'BRAKE_SYSTEM');
    assert.strictEqual(brakeGroup.categoryLabelEn, 'Brake System');
    assert.strictEqual(brakeGroup.categoryLabelHi, 'ब्रेक प्रणाली');
  });

});
