/**
 * A photograph must be able to say what it shows
 * Indian Railways WRS Raipur
 *
 * wagon_photos has carried an evidence_stage column — BEFORE, AFTER, DEFECT,
 * GENERAL — validated by the upload route, from the beginning. No screen ever
 * sent one, so every photograph in the database has a null stage.
 *
 * What that costs shows up in the condition report: it can say a part was
 * found cracked and later repaired, and it cannot show the two pictures that
 * would settle it, because the two pictures are indistinguishable.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Photograph evidence stage', () => {
  let app: ExpressApp;
  let token: string;
  const wagonNumber = 'SECR/BOXNHL/EVD001';
  const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const img = `data:image/jpeg;base64,${'A'.repeat(512)}`;

  before(async () => {
    app = createApp(':memory:');
    token = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR',
      name: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042'
    });
    await app.dispatch({
      method: 'POST', url: '/api/wagons/register', headers: auth(),
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });
  });

  test('TC-EVD-01: a before and an after photograph stay distinguishable', async () => {
    const chk = await app.dispatch({
      method: 'GET', url: `/api/wagons/${wagonNumber}/checklist`, headers: auth()
    });
    const item = chk.body.data.allItems[0];

    for (const stage of ['BEFORE', 'AFTER']) {
      const res = await app.dispatch({
        method: 'POST', url: '/api/photos/upload', headers: auth(),
        body: {
          wagonNumber, checklistItemId: item.id, partName: item.partName,
          partCategory: item.category, imageBase64: img, evidenceStage: stage
        }
      });
      assert.equal(res.status, 201, `${stage} upload refused: ${res.body?.message}`);
    }

    const list = await app.dispatch({
      method: 'GET', url: `/api/photos/wagon/${wagonNumber}`, headers: auth()
    });
    const photos = list.body?.data?.photos || list.body?.data || [];
    const stages = photos.map((p: any) => p.evidenceStage).sort();

    assert.deepEqual(stages, ['AFTER', 'BEFORE'], 'the report cannot pair them if they arrive unlabelled');
  });

  test('TC-EVD-02: an unrecognised stage is stored as none rather than as itself', async () => {
    /*
     * The column drives which caption a photograph gets on a report. A value
     * outside the four is not a new kind of evidence, it is a mistake, and
     * storing it would put an unexplained word under a picture.
     */
    const res = await app.dispatch({
      method: 'POST', url: '/api/photos/upload', headers: auth(),
      body: { wagonNumber, partName: 'Odd', imageBase64: img, evidenceStage: 'SOMETHING_ELSE' }
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.evidenceStage ?? null, null);
  });

  test('TC-EVD-03: a photograph queued offline keeps its stage', async () => {
    // The field was dropped on the way through the sync as well, so an
    // offline repair produced two pictures that could not be told apart.
    const res = await app.dispatch({
      method: 'POST', url: '/api/sync/batch', headers: auth(),
      body: {
        photos: [{
          clientTempId: 'pht-1', wagonNumber, partName: 'Brake Block',
          partCategory: 'BRAKE_SYSTEM', imageBase64: img, evidenceStage: 'AFTER'
        }]
      }
    });
    assert.equal(res.status, 200);

    const list = await app.dispatch({
      method: 'GET', url: `/api/photos/wagon/${wagonNumber}`, headers: auth()
    });
    const photos = list.body?.data?.photos || list.body?.data || [];
    const synced = photos.find((p: any) => p.partName === 'Brake Block');
    assert.ok(synced, 'the queued photograph must arrive');
    assert.equal(synced.evidenceStage, 'AFTER');
  });
});
