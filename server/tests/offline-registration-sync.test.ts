/**
 * A wagon registered at the gate with no signal must still arrive
 * Indian Railways WRS Raipur
 *
 * Registering a wagon offline queued a checklist item called "Intake
 * Inspection" against a wagon number the server had never heard of. On sync
 * the checklist row was created against a wagon id invented on the spot, and
 * the registration itself — type, owning railway, entry notes, the fact that
 * a wagon had arrived — was never sent anywhere. The wagon did not exist and
 * the orphan row was the only trace that anybody had tried.
 *
 * The sync endpoint has always accepted a `wagons` array. Nothing ever put
 * anything in it, so the whole branch was dead and no test noticed, because
 * every test builds the payload it wants to send.
 *
 * The entry gate is the part of the shop with the worst signal, which makes
 * this the queue most likely to be used.
 *
 * These tests send what the device actually builds — the payload shape from
 * offlineDb.syncPendingBatch — rather than a payload written to suit the
 * server.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Offline wagon registration reaches the server', () => {
  let app: ExpressApp;
  let inspectorToken: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  before(() => {
    app = createApp(':memory:');
    inspectorToken = generateToken({
      id: 'usr_insp_001',
      username: 'inspector1',
      role: 'INSPECTOR',
      name: 'Ramesh Kumar',
      employeeId: 'WRS-INSP-1042'
    });
  });

  /** The batch exactly as the device assembles it, empty arrays included. */
  const batch = (over: Record<string, unknown>) => ({
    wagons: [],
    records: [],
    checklistItems: [],
    photos: [],
    transitions: [],
    deviceId: 'WRS-RAIPUR-PWA-test',
    syncTimestamp: new Date().toISOString(),
    ...over
  });

  test('TC-OFF-REG-01: a queued registration creates the wagon, with what was typed at the gate', async () => {
    const wagonNumber = 'SECR/BOXNHL/61001';

    const res = await app.dispatch({
      method: 'POST',
      url: '/api/sync/batch',
      headers: auth(inspectorToken),
      body: batch({
        wagons: [{
          clientTempId: 'wgn-1',
          wagonNumber,
          wagonType: 'BOXNHL',
          owningRailway: 'SECR',
          entryNotes: 'Arrived with visible brake block wear on bogie 2.',
          createdAt: new Date().toISOString()
        }]
      })
    });

    assert.equal(res.status, 200, `sync refused: ${res.body?.message}`);

    const got = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}`,
      headers: auth(inspectorToken)
    });

    assert.equal(got.status, 200, 'the wagon must exist after the queue drains');
    assert.equal(got.body.data.wagonNumber, wagonNumber);
    assert.equal(got.body.data.wagonType, 'BOXNHL');
    assert.equal(got.body.data.owningRailway, 'SECR');
    assert.equal(
      got.body.data.entryNotes,
      'Arrived with visible brake block wear on bogie 2.',
      'what the person at the gate typed is the part that cannot be reconstructed later'
    );
  });

  test('TC-OFF-REG-02: the wagon is created before checklist work that references it', async () => {
    /*
     * Both arrive in one batch, because both were captured in the same spell
     * with no network. If the checklist item were applied first it would
     * attach itself to an invented wagon id — which is precisely the orphan
     * row the old offline path produced.
     */
    const wagonNumber = 'SECR/BOXNHL/61002';

    const res = await app.dispatch({
      method: 'POST',
      url: '/api/sync/batch',
      headers: auth(inspectorToken),
      body: batch({
        wagons: [{
          clientTempId: 'wgn-2',
          wagonNumber,
          wagonType: 'BOXNHL',
          owningRailway: 'SECR',
          createdAt: new Date().toISOString()
        }],
        checklistItems: [{
          clientTempId: 'chk-2',
          wagonNumber,
          category: 'BRAKE_SYSTEM',
          partName: 'Brake Block',
          bogiePosition: 'BOGIE_1',
          status: 'CONDEMNED',
          conditionNotes: 'Worn past the condemning limit.',
          createdAt: new Date().toISOString()
        }]
      })
    });

    assert.equal(res.status, 200);

    const chk = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: auth(inspectorToken)
    });
    assert.equal(chk.status, 200);

    const item = (chk.body.data.allItems || []).find(
      (i: any) => i.partName === 'Brake Block' && i.bogiePosition === 'BOGIE_1'
    );
    assert.ok(item, 'the queued verdict must be on the wagon');
    assert.equal(item.status, 'CONDEMNED');
    assert.equal(item.conditionNotes, 'Worn past the condemning limit.');
  });

  test('TC-OFF-REG-03: replaying the same batch does not create the wagon twice', async () => {
    // A queue is drained on a flaky connection; the same batch can be sent
    // again when the response is lost. That must be harmless.
    const wagonNumber = 'SECR/BOXNHL/61003';
    const body = batch({
      wagons: [{
        clientTempId: 'wgn-3',
        wagonNumber,
        wagonType: 'BCNHL',
        owningRailway: 'SECR',
        createdAt: new Date().toISOString()
      }]
    });

    for (let i = 0; i < 3; i++) {
      const res = await app.dispatch({ method: 'POST', url: '/api/sync/batch', headers: auth(inspectorToken), body });
      assert.equal(res.status, 200, `replay ${i + 1} refused`);
    }

    const list = await app.dispatch({
      method: 'GET',
      url: '/api/wagons?limit=200',
      headers: auth(inspectorToken)
    });
    const matches = (list.body.data.wagons || list.body.data || []).filter(
      (w: any) => w.wagonNumber === wagonNumber
    );
    assert.equal(matches.length, 1, 'a replayed registration must not duplicate the wagon');
  });
});
