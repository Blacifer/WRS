/**
 * The shop owns its own checklist
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * On 22 August fourteen MANDATORY coupler items were built from photographs of
 * this shop's Mark-50 gauge boards. On 27 August they were withdrawn: the shop
 * does not overhaul MK-50 and holds no MK-50 gauges. Every one of those items
 * was permanently incompletable, so every wagon's exit gate was permanently
 * blocked, and the only way past would have been a supervisor bulk-clear —
 * which turns the exception into the normal path and hollows out the gate.
 *
 * For five days the only remedy was a code change. A checklist has to be
 * correctable by the people who do the work, on the day, with a cited source.
 * The API to do that has existed all along and had no user interface at all.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { getDatabase } from '../src/db/connection.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Checklist configuration', () => {
  let app: ExpressApp;
  let admin: string;
  let supervisor: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  before(() => {
    app = createApp(':memory:');
    admin = generateToken({
      id: 'usr_adm_001', username: 'admin1', role: 'ADMIN',
      name: 'A. K. Mishra', employeeId: 'WRS-ADM-0001'
    });
    supervisor = generateToken({
      id: 'usr_sup_001', username: 'supervisor1', role: 'SUPERVISOR',
      name: 'S. K. Verma', employeeId: 'WRS-SUP-2019'
    });
  });

  const save = (body: Record<string, unknown>, token = admin) =>
    app.dispatch({ method: 'POST', url: '/api/checklist/config', headers: auth(token), body });

  test('TC-CFG-01: an item with no cited source is refused', async () => {
    /*
     * The whole point. A source does not make a check correct — it makes it
     * answerable. Somebody can go and read the clause, and disagree with it. A
     * check nobody can trace is one nobody can challenge.
     */
    const res = await save({
      wagonType: 'BOXNHL', category: 'COUPLERS_DRAFT_GEAR',
      partName: 'Draft Gear Housing Wall Thickness', isMandatory: true
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'MISSING_STANDARD_REFERENCE');
    assert.match(res.body.message, /where it comes from/i);
  });

  test('TC-CFG-02: a blank source is refused as firmly as a missing one', async () => {
    const res = await save({
      wagonType: 'BOXNHL', category: 'COUPLERS_DRAFT_GEAR',
      partName: 'Draft Gear Housing Wall Thickness', isMandatory: true,
      standardReference: '   '
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'MISSING_STANDARD_REFERENCE');
  });

  test('TC-CFG-03: adding one item does NOT replace the whole checklist', async () => {
    /*
     * The trap this suite exists to close.
     *
     * applyChecklistTemplate uses the config table INSTEAD of the code
     * template whenever any row exists for a wagon type. So a single saved
     * line would have left every BOXNHL registered afterwards with exactly one
     * check on it — silently. Nothing fails; the wagon simply stops being
     * inspected.
     */
    const res = await save({
      wagonType: 'BOXNHL', category: 'COUPLERS_DRAFT_GEAR',
      partName: 'Draft Gear Housing Wall Thickness', isMandatory: true,
      standardReference: 'RDSO STR 49-BD-08'
    });
    assert.equal(res.status, 200, `save refused: ${res.body?.message}`);

    const wagonNumber = 'SECR/BOXNHL/CFG001';
    const insp = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR',
      name: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042'
    });
    await app.dispatch({
      method: 'POST', url: '/api/wagons/register', headers: auth(insp),
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    const chk = await app.dispatch({
      method: 'GET', url: `/api/wagons/${wagonNumber}/checklist`, headers: auth(insp)
    });
    const items = chk.body.data.allItems;

    assert.ok(
      items.length > 30,
      `a wagon must keep its full checklist; got ${items.length} item(s) after one custom line was added`
    );
    assert.ok(
      items.some((i: any) => i.partName === 'Draft Gear Housing Wall Thickness'),
      'and the shop\'s own item must be on it'
    );
    assert.ok(
      items.some((i: any) => i.partName.includes('Outer Spring')),
      'the standard spring checks must survive'
    );
  });

  test('TC-CFG-04: a saved item can be retired, and wagons already registered keep it', async () => {
    /*
     * The Mark-50 situation, made fixable without a code change. A wagon is
     * inspected against the rules that applied when it arrived — rewriting
     * that afterwards would change what a released wagon was certified against.
     */
    const before = await app.dispatch({
      method: 'GET', url: '/api/wagons/SECR/BOXNHL/CFG001/checklist', headers: auth(admin)
    });
    const hadItem = (before.body.data.allItems || [])
      .some((i: any) => i.partName === 'Draft Gear Housing Wall Thickness');
    assert.ok(hadItem, 'the existing wagon should have been given the item');

    const res = await app.dispatch({
      method: 'DELETE', url: '/api/checklist/config', headers: auth(admin),
      body: {
        wagonType: 'BOXNHL', category: 'COUPLERS_DRAFT_GEAR',
        partName: 'Draft Gear Housing Wall Thickness'
      }
    });
    assert.equal(res.status, 200, `retire refused: ${res.body?.message}`);

    const after = await app.dispatch({
      method: 'GET', url: '/api/wagons/SECR/BOXNHL/CFG001/checklist', headers: auth(admin)
    });
    assert.ok(
      (after.body.data.allItems || []).some((i: any) => i.partName === 'Draft Gear Housing Wall Thickness'),
      'a wagon already registered keeps the checklist it was given'
    );
  });

  test('TC-CFG-05: retiring something that was never configured says so', async () => {
    // Saying "retired" about a line that lives in code would leave somebody
    // believing a check had been withdrawn when it had not.
    const res = await app.dispatch({
      method: 'DELETE', url: '/api/checklist/config', headers: auth(admin),
      body: { wagonType: 'BOBRN', category: 'SPRINGS', partName: 'Nothing Like This' }
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'RULE_NOT_CONFIGURED');
  });

  test('TC-CFG-06: a supervisor cannot change what wagons are checked against', async () => {
    const res = await save({
      wagonType: 'BOXNHL', category: 'SPRINGS', partName: 'Something New',
      isMandatory: true, standardReference: 'RDSO G-95'
    }, supervisor);
    assert.ok(res.status === 403 || res.status === 401, `expected refusal, got ${res.status}`);
  });

  test('TC-CFG-07: the change is recorded against the person who made it', async () => {
    /*
     * Changing the checklist changes what every future wagon is judged by.
     * That is at least as consequential as any single verdict, and the record
     * has to name who did it.
     */
    const rows = getDatabase().prepare(`
      SELECT user_id, payload_json FROM inspection_audit_log
      WHERE event_type = 'CHECKLIST_ITEM_UPDATED'
    `).all() as any[];

    const configEvents = rows
      .map((r) => ({ user: r.user_id, p: JSON.parse(r.payload_json) }))
      .filter((r) => r.p.scope === 'CHECKLIST_CONFIG');

    assert.ok(configEvents.length >= 2, 'both the save and the retire must be recorded');
    assert.ok(configEvents.every((e) => e.user === 'usr_adm_001'), 'named, not "system"');
    assert.ok(configEvents.some((e) => e.p.action === 'UPSERT'));
    assert.ok(configEvents.some((e) => e.p.action === 'RETIRE'));
    assert.ok(
      configEvents.some((e) => e.p.standardReference === 'RDSO STR 49-BD-08'),
      'the cited source belongs in the record too'
    );
  });
});
