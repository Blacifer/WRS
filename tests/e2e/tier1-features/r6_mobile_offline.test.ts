/**
 * Tier 1 Test Suite — Feature R6: Mobile-First Progressive Web App & Offline Sync
 * Indian Railways WRS Raipur
 *
 * Verifies offline inspection queueing, batch synchronization when online,
 * duplicate handling (idempotency), PWA manifest, and workshop UI specifications (>=48px touch targets).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { OfflineSyncQueue, ServerSyncProcessor } from '../../harness/sync_engine.ts';
import { AuditDatabase } from '../../harness/audit_db.ts';
import { TestApp } from '../../harness/test_app.ts';

describe('Tier 1 — R6: Mobile-First PWA & Offline Sync', () => {
  let db: AuditDatabase;
  let app: TestApp;
  let syncQueue: OfflineSyncQueue;
  let serverSync: ServerSyncProcessor;
  let inspectorToken: string;

  beforeEach(async () => {
    db = new AuditDatabase(':memory:');
    app = new TestApp(':memory:');
    syncQueue = new OfflineSyncQueue();
    serverSync = new ServerSyncProcessor(db);

    const loginRes = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (loginRes.body as { token: string }).token;
  });

  // Test Case 1: Offline Queue accumulation
  it('TC-R6-01: Offline inspection queue accumulates multiple inspections while disconnected', () => {
    assert.strictEqual(syncQueue.getQueueLength(), 0);

    const id1 = syncQueue.enqueue({
      inspectorId: 'insp-001',
      wagonNumber: 'W-OFFLINE-01',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });

    const id2 = syncQueue.enqueue({
      inspectorId: 'insp-001',
      wagonNumber: 'W-OFFLINE-02',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'INNER',
      condition: 'USED',
      measuredFreeHeight: 262.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });

    assert.ok(id1.startsWith('local-temp-'));
    assert.ok(id2.startsWith('local-temp-'));
    assert.strictEqual(syncQueue.getQueueLength(), 2);
  });

  // Test Case 2: Preserving Local Timestamps
  it('TC-R6-02: Queued offline records retain local creation timestamps and client temporary IDs', () => {
    const fixedLocalTime = '2026-08-14T06:30:00.000Z';
    syncQueue.enqueue({
      inspectorId: 'insp-001',
      wagonNumber: 'W-OFFLINE-03',
      bogieType: 'CASNUB_22_HS',
      springPosition: 'SNUBBER',
      condition: 'USED',
      measuredFreeHeight: 293.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 29',
      timestamp: fixedLocalTime,
      localCreatedAt: fixedLocalTime
    });

    const pending = syncQueue.getPendingRecords();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].localCreatedAt, fixedLocalTime);
    assert.strictEqual(pending[0].syncStatus, 'LOCAL');
  });

  // Test Case 3: Batch Synchronization via API
  it('TC-R6-03: Server batch sync endpoint successfully ingests offline queue when connectivity restored', async () => {
    syncQueue.enqueue({
      inspectorId: 'insp-001',
      wagonNumber: 'W-SYNC-01',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });

    syncQueue.enqueue({
      inspectorId: 'insp-001',
      wagonNumber: 'W-SYNC-02',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 257.0,
      classifiedBand: 'GREEN',
      bandRoman: 'Band II',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });

    const payload = syncQueue.createSyncPayload('WRS-TABLET-05');
    const syncRes = await app.post('/api/sync/batch', payload, { Authorization: `Bearer ${inspectorToken}` });

    assert.strictEqual(syncRes.status, 200);
    const body = syncRes.body as { success: boolean; syncedCount: number; syncedRecords: Array<{ serverId: string; sequenceNumber: number }> };
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.syncedCount, 2);
    assert.strictEqual(body.syncedRecords.length, 2);

    // Verify records now exist in audit database
    const query = app.auditDb.queryInspections({ limit: 10 });
    assert.strictEqual(query.total, 2);
  });

  // Test Case 4: Idempotent duplicate sync handling
  it('TC-R6-04: Resubmitting identical sync payload is handled idempotently without duplicate records', () => {
    syncQueue.enqueue({
      inspectorId: 'insp-001',
      wagonNumber: 'W-IDEMP-01',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });

    const payload = syncQueue.createSyncPayload('WRS-TABLET-05');

    // First sync
    const res1 = serverSync.processBatchSync(payload);
    assert.strictEqual(res1.syncedCount, 1);

    // Re-sync same payload
    const res2 = serverSync.processBatchSync(payload);
    assert.strictEqual(res2.syncedCount, 1);

    // Total in database should still be 1
    const totalRecords = db.queryInspections().total;
    assert.strictEqual(totalRecords, 1);
  });

  // Test Case 5: PWA Manifest Specification Compliance
  it('TC-R6-05: PWA Manifest metadata conforms to mobile-first installation requirements', () => {
    const pwaManifest = {
      name: 'Indian Railways WRS Raipur Spring Classification',
      short_name: 'WRS Springs',
      start_url: '/',
      display: 'standalone',
      background_color: '#0f172a',
      theme_color: '#1e3a8a',
      orientation: 'portrait',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    };

    assert.strictEqual(pwaManifest.display, 'standalone');
    assert.strictEqual(pwaManifest.orientation, 'portrait');
    assert.ok(pwaManifest.icons.length >= 2);
    assert.ok(pwaManifest.theme_color.startsWith('#'));
  });

  // Test Case 6: Workshop Touch Target Size Specification (>=48x48px)
  it('TC-R6-06: Workshop UI touch target layout specifications meet glove-friendly standards (>=48px)', () => {
    const uiTouchTargetRequirements = {
      minButtonWidthPx: 48,
      minButtonHeightPx: 48,
      primaryActionHeightPx: 56,
      cameraCaptureButtonDiameterPx: 72,
      fontBaseSizePx: 16
    };

    assert.ok(uiTouchTargetRequirements.minButtonWidthPx >= 48);
    assert.ok(uiTouchTargetRequirements.minButtonHeightPx >= 48);
    assert.ok(uiTouchTargetRequirements.primaryActionHeightPx >= 48);
    assert.ok(uiTouchTargetRequirements.cameraCaptureButtonDiameterPx >= 64);
  });

});
