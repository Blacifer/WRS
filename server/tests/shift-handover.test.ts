/**
 * The shift, written down — and never with a number the records lack
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * The handover note is the one place a language model writes prose that a
 * person will act on at the start of a shift. The guard that matters is not
 * whether it reads well but whether every figure in it exists in the records.
 * A draft that says twelve when the records say nine is discarded, and the
 * screen is told. These pin that, the offline template, and who may record.
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { config } from '../src/config/index.ts';
import { foreignNumbers, templateShiftHandover, type ShiftFacts } from '../src/ai/zapheit.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}
const modelSays = (content: string) => (async () =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;

const FACTS: ShiftFacts = {
  shiftDate: '2026-09-08', springsSorted: 41, springsCondemned: 9, sortingInspectors: 2,
  checklistVerdicts: 30, wagonsTouched: 3, defectsFound: 4, supervisorOverrides: 0,
  acousticDefects: 1, wagonsReleased: 1, gateSignoffs: 1
};

describe('Shift handover', () => {
  let app: ExpressApp;
  const realFetch = globalThis.fetch;
  const realKey = config.zapheitApiKey;

  beforeEach(() => { app = createApp(':memory:'); });
  after(() => { globalThis.fetch = realFetch; (config as any).zapheitApiKey = realKey; });

  it('TC-SH-01: the number guard catches a figure the records do not contain', () => {
    assert.deepStrictEqual(foreignNumbers('41 springs sorted, 9 condemned, 3 wagons touched.', FACTS), []);
    assert.deepStrictEqual(foreignNumbers('41 springs sorted, 12 condemned.', FACTS), ['12'], 'twelve is not in the records');
    // The date's own parts are permitted; a draft may say "8 September".
    assert.deepStrictEqual(foreignNumbers('On 8 September 2026, 41 springs were sorted.', FACTS), []);
  });

  it('TC-SH-02: the template only ever prints the figures it was given', () => {
    const t = templateShiftHandover(FACTS);
    assert.deepStrictEqual(foreignNumbers(t, FACTS), [], 'the template cannot lie');
    assert.match(t, /41 springs/);
    assert.match(t, /9 were condemned/);
  });

  it('TC-SH-03: with no model, the draft is the template and says so', async () => {
    (config as any).zapheitApiKey = null;
    const token = await signIn(app, 'supervisor1');
    const res = await call(app, 'GET', '/api/shift/handover/draft?date=2026-09-08', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.source, 'TEMPLATE');
    assert.ok(res.body.data.draft.length > 20);
  });

  it('TC-SH-04: a model draft that invents a number is discarded, and the screen is told', async () => {
    (config as any).zapheitApiKey = 'test-key';
    globalThis.fetch = modelSays('A quiet shift: 57 springs were sorted and 12 condemned.');
    const token = await signIn(app, 'supervisor1');
    const res = await call(app, 'GET', '/api/shift/handover/draft?date=2026-09-08', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.source, 'TEMPLATE', 'the invented draft must not be used');
    assert.ok(res.body.data.rejectedNumbers.length > 0, 'and the rejection must be reported');
  });

  it('TC-SH-05: a model draft that sticks to the facts is used', async () => {
    (config as any).zapheitApiKey = 'test-key';
    // An empty in-memory shift: every count is zero, so only zeros and the date are permitted.
    globalThis.fetch = modelSays('No springs were sorted and no wagons were released on 2026-09-08.');
    const token = await signIn(app, 'supervisor1');
    const res = await call(app, 'GET', '/api/shift/handover/draft?date=2026-09-08', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.body.data.source, 'MODEL');
    assert.match(res.body.data.draft, /No springs/);
  });

  it('TC-SH-06: recording needs wagon.release — an inspector is refused', async () => {
    const token = await signIn(app, 'inspector1');
    const res = await call(app, 'POST', '/api/shift/handover',
      { shiftDate: '2026-09-08', body: 'A note long enough to be a sentence about the shift.', draftSource: 'TEMPLATE', edited: false },
      { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 403);
  });

  it('TC-SH-07: a recorded note is kept under the supervisor’s name and audited', async () => {
    const token = await signIn(app, 'supervisor1');
    const res = await call(app, 'POST', '/api/shift/handover',
      { shiftDate: '2026-09-08', body: 'Forty-one springs sorted; the bearing on 40101 needs a second listen tomorrow.', draftSource: 'MODEL', edited: true },
      { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));

    const row = getDatabase().prepare('SELECT recorded_by, edited, draft_source FROM shift_handovers WHERE id = ?').get(res.body.data.id) as any;
    assert.strictEqual(row.recorded_by, 'usr_sup_001');
    assert.strictEqual(row.edited, 1);
    assert.strictEqual(row.draft_source, 'MODEL');

    const audit = getDatabase().prepare(`SELECT user_id, payload_json FROM inspection_audit_log WHERE event_type = 'BATCH_EXPORTED'`).all() as any[];
    const mine = audit.map((r) => ({ u: r.user_id, p: JSON.parse(r.payload_json) })).find((e) => e.p.action === 'SHIFT_HANDOVER_RECORDED');
    assert.ok(mine, 'recording a handover must reach the audit chain');
    assert.strictEqual(mine.u, 'usr_sup_001');

    const list = await call(app, 'GET', '/api/shift/handover', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(list.body.data[0].recordedByName.length > 0, true);
  });
});
