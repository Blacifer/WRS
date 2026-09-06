/**
 * What a component was FOUND as, not what it became
 * Indian Railways WRS Raipur
 *
 * checklist_items is updated in place. A part found cracked and then repaired
 * ends up with status REPAIRED and nothing in that row saying it was ever
 * cracked. So a condition report built from the table alone prints the same
 * word under "found" and under "work done" — which is not a before and after,
 * and quietly claims to know something it does not.
 *
 * The arrival state is in the audit log, which records previousStatus and
 * newStatus on every checklist write. This endpoint reads it back, oldest
 * first, so the first transition away from PENDING is the moment somebody
 * looked at the part and said what it was.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Checklist history — the finding, not the outcome', () => {
  let app: ExpressApp;
  let inspectorToken: string;
  const wagonNumber = 'SECR/BOXNHL/HIS001';
  const otherWagon = 'SECR/BOXNHL/HIS002';

  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  before(async () => {
    app = createApp(':memory:');
    inspectorToken = generateToken({
      id: 'usr_insp_001',
      username: 'inspector1',
      role: 'INSPECTOR',
      name: 'Ramesh Kumar',
      employeeId: 'WRS-INSP-1042'
    });

    for (const w of [wagonNumber, otherWagon]) {
      await app.dispatch({
        method: 'POST',
        url: '/api/wagons/register',
        headers: auth(inspectorToken),
        body: { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }
      });
    }

    // Find a real mandatory part and walk it through a repair.
    const chk = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: auth(inspectorToken)
    });
    const item = chk.body.data.allItems[0];

    await app.dispatch({
      method: 'PUT',
      url: `/api/wagons/${wagonNumber}/checklist/items/${item.id}`,
      headers: auth(inspectorToken),
      body: { status: 'FAIL', conditionNotes: 'Visible crack along the web.' }
    });
    await app.dispatch({
      method: 'PUT',
      url: `/api/wagons/${wagonNumber}/checklist/items/${item.id}`,
      headers: auth(inspectorToken),
      body: { status: 'REPAIRED', repairAction: 'REPAIRED', reinspectedStatus: 'PASS' }
    });
  });

  test('TC-HIST-01: the arrival finding survives a repair that overwrote the row', async () => {
    const cur = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: auth(inspectorToken)
    });
    const row = cur.body.data.allItems[0];
    assert.equal(row.status, 'REPAIRED', 'the row itself now holds only the outcome');

    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist/history`,
      headers: auth(inspectorToken)
    });
    assert.equal(res.status, 200);

    const events = res.body.data.events.filter((e: any) => e.itemId === row.id);
    assert.ok(events.length >= 2, 'both writes must be recorded');

    // Oldest first, so the first non-PENDING verdict is the finding.
    const finding = events.find((e: any) => e.newStatus && e.newStatus !== 'PENDING');
    assert.equal(finding.newStatus, 'FAIL', 'the part was found cracked, whatever it became');
    assert.equal(finding.conditionNotes, 'Visible crack along the web.');
  });

  test('TC-HIST-02: events come back oldest first', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist/history`,
      headers: auth(inspectorToken)
    });
    const times = res.body.data.events.map((e: any) => Date.parse(e.at));
    const sorted = [...times].sort((a, b) => a - b);
    assert.deepEqual(times, sorted, 'a caller taking the first event must get the earliest one');
  });

  test('TC-HIST-03: one wagon never returns another wagon\'s history', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${otherWagon}/checklist/history`,
      headers: auth(inspectorToken)
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.events.length, 0, 'nothing has been inspected on this wagon');
  });

  test('TC-HIST-04: an inspector can read it, not only a supervisor', async () => {
    /*
     * Deliberately not behind audit.read. That capability gates the record of
     * who did what across the whole workshop; this is the checklist the
     * inspector is already looking at, with its own history attached. Putting
     * it behind audit.read would make the condition report print "not
     * recorded" for the one role most likely to be standing at the wagon.
     */
    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist/history`,
      headers: auth(inspectorToken)
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.events.length > 0);
  });
});
