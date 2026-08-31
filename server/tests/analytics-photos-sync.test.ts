/**
 * DRM Analytics, Photo Evidence & Batch Sync Tests (Phase 2 - R4, R5, R6)
 * Indian Railways WRS Raipur
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Phase 2 R4, R5, R6: DRM Analytics, Photo Evidence & Batch Sync', () => {
  let app: ExpressApp;
  let inspectorToken: string;
  let supervisorToken: string;
  /*
   * The analytics cases below used to read the divisional figures with an
   * inspector's token, which passed because every analytics endpoint was
   * mounted on optionalAuthMiddleware and checked nothing. That was the bug,
   * not the intent: one inspector could read every other inspector's
   * condemn counts. They now use the account each endpoint is actually for.
   */
  let drmToken: string;

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
    drmToken = generateToken({
      id: 'usr_drm_001',
      username: 'drm1',
      role: 'DRM',
      name: 'DRM (Divisional Railway Manager)',
      employeeId: 'SECR-DRM-0001'
    });
  });

  test('TC-ANL-01: GET /api/analytics/pipeline returns 7-stage distribution', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: '/api/analytics/pipeline',
      headers: { authorization: `Bearer ${supervisorToken}` }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.counts);
    assert.ok(typeof res.body.data.totalActive === 'number');
    assert.ok(typeof res.body.data.totalReleased === 'number');
    assert.ok('ENTRY_REGISTRATION' in res.body.data.counts);
    assert.ok('FINAL_QC_GATE' in res.body.data.counts);
    assert.ok('RELEASE' in res.body.data.counts);
  });

  test('TC-ANL-02: GET /api/analytics/tat returns turnaround statistics and trends', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: '/api/analytics/tat',
      headers: { authorization: `Bearer ${drmToken}` }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.data.averageHours === 'number');
    assert.ok(typeof res.body.data.medianHours === 'number');
    assert.ok(Array.isArray(res.body.data.trends));
  });

  test('TC-ANL-03: GET /api/analytics/throughput returns throughput data', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: '/api/analytics/throughput',
      headers: { authorization: `Bearer ${drmToken}` }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.daily));
  });

  test('TC-ANL-04: GET /api/analytics/parts returns 8 RDSO category defect breakdown', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: '/api/analytics/parts',
      headers: { authorization: `Bearer ${drmToken}` }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.data.totalInspected === 'number');
    assert.ok(res.body.data.categoryBreakdown);
    assert.ok('SPRINGS' in res.body.data.categoryBreakdown);
    assert.ok('BRAKE_SYSTEM' in res.body.data.categoryBreakdown);
  });

  test('TC-ANL-05: GET /api/analytics/inspectors returns shift productivity', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: '/api/analytics/inspectors',
      headers: { authorization: `Bearer ${drmToken}` }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.inspectors));
  });

  test('TC-ANL-06: GET /api/analytics/blockers returns active QC blockers', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: '/api/analytics/blockers',
      headers: { authorization: `Bearer ${drmToken}` }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.blockedWagons));
  });

  test('TC-ANL-07: GET /api/analytics/export?format=csv returns downloadable CSV', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: '/api/analytics/export?format=csv',
      headers: { authorization: `Bearer ${drmToken}` }
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Wagon Number,Type,Railway'));
  });

  test('TC-PHT-01: POST /api/photos/upload stores and auto-tags component photo evidence', async () => {
    const sampleBase64 = 'data:image/jpeg;base64,' + Buffer.from('TEST_IMAGE_DATA_SAMPLE').toString('base64');
    const uploadRes = await app.dispatch({
      method: 'POST',
      url: '/api/photos/upload',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'SECR/BOXNHL/20481',
        partCategory: 'BRAKE_SYSTEM',
        partName: 'Brake Cylinder Stroke Inspection',
        stage: 'COMPONENT_INSPECTION',
        imageBase64: sampleBase64,
        tags: ['BRAKE', 'CYLINDER', 'SECR']
      }
    });

    assert.equal(uploadRes.status, 201);
    assert.equal(uploadRes.body.success, true);
    assert.ok(uploadRes.body.data.id);
    assert.equal(uploadRes.body.data.wagonNumber, 'SECR/BOXNHL/20481');

    // Retrieve photo
    const getRes = await app.dispatch({
      method: 'GET',
      url: `/api/photos/${uploadRes.body.data.id}`,
      headers: { authorization: `Bearer ${inspectorToken}` }
    });

    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.id, uploadRes.body.data.id);
    assert.equal(getRes.body.data.partName, 'Brake Cylinder Stroke Inspection');
  });

  test('TC-SYNC-01: POST /api/sync/batch ingests multi-entity offline batch payload', async () => {
    const syncPayload = {
      deviceId: 'PWA-ANDROID-TABLET-001',
      syncTimestamp: new Date().toISOString(),
      wagons: [
        { wagonNumber: 'WR/BOXNHL/66001', wagonType: 'BOXNHL', owningRailway: 'WR', entryNotes: 'Offline intake' }
      ],
      checklistItems: [
        {
          wagonNumber: 'WR/BOXNHL/66001',
          category: 'WHEELS_AXLES',
          partName: 'Wheel Tread Diameter (Axle 1-4)',
          status: 'PASS',
          isMandatory: true
        }
      ],
      transitions: [
        {
          wagonNumber: 'WR/BOXNHL/66001',
          fromStage: 'ENTRY_REGISTRATION',
          toStage: 'DISMANTLING',
          transitionType: 'NORMAL'
        }
      ],
      photos: [
        {
          id: 'photo_offline_001',
          wagonNumber: 'WR/BOXNHL/66001',
          partCategory: 'WHEELS_AXLES',
          partName: 'Wheel Flange Photo',
          imageBase64: 'data:image/jpeg;base64,OFFLINE_IMAGE_TEST',
          tags: ['OFFLINE_SYNC']
        }
      ]
    };

    const syncRes = await app.dispatch({
      method: 'POST',
      url: '/api/sync/batch',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: syncPayload
    });

    assert.equal(syncRes.status, 200);
    assert.equal(syncRes.body.success, true);
    assert.equal(syncRes.body.syncedWagons, 1);
    assert.equal(syncRes.body.syncedChecklistItems, 1);
    assert.equal(syncRes.body.syncedTransitions, 1);
    assert.equal(syncRes.body.syncedPhotos, 1);
  });

  test('TC-SYNC-05: a stale offline PASS cannot overwrite a condemnation', async () => {
    /*
     * The scenario that made this rule necessary, reproduced.
     *
     * An inspector marked a brake beam CONDEMNED with the note "visible
     * crack". A second inspector had judged the same component PASS earlier
     * while offline; when their device reconnected, the queued PASS was
     * applied and the condemnation disappeared — note and all. The exit gate
     * counts mandatory items that passed, so the wagon became releasable with
     * a cracked beam and nothing in the record said otherwise.
     *
     * Last-write-wins is the wrong resolution when one of the writes is a
     * safety finding. A repair is recorded as a repair; it does not arrive as
     * a stale PASS from a tablet that could not see the crack.
     */
    const wagonNumber = 'WR/BOXNHL/66005';
    const partName = 'Brake Beam Conflict';

    await app.dispatch({
      method: 'POST', url: '/api/wagons/register',
      headers: { authorization: `Bearer ${supervisorToken}`, 'content-type': 'application/json' },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'WR' }
    });

    const condemn = await app.dispatch({
      method: 'POST', url: '/api/sync/batch',
      headers: { authorization: `Bearer ${inspectorToken}`, 'content-type': 'application/json' },
      body: { checklistItems: [{
        wagonNumber, category: 'BRAKE_SYSTEM', partName,
        status: 'CONDEMNED', isMandatory: true, conditionNotes: 'visible crack'
      }] }
    });
    assert.equal(condemn.status, 200);

    const stalePass = await app.dispatch({
      method: 'POST', url: '/api/sync/batch',
      headers: { authorization: `Bearer ${inspectorToken}`, 'content-type': 'application/json' },
      body: { checklistItems: [{
        wagonNumber, category: 'BRAKE_SYSTEM', partName,
        status: 'PASS', isMandatory: true, conditionNotes: 'looked fine to me'
      }] }
    });

    assert.equal(stalePass.status, 200, 'the batch itself still succeeds');
    assert.equal(stalePass.body.syncedChecklistItems, 0, 'the downgrade must not be applied');
    assert.equal(stalePass.body.conflictCount, 1, 'and it must be reported, not silently dropped');

    const after = await app.dispatch({
      method: 'GET', url: `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`,
      headers: { authorization: `Bearer ${supervisorToken}` }
    });
    const item = (after.body.data.allItems || []).find((i: any) => i.partName === partName);
    assert.equal(item.status, 'CONDEMNED', 'the condemnation must stand');
    assert.match(item.conditionNotes || '', /visible crack/, 'and the finding must survive with it');
  });
});
