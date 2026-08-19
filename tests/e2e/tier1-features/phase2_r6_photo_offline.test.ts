/**
 * Tier 1 Test Suite — Feature R6: Photo Evidence & Mobile Offline Sync
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Verifies photo evidence auto-tagging, wagon photo gallery, offline batch sync
 * with idempotent replay protection, and bilingual dictionary support for Phase 2 terms.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type {
  PhotoRecord,
  WagonBatchSyncPayload,
  WagonBatchSyncResponse
} from '../../../shared/types.ts';
import { getTranslation, getLocalizedStage, getLocalizedCategory } from '../../harness/i18n_data.ts';

describe('Tier 1 — R6: Photo Evidence & Mobile Offline Sync', () => {
  let app: TestApp;
  let inspectorToken: string;
  const wagonNumber = 'WR/BOXNHL/44001';

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    await app.post(
      '/api/wagons/register',
      { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'WR' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
  });

  // Test Case 1: Photo Evidence Auto-Tagging
  it('TC-P2-R6-01: Photo upload API auto-tags photos with wagon number, part category, part name, inspector ID, and date', async () => {
    const uploadRes = await app.post(
      '/api/photos/upload',
      {
        wagonNumber,
        partCategory: 'BEARINGS',
        partName: 'Cartridge Tapered Roller Bearing (CTRB)',
        imageBase64: 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        tags: ['DEFECT_EVIDENCE', 'CRACK']
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(uploadRes.status, 201);
    const photo = uploadRes.body as PhotoRecord;

    assert.ok(photo.id);
    assert.strictEqual(photo.wagonNumber, wagonNumber);
    assert.strictEqual(photo.partCategory, 'BEARINGS');
    assert.strictEqual(photo.partName, 'Cartridge Tapered Roller Bearing (CTRB)');
    assert.strictEqual(photo.inspectorId, 'user-insp-001');
    assert.ok(photo.tags.includes(wagonNumber));
    assert.ok(photo.tags.includes('BEARINGS'));
    assert.ok(photo.tags.includes('DEFECT_EVIDENCE'));
  });

  // Test Case 2: Photo Retrieval & Gallery
  it('TC-P2-R6-02: Retrieves photo by ID and complete photo gallery for a wagon', async () => {
    const up1 = await app.post(
      '/api/photos/upload',
      {
        wagonNumber,
        partCategory: 'BRAKE_SYSTEM',
        partName: 'Brake Beam',
        imageBase64: 'data:image/jpeg;base64,AAA1'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    const photo1 = up1.body as PhotoRecord;

    const up2 = await app.post(
      '/api/photos/upload',
      {
        wagonNumber,
        partCategory: 'COUPLERS_DRAFT_GEAR',
        partName: 'Knuckle Assembly',
        imageBase64: 'data:image/jpeg;base64,AAA2'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    const photo2 = up2.body as PhotoRecord;

    // 1. Fetch photo by ID
    const getPhoto = await app.get(`/api/photos/${photo1.id}`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(getPhoto.status, 200);
    assert.strictEqual((getPhoto.body as PhotoRecord).id, photo1.id);

    // 2. Fetch gallery by wagon
    const galleryRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/photos`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(galleryRes.status, 200);
    const gallery = galleryRes.body as { photos: PhotoRecord[]; total: number };
    assert.strictEqual(gallery.total, 2);
    assert.ok(gallery.photos.some(p => p.id === photo1.id));
    assert.ok(gallery.photos.some(p => p.id === photo2.id));
  });

  // Test Case 3: Mobile Offline Batch Sync
  it('TC-P2-R6-03: Ingests queued offline wagon batch containing registered wagons, transitions, and checklist updates', async () => {
    const offlinePayload: WagonBatchSyncPayload = {
      wagons: [
        {
          id: 'offline-w-1',
          wagonNumber: 'SR/BOXNHL/99101',
          wagonType: 'BOXNHL',
          owningRailway: 'SR',
          currentStage: 'COMPONENT_INSPECTION',
          entryDate: new Date().toISOString(),
          isReleased: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      transitions: [
        {
          id: 'offline-t-1',
          wagonNumber: 'SR/BOXNHL/99101',
          fromStage: 'ENTRY_REGISTRATION',
          toStage: 'DISMANTLING',
          timestamp: new Date().toISOString(),
          userId: 'inspector1',
          userRole: 'INSPECTOR',
          isOverride: false
        },
        {
          id: 'offline-t-2',
          wagonNumber: 'SR/BOXNHL/99101',
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
          id: 'offline-chk-1',
          wagonNumber: 'SR/BOXNHL/99101',
          category: 'BRAKE_SYSTEM',
          partName: 'Composite Brake Blocks',
          status: 'PASS',
          criticality: 'MANDATORY',
          inspectedBy: 'inspector1'
        }
      ]
    };

    const syncRes = await app.post('/api/sync/wagon-batch', offlinePayload, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(syncRes.status, 200);
    const syncBody = syncRes.body as WagonBatchSyncResponse;

    assert.strictEqual(syncBody.success, true);
    assert.strictEqual(syncBody.syncedWagons, 1);
    assert.strictEqual(syncBody.syncedTransitions, 2);
    assert.strictEqual(syncBody.syncedChecklistItems, 1);

    // Verify wagon is queryable on server
    const wagonCheck = await app.get('/api/wagons/SR%2FBOXNHL%2F99101', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(wagonCheck.status, 200);
  });

  // Test Case 4: Idempotent Offline Sync Handling
  it('TC-P2-R6-04: Replaying identical offline batch is handled idempotently without duplicate record creation', async () => {
    const payload: WagonBatchSyncPayload = {
      wagons: [
        {
          id: 'offline-dup-w-1',
          wagonNumber: 'SCR/BCNHL/77881',
          wagonType: 'BCNHL',
          owningRailway: 'SCR',
          currentStage: 'ENTRY_REGISTRATION',
          entryDate: new Date().toISOString(),
          isReleased: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    // First sync
    const sync1 = await app.post('/api/sync/wagon-batch', payload, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(sync1.status, 200);
    assert.strictEqual((sync1.body as WagonBatchSyncResponse).syncedWagons, 1);

    // Replay duplicate sync
    const sync2 = await app.post('/api/sync/wagon-batch', payload, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(sync2.status, 200);
    assert.strictEqual((sync2.body as WagonBatchSyncResponse).syncedWagons, 0); // Already exists, not duplicated
  });

  // Test Case 5: Bilingual Dictionaries for Phase 2 Terms
  it('TC-P2-R6-05: Bilingual dictionaries provide complete English and Hindi translations for Phase 2 stages and categories', () => {
    const enDict = getTranslation('en');
    const hiDict = getTranslation('hi');

    // Stages
    const stages = [
      'ENTRY_REGISTRATION',
      'DISMANTLING',
      'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT',
      'REASSEMBLY',
      'FINAL_QC_GATE',
      'RELEASE'
    ];

    for (const stage of stages) {
      const en = getLocalizedStage(stage, 'en');
      const hi = getLocalizedStage(stage, 'hi');
      assert.ok(en && en.length > 0, `English translation missing for stage ${stage}`);
      assert.ok(hi && hi.length > 0, `Hindi translation missing for stage ${stage}`);
      assert.notStrictEqual(en, hi, `English and Hindi should differ for stage ${stage}`);
    }

    // Categories
    const categories = [
      'SPRINGS',
      'WHEELS_AXLES',
      'BEARINGS',
      'BRAKE_SYSTEM',
      'COUPLERS_DRAFT_GEAR',
      'BOGIE_FRAME_BOLSTER',
      'FRICTION_WEDGES',
      'BODY_UNDERFRAME'
    ];

    for (const cat of categories) {
      const en = getLocalizedCategory(cat, 'en');
      const hi = getLocalizedCategory(cat, 'hi');
      assert.ok(en && en.length > 0, `English translation missing for category ${cat}`);
      assert.ok(hi && hi.length > 0, `Hindi translation missing for category ${cat}`);
      assert.notStrictEqual(en, hi, `English and Hindi should differ for category ${cat}`);
    }
  });

});
