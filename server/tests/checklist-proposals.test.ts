/**
 * What the manual proposes, and what accepting it does
 * Indian Railways WRS Raipur
 *
 * The extractor must offer only what the manual states plainly, cite a page
 * for every line, and never write anything by being asked. Accepting must
 * apply the same rule as adding one line by hand — no source, no line — and
 * must not let one bad line stop the good ones.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { createManualTables, indexManualText } from '../src/manual/manualIndex.ts';
import { extractChecklistProposals } from '../src/manual/proposals.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

/* A page shaped like Chapter 7's must-change table, and one from Chapter 12
 * that must be ignored however much it looks like a check. */
const MANUAL = [
  'CHAPTER-7 AIR BRAKES SYSTEM  145',
  'Must change items during POH for Bogie Mounted brake system',
  'SNo  Component Description  Qty/Wagon',
  '  1  Pin; Clevis  4',
  '  2  Brake Head  8',
  '  3  Outer Spring  4',
  'a) Check the hoses for any cracks / damage. If so, replace them during POH.',
  '\f',
  'CHAPTER-12 FREIGHT MAINTENANCE MANAGEMENT  30',
  'POH shops must ensure the following:',
  'a) Ensure scrap collection and keeping up of premises clean at POH',
  '  1  Some Depot Quota  9'
].join('\n');

describe('Checklist proposals from the manual', () => {
  let app: ExpressApp;
  beforeEach(() => {
    app = createApp(':memory:');
    const db = getDatabase();
    createManualTables(db);
    indexManualText(db, MANUAL, 'manual.pdf', 'WMM');
  });

  it('TC-CP-01: must-change rows are offered with quantity and page; Chapter 12 is not', () => {
    const out = extractChecklistProposals(getDatabase(), []);
    const names = out.map((p) => p.partName);
    assert.ok(names.includes('Pin; Clevis'), JSON.stringify(names));
    assert.ok(names.includes('Brake Head'));
    assert.ok(!names.includes('Some Depot Quota'), 'a supervisory quota is not a wagon part');
    assert.ok(!names.some((n) => /scrap collection/i.test(n)), 'Chapter 12 duties are not parts checks');
    const pin = out.find((p) => p.partName === 'Pin; Clevis')!;
    assert.strictEqual(pin.qtyPerWagon, 4);
    assert.match(pin.standardReference, /WMM 2\.0 p\.\d+/);
    assert.strictEqual(pin.suggestedCategory, 'BRAKE_SYSTEM');
  });

  it('TC-CP-02: a line the shop already lists is marked, not hidden', () => {
    const out = extractChecklistProposals(getDatabase(), ['Outer Spring (Bogie 1)']);
    const spring = out.find((p) => p.partName === 'Outer Spring')!;
    assert.ok(spring, 'still offered');
    assert.strictEqual(spring.alreadyListed, true, 'but marked as already on the list');
    assert.strictEqual(out.find((p) => p.partName === 'Brake Head')!.alreadyListed, false);
  });

  it('TC-CP-03: asking for proposals writes nothing', async () => {
    const token = await signIn(app, 'admin1');
    const before = (getDatabase().prepare('SELECT COUNT(*) AS c FROM checklist_config').get() as any).c;
    const res = await call(app, 'GET', '/api/checklist/proposals?wagonType=BOXNHL', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.data.summary.mustChange >= 2);
    const after = (getDatabase().prepare('SELECT COUNT(*) AS c FROM checklist_config').get() as any).c;
    assert.strictEqual(after, before, 'looking must not add');
  });

  it('TC-CP-04: accepting adds the cited lines, refuses an uncited one alone, and is audited', async () => {
    const token = await signIn(app, 'admin1');
    const res = await call(app, 'POST', '/api/checklist/config/bulk', {
      wagonType: 'BOXNHL',
      items: [
        { partName: 'Pin; Clevis', category: 'BRAKE_SYSTEM', standardReference: 'WMM 2.0 p.145 — must-change item at POH', isMandatory: false },
        { partName: 'Brake Head', category: 'BRAKE_SYSTEM', standardReference: 'WMM 2.0 p.145 — must-change item at POH', isMandatory: true },
        { partName: 'Mystery Part', category: 'BRAKE_SYSTEM', standardReference: '' }
      ]
    }, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.data.accepted, ['Pin; Clevis', 'Brake Head']);
    assert.strictEqual(res.body.data.refused.length, 1);
    assert.match(res.body.data.refused[0].reason, /source/);

    const rows = getDatabase().prepare("SELECT part_name, is_mandatory, standard_reference FROM checklist_config WHERE wagon_type = 'BOXNHL' AND part_name IN ('Pin; Clevis','Brake Head')").all() as any[];
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows.find((r) => r.part_name === 'Brake Head').is_mandatory, 1);
    assert.match(rows[0].standard_reference, /WMM 2\.0/);

    const audit = getDatabase().prepare("SELECT payload_json FROM inspection_audit_log WHERE event_type = 'CHECKLIST_ITEM_UPDATED'").all() as any[];
    const mine = audit.map((r) => JSON.parse(r.payload_json)).find((p) => p.action === 'BULK_UPSERT_FROM_MANUAL');
    assert.ok(mine, 'accepting from the manual must be audited');
    assert.strictEqual(mine.count, 2);
  });

  it('TC-CP-05: a supervisor may neither ask nor accept — this changes what the gate enforces', async () => {
    const token = await signIn(app, 'supervisor1');
    const a = await call(app, 'GET', '/api/checklist/proposals?wagonType=BOXNHL', undefined, { authorization: `Bearer ${token}` });
    const b = await call(app, 'POST', '/api/checklist/config/bulk', { wagonType: 'BOXNHL', items: [{ partName: 'X', category: 'SPRINGS', standardReference: 'p.1' }] }, { authorization: `Bearer ${token}` });
    assert.strictEqual(a.status, 403);
    assert.strictEqual(b.status, 403);
  });
});
