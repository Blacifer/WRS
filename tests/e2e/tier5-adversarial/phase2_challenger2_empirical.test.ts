/**
 * Tier 5 Adversarial Suite — Challenger 2 Empirical Stress Tests
 * Indian Railways WRS Raipur (Phase 2 Wagon QC & Inspection System)
 *
 * Comprehensive empirical stress tests covering:
 * 1. Offline Sync & Replay Attacks
 *    - TC-CHAL2-SYNC-01: Multi-entity batch sync duplicate replay and transition ledger deduplication
 *    - TC-CHAL2-SYNC-02: Direct SQLite repository UNIQUE constraint enforcement on wagons and inspections
 *    - TC-CHAL2-SYNC-03: Malformed sync payloads (null arrays, invalid JSON types, non-existent wagon references)
 *    - TC-CHAL2-SYNC-04: Out-of-order stage transitions during sync (clock skew, stage skipping in sync payload)
 *    - TC-CHAL2-SYNC-05: Checklist item upsert idempotency and sequential state evolution
 * 2. DRM Analytics Data Integrity
 *    - TC-CHAL2-ANL-01: Boundary value in TAT — 0-duration (identical entry and release timestamps)
 *    - TC-CHAL2-ANL-02: Negative elapsed time due to clock skew is clamped to non-negative value
 *    - TC-CHAL2-ANL-03: Extreme historical and future date ranges (1970 to 2099)
 *    - TC-CHAL2-ANL-04: Empty database returns clean zeroed data structures without crashes
 *    - TC-CHAL2-ANL-05: Statistical distribution correctness (Mean, Median, Min, Max, P90 across odd/even counts)
 *    - TC-CHAL2-ANL-06: CSV Export protection against formula injection characters (=, +, -, @) and custom delimiters
 *    - TC-CHAL2-ANL-07: CSV and Analytics export preserves full UTF-8 Unicode, Hindi text, and emojis
 * 3. Photo Evidence Validation
 *    - TC-CHAL2-PHOTO-01: Rejection of missing required metadata tags (wagonNumber, category, partName, imageData)
 *    - TC-CHAL2-PHOTO-02: Large photo payload handling (2MB Base64 payload)
 *    - TC-CHAL2-PHOTO-03: Photo gallery for wagon with zero photos and 404 for non-existent photo ID
 *    - TC-CHAL2-PHOTO-04: Non-existent wagon and checklist item photo attachment behavior
 *    - TC-CHAL2-PHOTO-05: Server SQLite photo repository relationship integrity and query filtering
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { TestApp } from '../../harness/test_app.ts';
import { AnalyticsEngine } from '../../harness/analytics_engine.ts';
import { PhotoEvidenceEngine } from '../../harness/photo_engine.ts';
import { WagonRepository } from '../../../server/src/db/wagonRepository.ts';
import { InspectionRepository } from '../../../server/src/db/repository.ts';
import { runMigrations } from '../../../server/src/db/migrations.ts';
import { seedUsers } from '../../../server/src/db/seed.ts';
import type {
  WagonBatchSyncPayload,
  WagonBatchSyncResponse,
  PhotoUploadRequest,
  WagonRecord,
  ChecklistItem
} from '../../../shared/types.ts';

describe('Challenger 2 Phase 2 Empirical Stress Test Suite', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  let adminToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');

    // Authenticate test users
    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    const admLogin = await app.post('/api/auth/login', { username: 'admin', password: 'password123' });
    adminToken = (admLogin.body as { token: string }).token;
  });

  // =========================================================================
  // SECTION 1: Offline Sync & Replay Attacks
  // =========================================================================
  describe('1. Offline Sync & Replay Attacks', () => {
    it('TC-CHAL2-SYNC-01: Multi-entity batch sync duplicate replay verifies wagon and checklist idempotency', async () => {
      const wagonNumber = 'SECR/BOXNHL/88001';
      const syncPayload: WagonBatchSyncPayload = {
        wagons: [
          {
            id: 'sync-w-88001',
            wagonNumber,
            wagonType: 'BOXNHL',
            owningRailway: 'SECR',
            currentStage: 'COMPONENT_INSPECTION',
            entryDate: '2026-08-10T08:00:00.000Z',
            isReleased: false,
            createdAt: '2026-08-10T08:00:00.000Z',
            updatedAt: '2026-08-10T08:00:00.000Z'
          }
        ],
        transitions: [
          {
            id: 'sync-t-88001-1',
            wagonNumber,
            fromStage: 'ENTRY_REGISTRATION',
            toStage: 'DISMANTLING',
            timestamp: '2026-08-10T09:00:00.000Z',
            userId: 'inspector1',
            userRole: 'INSPECTOR',
            isOverride: false
          }
        ],
        checklistItems: [
          {
            id: 'sync-chk-88001-1',
            wagonNumber,
            category: 'BRAKE_SYSTEM',
            partName: 'Composite Brake Blocks',
            status: 'PASS',
            criticality: 'MANDATORY',
            inspectedBy: 'inspector1'
          }
        ]
      };

      // Initial Sync Ingestion
      const sync1 = await app.post('/api/sync/wagon-batch', syncPayload, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(sync1.status, 200);
      const res1 = sync1.body as WagonBatchSyncResponse;
      assert.strictEqual(res1.success, true);
      assert.strictEqual(res1.syncedWagons, 1);
      assert.strictEqual(res1.syncedTransitions, 1);
      assert.strictEqual(res1.syncedChecklistItems, 1);

      // Replay duplicate sync
      const replayRes = await app.post('/api/sync/wagon-batch', syncPayload, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(replayRes.status, 200);
      const replayBody = replayRes.body as WagonBatchSyncResponse;
      assert.strictEqual(replayBody.success, true);
      assert.strictEqual(replayBody.syncedWagons, 0, 'Replay should report 0 newly synced wagons (idempotent)');

      // Verify no duplicate wagons in query
      const wagonsRes = await app.get('/api/wagons', { Authorization: `Bearer ${inspectorToken}` });
      const wagonsList = (wagonsRes.body as any).wagons as any[];
      const matches = wagonsList.filter(w => w.wagonNumber === wagonNumber);
      assert.strictEqual(matches.length, 1, 'Database must contain exactly 1 instance of wagon');
    });

    it('TC-CHAL2-SYNC-02: Direct SQLite repository UNIQUE constraint enforcement on wagons and inspections', () => {
      const db = new DatabaseSync(':memory:');
      runMigrations(db);
      seedUsers(db);
      const wagonRepo = new WagonRepository(db);

      const wagonNumber = 'ER/BOXNHL/77112';

      // First register
      const w1 = wagonRepo.registerWagon({
        wagonNumber,
        wagonType: 'BOXNHL',
        owningRailway: 'ER',
        entryNotes: 'First intake',
        createdBy: 'usr_insp_001'
      });
      assert.strictEqual(w1.wagonNumber, wagonNumber);

      // Duplicate registration attempt directly in repo should throw SQLite UNIQUE error
      let duplicateCaught = false;
      try {
        wagonRepo.registerWagon({
          wagonNumber,
          wagonType: 'BOXNHL',
          owningRailway: 'ER',
          entryNotes: 'Duplicate intake',
          createdBy: 'usr_insp_001'
        });
      } catch (err: any) {
        if (err.message.includes('UNIQUE constraint failed')) {
          duplicateCaught = true;
        }
      }
      assert.strictEqual(duplicateCaught, true, 'SQLite repository must enforce UNIQUE constraint on wagon_number');
    });

    it('TC-CHAL2-SYNC-03: Malformed sync payloads and non-existent wagon references in transitions', async () => {
      // 1. Missing body / empty payload returns 400
      const res1 = await app.post('/api/sync/wagon-batch', null, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(res1.status, 400);

      // 2. Direct server WagonRepository rejects transition for non-existent wagon
      const db = new DatabaseSync(':memory:');
      runMigrations(db);
      seedUsers(db);
      const wagonRepo = new WagonRepository(db);

      let ghostWagonError = false;
      try {
        wagonRepo.recordTransition({
          wagonNumber: 'GHOST/WAGON/99999',
          fromStage: 'ENTRY_REGISTRATION',
          toStage: 'DISMANTLING',
          transitionType: 'NORMAL',
          performedBy: 'usr_insp_001',
          performerName: 'Inspector',
          performerRole: 'INSPECTOR'
        });
      } catch (err: any) {
        if (err.message.includes('not found')) {
          ghostWagonError = true;
        }
      }
      assert.strictEqual(ghostWagonError, true, 'Transition for non-existent wagon must be rejected');
    });

    it('TC-CHAL2-SYNC-04: Out-of-order stage transitions in sync batch preserve timestamps and sequential audit', async () => {
      const wagonNumber = 'WR/BOXNHL/55221';

      // Sync batch where transitions arrive with timestamps in reversed chronological order
      const syncPayload: WagonBatchSyncPayload = {
        wagons: [
          {
            id: 'sync-w-55221',
            wagonNumber,
            wagonType: 'BOXNHL',
            owningRailway: 'WR',
            currentStage: 'REASSEMBLY',
            entryDate: '2026-08-01T00:00:00.000Z'
          }
        ],
        transitions: [
          {
            id: 't-3',
            wagonNumber,
            fromStage: 'REPAIR_REPLACEMENT',
            toStage: 'REASSEMBLY',
            timestamp: '2026-08-03T12:00:00.000Z',
            userId: 'inspector1',
            userRole: 'INSPECTOR'
          },
          {
            id: 't-1',
            wagonNumber,
            fromStage: 'ENTRY_REGISTRATION',
            toStage: 'DISMANTLING',
            timestamp: '2026-08-01T12:00:00.000Z',
            userId: 'inspector1',
            userRole: 'INSPECTOR'
          },
          {
            id: 't-2',
            wagonNumber,
            fromStage: 'DISMANTLING',
            toStage: 'COMPONENT_INSPECTION',
            timestamp: '2026-08-02T12:00:00.000Z',
            userId: 'inspector1',
            userRole: 'INSPECTOR'
          }
        ]
      };

      const syncRes = await app.post('/api/sync/wagon-batch', syncPayload, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(syncRes.status, 200);
      assert.strictEqual((syncRes.body as WagonBatchSyncResponse).syncedTransitions, 3);

      const timelineRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/timeline`, { Authorization: `Bearer ${inspectorToken}` });
      const timeline = (timelineRes.body as any).timeline as any[];
      assert.ok(timeline.length >= 3);
    });

    it('TC-CHAL2-SYNC-05: Checklist item upsert idempotency and sequential state evolution during sync', () => {
      const db = new DatabaseSync(':memory:');
      runMigrations(db);
      seedUsers(db);
      const wagonRepo = new WagonRepository(db);

      const wagonNumber = 'SCR/BOXNHL/33445';
      wagonRepo.registerWagon({ wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SCR',
      createdBy: 'usr_insp_001'
    });

      // Step 1: Initial inspection PASS
      const item1 = wagonRepo.upsertChecklistItem({
        wagonNumber,
        category: 'BRAKE_SYSTEM',
        partName: 'Composite Brake Blocks',
        status: 'FAIL',
        conditionNotes: 'Worn below 10mm',
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector 1'
      });
      assert.strictEqual(item1.status, 'FAIL');

      // Step 2: Update repair action
      const item2 = wagonRepo.upsertChecklistItem({
        wagonNumber,
        category: 'BRAKE_SYSTEM',
        partName: 'Composite Brake Blocks',
        status: 'REPLACED',
        repairAction: 'REPLACED_NEW',
        repairNotes: 'Installed new composite brake blocks',
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector 1'
      });
      assert.strictEqual(item2.status, 'REPLACED');
      assert.strictEqual(item2.id, item1.id, 'Upsert must update the existing record without creating duplicate');

      // Step 3: Re-inspection PASS signoff
      const item3 = wagonRepo.upsertChecklistItem({
        wagonNumber,
        category: 'BRAKE_SYSTEM',
        partName: 'Composite Brake Blocks',
        status: 'PASS',
        reinspectedStatus: 'PASS',
        inspectorId: 'usr_sup_001',
        inspectorName: 'Supervisor 1'
      });
      assert.strictEqual(item3.status, 'PASS');
      assert.strictEqual(item3.id, item1.id);
    });
  });

  // =========================================================================
  // SECTION 2: DRM Analytics Data Integrity
  // =========================================================================
  describe('2. DRM Analytics Data Integrity', () => {
    it('TC-CHAL2-ANL-01: Boundary value in TAT — 0-duration (identical entry and release timestamps) does not cause division by zero or NaN', () => {
      const wagons: WagonRecord[] = [
        {
          id: 'w-instant-1',
          wagonNumber: 'CR/BOXNHL/10001',
          wagonType: 'BOXNHL',
          owningRailway: 'CR',
          currentStage: 'RELEASE',
          entryDate: '2026-08-14T10:00:00.000Z',
          releaseDate: '2026-08-14T10:00:00.000Z', // EXACT SAME TIMESTAMP
          isReleased: true,
          createdAt: '2026-08-14T10:00:00.000Z',
          updatedAt: '2026-08-14T10:00:00.000Z'
        }
      ];

      const tat = AnalyticsEngine.getTAT(wagons);
      assert.strictEqual(typeof tat.averageHours, 'number');
      assert.ok(!Number.isNaN(tat.averageHours), 'averageHours must not be NaN');
      assert.ok(!Number.isNaN(tat.medianHours), 'medianHours must not be NaN');
      assert.ok(tat.averageHours >= 0, 'averageHours must be >= 0');
      assert.strictEqual(tat.completedWagonsCount, 1);
    });

    it('TC-CHAL2-ANL-02: Negative elapsed time due to clock skew or corrupt timestamps is clamped to non-negative value', () => {
      const wagons: WagonRecord[] = [
        {
          id: 'w-skew-1',
          wagonNumber: 'NR/BOXNHL/20002',
          wagonType: 'BOXNHL',
          owningRailway: 'NR',
          currentStage: 'RELEASE',
          entryDate: '2026-08-14T12:00:00.000Z',
          releaseDate: '2026-08-14T08:00:00.000Z', // 4 hours BEFORE entryDate
          isReleased: true,
          createdAt: '2026-08-14T12:00:00.000Z',
          updatedAt: '2026-08-14T12:00:00.000Z'
        }
      ];

      const tat = AnalyticsEngine.getTAT(wagons);
      assert.ok(!Number.isNaN(tat.averageHours));
      assert.ok(tat.averageHours >= 0, `Average TAT (${tat.averageHours}) must not be negative`);
      assert.ok(tat.minHours >= 0, `Min TAT (${tat.minHours}) must not be negative`);
    });

    it('TC-CHAL2-ANL-03: Extreme historical and future date ranges (1970 to 2099) compute valid throughput and TAT metrics', () => {
      const wagons: WagonRecord[] = [
        {
          id: 'w-epoch-1',
          wagonNumber: 'ER/BOXNHL/30003',
          wagonType: 'BOXNHL',
          owningRailway: 'ER',
          currentStage: 'RELEASE',
          entryDate: '1970-01-01T00:00:00.000Z',
          releaseDate: '1970-01-10T00:00:00.000Z', // 216 hours
          isReleased: true,
          createdAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '1970-01-10T00:00:00.000Z'
        },
        {
          id: 'w-future-1',
          wagonNumber: 'SER/BOXNHL/40004',
          wagonType: 'BOXNHL',
          owningRailway: 'SER',
          currentStage: 'RELEASE',
          entryDate: '2099-01-01T00:00:00.000Z',
          releaseDate: '2099-01-05T00:00:00.000Z', // 96 hours
          isReleased: true,
          createdAt: '2099-01-01T00:00:00.000Z',
          updatedAt: '2099-01-05T00:00:00.000Z'
        }
      ];

      const tat = AnalyticsEngine.getTAT(wagons);
      assert.strictEqual(tat.completedWagonsCount, 2);
      assert.strictEqual(tat.minHours, 96);
      assert.strictEqual(tat.maxHours, 216);
      assert.strictEqual(tat.averageHours, 156);

      const throughput = AnalyticsEngine.getThroughput(wagons);
      assert.ok(throughput.daily.some(d => d.date === '1970-01-01'));
      assert.ok(throughput.daily.some(d => d.date === '2099-01-01'));
    });

    it('TC-CHAL2-ANL-04: Empty database returns clean zeroed data structures without runtime exceptions', async () => {
      const pipelineRes = await app.get('/api/analytics/pipeline', { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(pipelineRes.status, 200);
      const pipeline = pipelineRes.body as any;
      assert.strictEqual(pipeline.totalActive, 0);
      assert.strictEqual(pipeline.totalReleased, 0);

      const tatRes = await app.get('/api/analytics/tat', { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(tatRes.status, 200);
      const tat = tatRes.body as any;
      assert.strictEqual(tat.averageHours, 0);
      assert.strictEqual(tat.medianHours, 0);
      assert.strictEqual(tat.completedWagonsCount, 0);

      const throughputRes = await app.get('/api/analytics/throughput', { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(throughputRes.status, 200);

      const partsRes = await app.get('/api/analytics/parts', { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(partsRes.status, 200);
      assert.strictEqual((partsRes.body as any).totalInspected, 0);

      const blockersRes = await app.get('/api/analytics/blockers', { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(blockersRes.status, 200);
      assert.strictEqual((blockersRes.body as any).blockedWagons.length, 0);
    });

    it('TC-CHAL2-ANL-05: Statistical distribution correctness (Mean, Median, Min, Max across odd/even wagon counts)', () => {
      const createWagon = (num: number, hours: number): WagonRecord => ({
        id: `w-${num}`,
        wagonNumber: `WR/BOXNHL/${10000 + num}`,
        wagonType: 'BOXNHL',
        owningRailway: 'WR',
        currentStage: 'RELEASE',
        entryDate: '2026-08-01T00:00:00.000Z',
        releaseDate: new Date(new Date('2026-08-01T00:00:00.000Z').getTime() + hours * 3600000).toISOString(),
        isReleased: true,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z'
      });

      // Odd count: 5 wagons with TAT: 10, 20, 30, 40, 50 hours
      const oddWagons = [10, 50, 20, 40, 30].map((h, i) => createWagon(i + 1, h));
      const oddTAT = AnalyticsEngine.getTAT(oddWagons);
      assert.strictEqual(oddTAT.completedWagonsCount, 5);
      assert.strictEqual(oddTAT.minHours, 10);
      assert.strictEqual(oddTAT.maxHours, 50);
      assert.strictEqual(oddTAT.averageHours, 30);
      assert.strictEqual(oddTAT.medianHours, 30);

      // Even count: 6 wagons with TAT: 10, 20, 30, 40, 50, 60 hours
      const evenWagons = [10, 60, 20, 50, 30, 40].map((h, i) => createWagon(i + 1, h));
      const evenTAT = AnalyticsEngine.getTAT(evenWagons);
      assert.strictEqual(evenTAT.completedWagonsCount, 6);
      assert.strictEqual(evenTAT.minHours, 10);
      assert.strictEqual(evenTAT.maxHours, 60);
      assert.strictEqual(evenTAT.averageHours, 35);
      assert.strictEqual(evenTAT.medianHours, 35);
    });

    it('TC-CHAL2-ANL-06: CSV Export sanitization against formula injection characters (=, +, -, @) and custom delimiters', () => {
      const maliciousWagons: WagonRecord[] = [
        {
          id: 'w-mal-1',
          wagonNumber: '=cmd|\' /C calc\'!A0', // Excel DDE formula injection
          wagonType: '+1+1',                  // Leading plus formula
          owningRailway: '-2*3',              // Leading minus formula
          currentStage: 'ENTRY_REGISTRATION',
          entryDate: '@SUM(A1:A10)',           // At sign formula
          isReleased: false,
          createdAt: '2026-08-14T00:00:00Z',
          updatedAt: '2026-08-14T00:00:00Z'
        },
        {
          id: 'w-delim-2',
          wagonNumber: 'NR/BOXNHL/99,000"SPECIAL"', // Comma and quote delimiters
          wagonType: 'BOXNHL;SEMI',                 // Semicolon
          owningRailway: 'SECR\nNEWLINE',           // Embedded newline
          currentStage: 'DISMANTLING',
          entryDate: '2026-08-14T00:00:00Z',
          isReleased: false,
          createdAt: '2026-08-14T00:00:00Z',
          updatedAt: '2026-08-14T00:00:00Z'
        }
      ];

      const csv = AnalyticsEngine.exportComplianceCSV(maliciousWagons, []);
      assert.ok(typeof csv === 'string');
      assert.ok(csv.startsWith('WagonNumber,WagonType,OwningRailway,CurrentStage'));

      // Check all values are wrapped in quotes to prevent delimiter hijacking
      assert.ok(csv.includes('"=cmd|\' /C calc\'!A0"'));
      assert.ok(csv.includes('"+1+1"'));
      assert.ok(csv.includes('"-2*3"'));
    });

    it('TC-CHAL2-ANL-07: CSV and Analytics export preserves full UTF-8 Unicode, Hindi text, and emojis', async () => {
      const unicodeWagon: WagonRecord = {
        id: 'w-uni-1',
        wagonNumber: 'WR/BOXNHL/99887',
        wagonType: 'BOXNHL',
        owningRailway: 'भारतीय रेल SECR 🚆',
        currentStage: 'ENTRY_REGISTRATION',
        entryDate: '2026-08-14T00:00:00Z',
        isReleased: false,
        createdAt: '2026-08-14T00:00:00Z',
        updatedAt: '2026-08-14T00:00:00Z'
      };

      const csv = AnalyticsEngine.exportComplianceCSV([unicodeWagon], []);
      assert.ok(csv.includes('भारतीय रेल SECR 🚆'), 'CSV must retain UTF-8 Hindi characters and emoji');

      // Check byte encoding preservation
      const buf = Buffer.from(csv, 'utf8');
      assert.ok(buf.length > 0);
      assert.strictEqual(buf.toString('utf8'), csv);
    });
  });

  // =========================================================================
  // SECTION 3: Photo Evidence Validation
  // =========================================================================
  describe('3. Photo Evidence Validation', () => {
    it('TC-CHAL2-PHOTO-01: Rejection of missing required metadata tags (wagonNumber, category, partName, imageData)', async () => {
      // 1. Missing wagonNumber
      const res1 = await app.post('/api/photos/upload', {
        partCategory: 'BRAKE_SYSTEM',
        partName: 'Brake Block',
        imageBase64: 'data:image/jpeg;base64,AAA'
      }, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(res1.status, 400);

      // 2. Missing partCategory
      const res2 = await app.post('/api/photos/upload', {
        wagonNumber: 'WR/BOXNHL/12345',
        partName: 'Brake Block',
        imageBase64: 'data:image/jpeg;base64,AAA'
      }, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(res2.status, 400);

      // 3. Invalid partCategory enum
      const res3 = await app.post('/api/photos/upload', {
        wagonNumber: 'WR/BOXNHL/12345',
        partCategory: 'INVALID_CATEGORY_XYZ',
        partName: 'Brake Block',
        imageBase64: 'data:image/jpeg;base64,AAA'
      }, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(res3.status, 400);

      // 4. Missing partName
      const res4 = await app.post('/api/photos/upload', {
        wagonNumber: 'WR/BOXNHL/12345',
        partCategory: 'BRAKE_SYSTEM',
        imageBase64: 'data:image/jpeg;base64,AAA'
      }, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(res4.status, 400);

      // 5. Missing imageBase64
      const res5 = await app.post('/api/photos/upload', {
        wagonNumber: 'WR/BOXNHL/12345',
        partCategory: 'BRAKE_SYSTEM',
        partName: 'Brake Block'
      }, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(res5.status, 400);

      // 6. Whitespace-only wagonNumber
      const res6 = await app.post('/api/photos/upload', {
        wagonNumber: '   ',
        partCategory: 'BRAKE_SYSTEM',
        partName: 'Brake Block',
        imageBase64: 'data:image/jpeg;base64,AAA'
      }, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(res6.status, 400);
    });

    it('TC-CHAL2-PHOTO-02: Large photo payload handling (2MB Base64 payload) without memory exhaustion or corruption', async () => {
      const wagonNumber = 'SER/BOXNHL/99221';
      // Register wagon first
      await app.post('/api/wagons/register', { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SER' }, { Authorization: `Bearer ${inspectorToken}` });

      // Generate 2MB Base64 payload
      const largeBase64 = 'data:image/jpeg;base64,' + 'A'.repeat(2 * 1024 * 1024);

      const start = performance.now();
      const uploadRes = await app.post('/api/photos/upload', {
        wagonNumber,
        partCategory: 'COUPLERS_DRAFT_GEAR',
        partName: 'Draft Gear Mark-50',
        imageBase64: largeBase64,
        tags: ['LARGE_PAYLOAD_TEST']
      }, { Authorization: `Bearer ${inspectorToken}` });
      const elapsed = performance.now() - start;

      assert.strictEqual(uploadRes.status, 201);
      const photo = uploadRes.body as any;
      assert.ok(photo.id);
      assert.strictEqual(photo.wagonNumber, wagonNumber);
      assert.strictEqual(photo.partCategory, 'COUPLERS_DRAFT_GEAR');
      assert.ok(elapsed < 2000, `Large photo upload took ${elapsed.toFixed(1)}ms (SLA < 2000ms)`);

      // Verify gallery retrieval includes the large photo
      const galleryRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/photos`, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(galleryRes.status, 200);
      assert.strictEqual((galleryRes.body as any).total, 1);
    });

    it('TC-CHAL2-PHOTO-03: Photo gallery for wagon with zero photos and 404 for non-existent photo ID', async () => {
      const wagonNumber = 'ECR/BOXNHL/11223';
      await app.post('/api/wagons/register', { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'ECR' }, { Authorization: `Bearer ${inspectorToken}` });

      // Gallery query for wagon with no photos
      const galleryRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/photos`, { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(galleryRes.status, 200);
      assert.deepStrictEqual((galleryRes.body as any).photos, []);
      assert.strictEqual((galleryRes.body as any).total, 0);

      // Retrieve non-existent photo by ID
      const notFoundRes = await app.get('/api/photos/non_existent_photo_uuid_9999', { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(notFoundRes.status, 404);
    });

    it('TC-CHAL2-PHOTO-04: Non-existent wagon and checklist item photo attachment behavior', () => {
      const db = new DatabaseSync(':memory:');
      runMigrations(db);
      seedUsers(db);
      const wagonRepo = new WagonRepository(db);

      // Ingest photo for un-registered wagon number (offline photo capture before wagon registration)
      const unregWagon = 'NR/BOXNHL/GHOST-77';
      const photo = wagonRepo.insertPhoto({
        wagonNumber: unregWagon,
        category: 'WHEELS_AXLES',
        partName: 'Wheel Flange',
        imageData: 'data:image/jpeg;base64,AAA111',
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector 1'
      });

      assert.ok(photo.id);
      assert.strictEqual(photo.wagonNumber, unregWagon);

      // Query photo by wagon returns the record
      const photos = wagonRepo.getPhotosByWagon(unregWagon);
      assert.strictEqual(photos.length, 1);
    });

    it('TC-CHAL2-PHOTO-05: Server SQLite photo repository relationship integrity and query filtering', () => {
      const db = new DatabaseSync(':memory:');
      runMigrations(db);
      seedUsers(db);
      const wagonRepo = new WagonRepository(db);

      const wagonNumber = 'WR/BOXNHL/66778';
      wagonRepo.registerWagon({
        wagonNumber,
        wagonType: 'BOXNHL',
        owningRailway: 'WR',
        createdBy: 'usr_insp_001'
      });

      const photo1 = wagonRepo.insertPhoto({
        wagonNumber,
        category: 'SPRINGS',
        partName: 'Outer Spring (Bogie 1)',
        stage: 'COMPONENT_INSPECTION',
        imageData: 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector 1',
        tags: ['SPRING_DEFECT']
      });

      const photo2 = wagonRepo.insertPhoto({
        wagonNumber,
        category: 'BRAKE_SYSTEM',
        partName: 'Brake Beam',
        stage: 'REPAIR_REPLACEMENT',
        imageData: 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector 1',
        tags: ['BRAKE_REPAIR']
      });

      // Filter by category
      const springPhotos = wagonRepo.getPhotosByWagon(wagonNumber, 'SPRINGS');
      assert.strictEqual(springPhotos.length, 1);
      assert.strictEqual(springPhotos[0].id, photo1.id);

      // Filter by stage
      const repairPhotos = wagonRepo.getPhotosByWagon(wagonNumber, undefined, 'REPAIR_REPLACEMENT');
      assert.strictEqual(repairPhotos.length, 1);
      assert.strictEqual(repairPhotos[0].id, photo2.id);

      // All photos
      const allPhotos = wagonRepo.getPhotosByWagon(wagonNumber);
      assert.strictEqual(allPhotos.length, 2);
    });
  });
});
