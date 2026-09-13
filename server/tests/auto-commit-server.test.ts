/**
 * Auto-commit on the server — the source is kept, the switch-off is real
 * Indian Railways WRS Raipur
 *
 * The rule that decides is in the browser and tested there. What the server
 * must guarantee is narrower and matters more: a camera decision is written
 * as a camera decision and never as a person's, a client cannot claim a
 * source it is not entitled to, and the live agreement that switches a head
 * off is computed from the ledger honestly — silence not counted, corrections
 * counted.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { LearningService } from '../src/learning/learningService.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

const spring = (extra: Record<string, unknown> = {}) => ({
  batchId: 'b1',
  bogieType: 'CASNUB_22_NLB',
  condition: 'USED',
  springPosition: 'OUTER',
  measuredFreeHeight: 258,
  ...extra
});

describe('The source of a verdict', () => {
  let app: ExpressApp;
  let token: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
  });

  it('TC-ACS-01: a sorted spring defaults to MANUAL when nothing is claimed', async () => {
    const r = await call(app, 'POST', '/api/sorting/record', spring(), auth(token));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const row = getDatabase().prepare('SELECT measurement_source s FROM spring_sorting_records WHERE id = ?').get(r.body.data.id) as any;
    assert.strictEqual(row.s, 'MANUAL');
  });

  it('TC-ACS-02: a camera decision is written as CAMERA_AUTO, on the row', async () => {
    const r = await call(app, 'POST', '/api/sorting/record', spring({ measurementSource: 'CAMERA_AUTO' }), auth(token));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const row = getDatabase().prepare('SELECT measurement_source s FROM spring_sorting_records WHERE id = ?').get(r.body.data.id) as any;
    assert.strictEqual(row.s, 'CAMERA_AUTO');
  });

  it('TC-ACS-03: a source outside the union is refused, not coerced to MANUAL', async () => {
    // Coercing would let a typo turn a camera decision into "a person did this".
    const r = await call(app, 'POST', '/api/sorting/record', spring({ measurementSource: 'GUESSED' }), auth(token));
    assert.strictEqual(r.status, 400);
    assert.match(r.body.message, /measurementSource must be/);
  });

  it('TC-ACS-04: a client may not claim OCR — only the caliper route knows that', async () => {
    const r = await call(app, 'POST', '/api/sorting/record', spring({ measurementSource: 'OCR' }), auth(token));
    assert.strictEqual(r.status, 400);
  });

  it('TC-ACS-05: a wagon checklist verdict carries its source the same way', async () => {
    const wagon = `SECR/BOXNHL/${60000 + Math.floor(Math.random() * 9000)}`;
    const reg = await call(app, 'POST', '/api/wagons/register', { wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR' }, auth(token));
    assert.strictEqual(reg.status, 201, JSON.stringify(reg.body));
    const list = await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}/checklist`, undefined, auth(token));
    const item = list.body.data.allItems[0];

    const upd = await call(
      app, 'PUT', `/api/wagons/${encodeURIComponent(wagon)}/checklist/items/${item.id}`,
      { status: 'PASS', verdictSource: 'CAMERA_AUTO' }, auth(token)
    );
    assert.ok(upd.status < 300, JSON.stringify(upd.body));
    const row = getDatabase().prepare('SELECT verdict_source s, status FROM checklist_items WHERE id = ?').get(item.id) as any;
    assert.strictEqual(row.s, 'CAMERA_AUTO');
    assert.strictEqual(row.status, 'PASS');

    // And the audit chain says so too.
    const audit = getDatabase().prepare(
      "SELECT payload_json FROM inspection_audit_log WHERE event_type = 'CHECKLIST_ITEM_INSPECTED' ORDER BY rowid DESC LIMIT 1"
    ).get() as any;
    assert.match(String(audit.payload_json), /CAMERA_AUTO/);
  });

  it('TC-ACS-06: a bad source on a checklist verdict is refused before anything is written', async () => {
    const wagon = `SECR/BOXNHL/${60000 + Math.floor(Math.random() * 9000)}`;
    await call(app, 'POST', '/api/wagons/register', { wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR' }, auth(token));
    const list = await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}/checklist`, undefined, auth(token));
    const item = list.body.data.allItems[0];
    const upd = await call(
      app, 'PUT', `/api/wagons/${encodeURIComponent(wagon)}/checklist/items/${item.id}`,
      { status: 'PASS', verdictSource: 'ROBOT' }, auth(token)
    );
    assert.strictEqual(upd.status, 400);
    const row = getDatabase().prepare('SELECT status FROM checklist_items WHERE id = ?').get(item.id) as any;
    assert.notStrictEqual(row.status, 'PASS');
  });
});

describe('The self-switch-off', () => {
  let app: ExpressApp;
  let token: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
  });

  function propose(head: string, corrected: boolean, n: number) {
    const ls = new LearningService(getDatabase());
    for (let i = 0; i < n; i++) {
      ls.recordOutcome({
        subsystem: 'SPRING_VISION',
        machineOutput: { head, label: 'OUTER' },
        humanOutput: { head, label: corrected ? 'INNER' : 'OUTER' },
        wasCorrected: corrected,
        userId: 'usr_insp_001'
      });
    }
  }

  it('TC-ACS-07: a fresh installation permits nothing — no head has enough proposals', async () => {
    const r = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.data.master, true);
    for (const h of r.body.data.heads) {
      assert.strictEqual(h.allowed, false, `${h.head} must not be allowed on a fresh install`);
      assert.match(h.reason, /Not enough recent proposals/);
    }
  });

  it('TC-ACS-08: a head inspectors keep agreeing with is permitted', async () => {
    propose('CATEGORY', false, 40);
    const r = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const cat = r.body.data.heads.find((h: any) => h.head === 'CATEGORY');
    assert.strictEqual(cat.sampled, 40);
    assert.strictEqual(cat.rate, 1);
    assert.strictEqual(cat.allowed, true);
    // Other heads are untouched by CATEGORY's record.
    const dmg = r.body.data.heads.find((h: any) => h.head === 'DAMAGE');
    assert.strictEqual(dmg.allowed, false);
  });

  it('TC-ACS-09: a head inspectors have started correcting switches itself off', async () => {
    propose('CATEGORY', false, 36);
    propose('CATEGORY', true, 4); // 90%
    const r = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const cat = r.body.data.heads.find((h: any) => h.head === 'CATEGORY');
    assert.strictEqual(cat.rate, 0.9);
    assert.strictEqual(cat.allowed, false);
    assert.match(cat.reason, /kept 90%/);
  });

  it('TC-ACS-10: silence is not agreement — a teaching with no proposal never reaches the rate', async () => {
    // Teach 50 with no proposal (the camera stayed quiet). Must not count.
    const teach = (i: number) => call(app, 'POST', '/api/vision/brain/teach', {
      domain: 'SPRING', head: 'CATEGORY', label: 'OUTER',
      embedding: Buffer.from(new Float32Array(1280).fill(i / 100).buffer).toString('base64')
    }, auth(token));
    for (let i = 0; i < 50; i++) await teach(i);
    const r = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const cat = r.body.data.heads.find((h: any) => h.head === 'CATEGORY');
    assert.strictEqual(cat.sampled, 0, 'silent teachings must not inflate the sample');
    assert.strictEqual(cat.allowed, false);
  });

  it('TC-ACS-11: the window is the most recent proposals, so an old good run cannot mask a bad week', async () => {
    propose('SURFACE', false, 200); // a good history
    propose('SURFACE', true, 50);   // then it goes wrong
    const r = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const s = r.body.data.heads.find((h: any) => h.head === 'SURFACE');
    assert.strictEqual(s.sampled, 200);
    // 50 corrected of the newest 200 -> 75%
    assert.strictEqual(s.rate, 0.75);
    assert.strictEqual(s.allowed, false);
  });
});

describe('An auto-commit may not vouch for itself', () => {
  it('TC-ACS-12: auto-committed events are excluded from the live agreement', async () => {
    const app = createApp(':memory:');
    const token = await signIn(app, 'inspector1');
    const ls = new LearningService(getDatabase());
    // 40 the camera decided on its own, all "agreeing" because nobody answered.
    for (let i = 0; i < 40; i++) {
      ls.recordOutcome({
        subsystem: 'SPRING_VISION',
        machineOutput: { head: 'DAMAGE', label: 'NONE' },
        humanOutput: { head: 'DAMAGE', label: 'NONE' },
        wasCorrected: false,
        context: { auto: true },
        userId: 'usr_insp_001'
      });
    }
    const r = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const d = r.body.data.heads.find((h: any) => h.head === 'DAMAGE');
    assert.strictEqual(d.sampled, 0, 'the camera agreeing with itself is not evidence');
    assert.strictEqual(d.allowed, false);
  });
});
