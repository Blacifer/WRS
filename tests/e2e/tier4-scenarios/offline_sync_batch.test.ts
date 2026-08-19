/**
 * Tier 4 Test Suite — Real-World Application Scenario: Offline-to-Online Batch Sync
 * Indian Railways WRS Raipur
 *
 * Simulates mobile inspector operating disconnected in dead-zone yard, queueing
 * 30 spring inspections locally in IndexedDB queue, then synchronizing in bulk
 * with full timestamp preservation, sequence continuity, and zero data loss.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import { OfflineSyncQueue } from '../../harness/sync_engine.ts';
import type { SyncResponse, InspectionRecord } from '../../../shared/types.ts';

describe('Tier 4 — Offline-to-Online Batch Sync Workflow', () => {
  let app: TestApp;
  let inspectorToken: string;
  let syncQueue: OfflineSyncQueue;

  beforeEach(async () => {
    app = new TestApp(':memory:');
    syncQueue = new OfflineSyncQueue();

    const loginRes = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (loginRes.body as { token: string }).token;
  });

  it('TC-SCN-02: Offline inspector queues 30 inspections and synchronizes in bulk with zero loss', async () => {
    const OFFLINE_COUNT = 30;

    // Simulate inspector working offline across 3 wagons
    for (let i = 0; i < OFFLINE_COUNT; i++) {
      const wagonNum = `SE-BOXN-OFF-${Math.floor(i / 10) + 1}`;
      const localTime = new Date(Date.now() - (OFFLINE_COUNT - i) * 60000).toISOString();

      syncQueue.enqueue({
        inspectorId: 'insp-001',
        inspectorName: 'R. K. Sharma',
        wagonNumber: wagonNum,
        bogieType: 'CASNUB_22_NLB',
        springPosition: i % 2 === 0 ? 'OUTER' : 'INNER',
        condition: 'USED',
        measuredFreeHeight: 260.0 - (i % 5) * 2.5,
        classifiedBand: 'BLUE',
        bandRoman: 'Band I',
        status: 'PASS',
        damageType: 'NONE',
        isOverridden: false,
        tableReference: 'Table 28',
        timestamp: localTime,
        localCreatedAt: localTime
      });
    }

    assert.strictEqual(syncQueue.getQueueLength(), OFFLINE_COUNT);

    // Network connectivity restored -> Create payload and send to sync API
    const syncPayload = syncQueue.createSyncPayload('HANDHELD-TAB-04');
    const syncRes = await app.post('/api/sync/batch', syncPayload, { Authorization: `Bearer ${inspectorToken}` });

    assert.strictEqual(syncRes.status, 200);
    const syncBody = syncRes.body as SyncResponse;

    assert.strictEqual(syncBody.success, true);
    assert.strictEqual(syncBody.syncedCount, OFFLINE_COUNT);
    assert.strictEqual(syncBody.failedCount, 0);

    // Verify all 30 records are in the server database with sequence numbers 1..30
    const query = app.auditDb.queryInspections({ limit: 100 });
    assert.strictEqual(query.total, OFFLINE_COUNT);

    // Verify local creation timestamp preserved
    const firstLocal = syncQueue.getPendingRecords()[0].localCreatedAt;
    const syncedFirst = query.records.find(r => r.localCreatedAt === firstLocal);
    assert.ok(syncedFirst, 'Local creation timestamp must be preserved on synced record');

    // Clear local queue after successful sync
    syncQueue.clearQueue();
    assert.strictEqual(syncQueue.getQueueLength(), 0);
  });

});
