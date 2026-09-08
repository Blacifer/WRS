/**
 * Adding a part to one wagon's checklist
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * POST /wagons/:n/checklist/items shipped with no screen and no capability
 * check, and isMandatory defaulted to TRUE. A mandatory row left PENDING is a
 * CRITICAL_BLOCKER, so any signed-in user could seal a wagon shut with a call
 * that never mentioned the exit gate.
 *
 * That is the Mark-50 episode reproducible one vehicle at a time. In August
 * fourteen mandatory coupler checks were added from a photograph of a gauge
 * board; none could ever be completed, every wagon's gate stayed shut, and the
 * only remedy was editing the source. These tests pin the three things that
 * make it safe: added rows are advisory unless somebody with gate authority
 * says otherwise, they carry a reason, and they can be taken back out.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}

async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

const WAGON = 'SECR/BOXNHL/78010';

/*
 * The gate's own answer, with the request checked.
 *
 * A first version of this asked for /exit-gate, which does not exist, and
 * returned [] from the 404 — so the test asserting that an advisory row does
 * NOT block passed without ever reaching the gate. An absence is only evidence
 * when the question was actually asked.
 */
async function blockers(app: ExpressApp, token: string): Promise<string[]> {
  const res = await call(app, 'GET', `/api/wagons/${encodeURIComponent(WAGON)}/gate/status`, undefined,
    { authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 200, `gate status did not answer: ${JSON.stringify(res.body)}`);
  const list = res.body?.data?.blockers;
  assert.ok(Array.isArray(list), `gate status returned no blockers array: ${JSON.stringify(res.body)}`);
  return list;
}

describe('Adding a part to one wagon’s checklist', () => {
  let app: ExpressApp;
  let inspector: string;
  let admin: string;

  beforeEach(async () => {
    app = createApp(':memory:');
    inspector = await signIn(app, 'inspector1');
    admin = await signIn(app, 'admin1');
    await call(app, 'POST', '/api/wagons/register',
      { wagonNumber: WAGON, wagonType: 'BOXNHL', owningRailway: 'SECR' },
      { authorization: `Bearer ${inspector}` });
  });

  it('TC-CIA-01: an inspector may add a part they found, and it is advisory', async () => {
    const res = await call(app, 'POST', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items`,
      { category: 'BOGIE_FRAME_BOLSTER', partName: 'Cracked lifting bracket', addedReason: 'Found during visual inspection' },
      { authorization: `Bearer ${inspector}` });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.isMandatory, false, 'an added row must not gate by default');
    assert.strictEqual(res.body.data.shopAdded, true);
  });

  it('TC-CIA-02: an advisory added row does not hold the wagon', async () => {
    // The property that matters. It is PENDING, and PENDING only blocks when
    // the row is mandatory.
    await call(app, 'POST', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items`,
      { category: 'BOGIE_FRAME_BOLSTER', partName: 'Cracked lifting bracket', addedReason: 'Found during visual inspection' },
      { authorization: `Bearer ${inspector}` });

    const list = await blockers(app, admin);
    assert.ok(
      !list.some((b) => b.includes('Cracked lifting bracket')),
      'an advisory row must not appear as an exit gate blocker'
    );
  });

  it('TC-CIA-03: an inspector cannot make a row MANDATORY', async () => {
    // Deciding a wagon may not leave without a part is "change what the exit
    // gate enforces", which is checklist.configure — not an inspector's.
    const res = await call(app, 'POST', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items`,
      { category: 'BOGIE_FRAME_BOLSTER', partName: 'Extra bracket', isMandatory: true, addedReason: 'Looks important' },
      { authorization: `Bearer ${inspector}` });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /checklist\.configure/);
  });

  it('TC-CIA-04: an administrator can, and then it does hold the wagon', async () => {
    const res = await call(app, 'POST', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items`,
      { category: 'BOGIE_FRAME_BOLSTER', partName: 'Draft gear pocket wear', isMandatory: true, addedReason: 'Shop instruction 44/2026' },
      { authorization: `Bearer ${admin}` });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.isMandatory, true);

    const list = await blockers(app, admin);
    assert.ok(
      list.some((b) => b.includes('Draft gear pocket wear')),
      'a mandatory row left PENDING must block, or making it mandatory meant nothing'
    );
  });

  it('TC-CIA-05: a mandatory row can be withdrawn again — the Mark-50 way out', async () => {
    /*
     * The whole point. In August this state was unrecoverable: the wagon could
     * not leave and nothing in the application could take the row away.
     */
    const added = await call(app, 'POST', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items`,
      { category: 'COUPLERS_DRAFT_GEAR', partName: 'MK-50 gauge check', isMandatory: true, addedReason: 'From a board photograph' },
      { authorization: `Bearer ${admin}` });

    assert.ok((await blockers(app, admin)).some((b) => b.includes('MK-50 gauge check')));

    const gone = await call(app, 'POST', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items/${added.body.data.id}/withdraw`,
      { reason: 'The shop does not overhaul MK-50 and holds no gauges for it' },
      { authorization: `Bearer ${admin}` });
    assert.strictEqual(gone.status, 200, JSON.stringify(gone.body));

    assert.ok(
      !(await blockers(app, admin)).some((b) => b.includes('MK-50 gauge check')),
      'withdrawing the row must release the gate'
    );
  });

  it('TC-CIA-06: a template row cannot be withdrawn from one wagon', async () => {
    // The standard is not something one person waives on one vehicle.
    const items = await call(app, 'GET', `/api/wagons/${encodeURIComponent(WAGON)}/checklist`, undefined,
      { authorization: `Bearer ${inspector}` });
    const list = items.body.data?.items || items.body.data?.categories
      ? Object.values(items.body.data.categories || {}).flat() as any[]
      : (items.body.data as any[]);
    const template = (list as any[]).find((i: any) => !i.shopAdded);
    assert.ok(template, 'the wagon should have template rows');

    const res = await call(app, 'POST', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items/${template.id}/withdraw`,
      { reason: 'Trying to remove a standard check' },
      { authorization: `Bearer ${admin}` });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'TEMPLATE_ITEM');
  });

  it('TC-CIA-07: an added row must say why it was added', async () => {
    const res = await call(app, 'POST', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items`,
      { category: 'BOGIE_FRAME_BOLSTER', partName: 'Unexplained item' },
      { authorization: `Bearer ${inspector}` });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'MISSING_REASON');
  });

  it('TC-CIA-08: adding a row is recorded in the audit chain, against the person', async () => {
    await call(app, 'POST', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items`,
      { category: 'BOGIE_FRAME_BOLSTER', partName: 'Audited bracket', addedReason: 'Found during visual inspection' },
      { authorization: `Bearer ${inspector}` });

    const rows = getDatabase()
      .prepare(`SELECT user_id, payload_json FROM inspection_audit_log WHERE event_type = 'CHECKLIST_ITEM_UPDATED'`)
      .all() as Array<{ user_id: string; payload_json: string }>;

    const entry = rows.map((r) => ({ user: r.user_id, p: JSON.parse(r.payload_json) }))
      .find((e) => e.p.action === 'ADDED_TO_WAGON' && e.p.partName === 'Audited bracket');

    assert.ok(entry, 'adding a checklist row must be audited');
    assert.strictEqual(entry.user, 'usr_insp_001', 'against the person who added it');
    assert.strictEqual(entry.p.gateAffecting, false, 'and it must say whether it touched the gate');
  });
});
