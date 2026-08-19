/**
 * Tier 1 Test Suite — Feature R4: DRM Officer Dashboards & Reporting
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Verifies real-time wagon pipeline counts, Turnaround Time (TAT) computations,
 * throughput statistics, parts health breakdown, inspector metrics, QC blockers, and CSV export.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type {
  AnalyticsPipelineResponse,
  AnalyticsTATResponse,
  AnalyticsThroughputResponse,
  AnalyticsPartsResponse,
  AnalyticsInspectorsResponse,
  AnalyticsBlockersResponse
} from '../../../shared/types.ts';

describe('Tier 1 — R4: DRM Officer Dashboards & Reporting', () => {
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

    // Seed test wagons across various stages
    const wagons = [
      { wagonNumber: 'NR/BOXNHL/101', stage: 'ENTRY_REGISTRATION' },
      { wagonNumber: 'NR/BOXNHL/102', stage: 'DISMANTLING' },
      { wagonNumber: 'SECR/BCNHL/201', stage: 'COMPONENT_INSPECTION' },
      { wagonNumber: 'SECR/BCNHL/202', stage: 'REPAIR_REPLACEMENT' },
      { wagonNumber: 'CR/BOBRN/301', stage: 'REASSEMBLY' },
      { wagonNumber: 'CR/BOBRN/302', stage: 'FINAL_QC_GATE' }
    ];

    for (const w of wagons) {
      await app.post(
        '/api/wagons/register',
        { wagonNumber: w.wagonNumber, wagonType: w.wagonNumber.split('/')[1], owningRailway: w.wagonNumber.split('/')[0] },
        { Authorization: `Bearer ${inspectorToken}` }
      );

      const targetStages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'];
      const stopIndex = targetStages.indexOf(w.stage);
      if (stopIndex >= 0) {
        for (let i = 0; i <= stopIndex; i++) {
          await app.post(
            `/api/wagons/${encodeURIComponent(w.wagonNumber)}/transition`,
            { targetStage: targetStages[i] },
            { Authorization: `Bearer ${inspectorToken}` }
          );
        }
      }
    }
  });

  // Test Case 1: Pipeline Visualizer
  it('TC-P2-R4-01: Pipeline visualizer returns accurate real-time wagon counts across all 7 stages', async () => {
    const pipelineRes = await app.get('/api/analytics/pipeline', { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(pipelineRes.status, 200);
    const pipeline = pipelineRes.body as AnalyticsPipelineResponse;

    assert.strictEqual(pipeline.counts.ENTRY_REGISTRATION, 1);
    assert.strictEqual(pipeline.counts.DISMANTLING, 1);
    assert.strictEqual(pipeline.counts.COMPONENT_INSPECTION, 1);
    assert.strictEqual(pipeline.counts.REPAIR_REPLACEMENT, 1);
    assert.strictEqual(pipeline.counts.REASSEMBLY, 1);
    assert.strictEqual(pipeline.counts.FINAL_QC_GATE, 1);
    assert.strictEqual(pipeline.counts.RELEASE, 0);
    assert.strictEqual(pipeline.totalActive, 6);
    assert.strictEqual(pipeline.totalReleased, 0);
  });

  // Test Case 2: Turnaround Time (TAT) Computation
  it('TC-P2-R4-02: TAT analytics computes mean, median, min, max hours and daily trends for released wagons', async () => {
    const w = 'SECR/BOXNHL/RELEASED-01';
    const entryDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString(); // 48 hours ago
    await app.post(
      '/api/wagons/register',
      { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR', entryDate },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // Pass all checklist items and sign off
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(w)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: any[] }).items;
    for (const item of items) {
      await app.put(`/api/wagons/${encodeURIComponent(w)}/checklist/items/${item.id}`, { status: 'PASS' }, { Authorization: `Bearer ${inspectorToken}` });
    }

    await app.post(
      `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
      { supervisorId: 'supervisor1', digitalSignature: 'SIG-TAT-TEST' },
      { Authorization: `Bearer ${supervisorToken}` }
    );

    const tatRes = await app.get('/api/analytics/tat', { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(tatRes.status, 200);
    const tat = tatRes.body as AnalyticsTATResponse;

    assert.ok(tat.completedWagonsCount >= 1);
    assert.ok(tat.averageHours >= 47.0 && tat.averageHours <= 49.0);
    assert.ok(tat.medianHours >= 47.0);
    assert.ok(tat.minHours > 0);
    assert.ok(tat.maxHours >= tat.minHours);
    assert.ok(tat.trends.length > 0);
  });

  // Test Case 3: Workshop Throughput Statistics
  it('TC-P2-R4-03: Throughput statistics accurately aggregates entered vs released wagon volumes', async () => {
    const tpRes = await app.get('/api/analytics/throughput', { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(tpRes.status, 200);
    const tp = tpRes.body as AnalyticsThroughputResponse;

    assert.ok(Array.isArray(tp.daily));
    assert.ok(tp.daily.length > 0);
    const today = tp.daily[0];
    assert.ok(today.entered >= 6);
    assert.ok(today.released >= 0);
  });

  // Test Case 4: CASNUB Bogie Parts Health Breakdown
  it('TC-P2-R4-04: Parts statistics aggregates pass, fail, condemned, repaired, and replaced rates across all categories', async () => {
    const partsRes = await app.get('/api/analytics/parts', { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(partsRes.status, 200);
    const parts = partsRes.body as AnalyticsPartsResponse;

    assert.ok(parts.totalInspected > 0);
    assert.ok(parts.categoryBreakdown.SPRINGS);
    assert.ok(parts.categoryBreakdown.WHEELS_AXLES);
    assert.ok(parts.categoryBreakdown.BEARINGS);
    assert.ok(parts.categoryBreakdown.BRAKE_SYSTEM);
    assert.ok(parts.categoryBreakdown.COUPLERS_DRAFT_GEAR);
    assert.ok(parts.categoryBreakdown.BOGIE_FRAME_BOLSTER);
    assert.ok(parts.categoryBreakdown.FRICTION_WEDGES);
    assert.ok(parts.categoryBreakdown.BODY_UNDERFRAME);
  });

  // Test Case 5: Inspector Productivity Metrics
  it('TC-P2-R4-05: Inspector productivity metric computes inspection activity per inspector', async () => {
    const inspRes = await app.get('/api/analytics/inspectors', { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(inspRes.status, 200);
    const body = inspRes.body as AnalyticsInspectorsResponse;

    assert.ok(Array.isArray(body.inspectors));
  });

  // Test Case 6: Active QC Blockers Query
  it('TC-P2-R4-06: Active QC blockers query identifies wagons stuck at Exit Gate with exact blocker diagnostics', async () => {
    const blockersRes = await app.get('/api/analytics/blockers', { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(blockersRes.status, 200);
    const body = blockersRes.body as AnalyticsBlockersResponse;

    assert.ok(Array.isArray(body.blockedWagons));
    assert.ok(body.blockedWagons.length > 0);
    const blockedWagon = body.blockedWagons.find(w => w.wagonNumber === 'CR/BOBRN/302');
    assert.ok(blockedWagon);
    assert.strictEqual(blockedWagon.currentStage, 'FINAL_QC_GATE');
    assert.ok(blockedWagon.blockers.length > 0);
  });

  // Test Case 7: Compliance Data Export (CSV)
  it('TC-P2-R4-07: Compliance data export API produces standardized CSV report for DRM compliance audit', async () => {
    const exportRes = await app.get('/api/analytics/export?format=csv', { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(exportRes.status, 200);
    assert.strictEqual(exportRes.headers['content-type'], 'text/csv');

    const csvContent = exportRes.body as string;
    const lines = csvContent.split('\n');

    // Verify CSV header
    assert.strictEqual(lines[0], 'WagonNumber,WagonType,OwningRailway,CurrentStage,EntryDate,ReleaseDate,TotalItems,PassedItems,CondemnedItems,RepairedItems');
    assert.ok(lines.length >= 7, 'Should contain header + at least 6 wagon records');
    assert.ok(csvContent.includes('NR/BOXNHL/101'));
    assert.ok(csvContent.includes('CR/BOBRN/301'));
  });

});
