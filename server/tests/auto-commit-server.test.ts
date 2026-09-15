/**
 * Auto-commit on the server — the server decides, not the bench
 * Indian Railways WRS Raipur
 *
 * Until these tests, the server's part in a camera decision was to check that
 * the word CAMERA_AUTO was spelled correctly. Every condition in
 * shared/vision/autoCommit.ts was judged in the browser that wanted to skip
 * the tap, and the kill switch was reported by one endpoint and consulted by
 * none. TC-ACS-02 in the previous version of this file asserted, as a
 * passing test, that a bare CAMERA_AUTO claim with nothing behind it was
 * written to the row. That test was the hole.
 *
 * What the server must now guarantee, and what is tested here:
 *   - a CAMERA_AUTO write with no evidence is refused before anything is written;
 *   - one that arrives while VISION_AUTO_COMMIT is off is refused;
 *   - one whose heads have not earned ASSIST on the server's own examples is
 *     refused, whatever the bench believed;
 *   - one whose claimed labels differ from the server's own vote is refused;
 *   - one that passes every condition on the server's evidence is written,
 *     as CAMERA_AUTO, and the ledger row for it is written by the server in
 *     the same request and excluded from the live agreement;
 *   - a wagon part goes through the same gate, and may never be a FAIL;
 *   - drawn examples (SYNTHETIC_DRIVE) are not knowledge unless the server
 *     was started to count them, which production refuses;
 *   - the leave-one-out score hides a sitting and hides a twin.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { LearningService } from '../src/learning/learningService.ts';
import { config } from '../src/config/index.ts';
import { SYNTHETIC_PART_NAME } from '../../shared/vision/types.ts';
import { encodeEmbedding, l2Normalise } from '../../shared/vision/knn.ts';
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

// ---------------------------------------------------------------------------
// Made-up embeddings that behave like real ones: same class near, other
// classes far, and a "twin" exactly as near as a second frame of one spring.
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A frame, as one embedding of one object. Real embeddings of two springs
 * share most of their 1280 numbers — both are springs on a bench — and differ
 * by small amounts that encode what kind, what surface, what damage. Modelled
 * here as a large common base plus one small axis per attribute plus noise:
 * two frames agreeing on all attributes sit at ≈0.95, on none at ≈0.54, and
 * an identical seed gives an exact twin at 1.0.
 */
function compose(classes: number[], seed: number): Float32Array {
  const r = rng(seed * 7919 + 1);
  const v = new Float32Array(1280);
  for (let i = 0; i < 1280; i++) v[i] = (r() - 0.5) * 2;
  const noise = l2Normalise(v);
  const out = new Float32Array(1280);
  for (let i = 0; i < 1280; i++) out[i] = noise[i] * 0.3;
  out[1000] += 1.0; // spring-ness, shared by everything
  for (const c of classes) out[c * 10] += 0.5;
  return l2Normalise(out);
}

const b64 = (v: Float32Array) => encodeEmbedding(v);

/** Class axes: 0..2 category, 3..5 surface, 6..7 damage. */
const CAT: Record<string, number> = { OUTER: 0, INNER: 1, SNUBBER: 2 };
const SURF: Record<string, number> = { CLEAN: 3, LIGHT_RUST: 4, HEAVY_RUST: 5 };
const DMG: Record<string, number> = { NONE: 6, CRACK: 7 };

/** One spring: what the camera would see of it. */
const springFrame = (cat: string, surf: string, dmg: string, seed: number) => compose([CAT[cat], SURF[surf], DMG[dmg]], seed);
const partFrame = (surf: string, dmg: string, seed: number) => compose([SURF[surf], DMG[dmg]], seed);

/**
 * Teach `per` examples per label per head, each its own sitting. The examples
 * for one head vary that head's attribute and hold the others at the
 * ordinary case — a clean, undamaged outer spring — which is what a shop's
 * teaching set mostly is.
 */
async function teachEarned(
  app: ExpressApp,
  token: string,
  domain: 'SPRING' | 'WAGON_PART',
  heads: string[],
  per = 20,
  partName: string | null = null
) {
  const labelsOf: Record<string, string[]> = {
    CATEGORY: Object.keys(CAT), SURFACE: Object.keys(SURF), DAMAGE: Object.keys(DMG)
  };
  for (const head of heads) {
    for (const label of labelsOf[head]) {
      for (let i = 0; i < per; i++) {
        const seed = 1000 + i + label.length * 37 + head.length * 101;
        const embedding = domain === 'SPRING'
          ? springFrame(head === 'CATEGORY' ? label : 'OUTER', head === 'SURFACE' ? label : 'CLEAN', head === 'DAMAGE' ? label : 'NONE', seed)
          : partFrame(head === 'SURFACE' ? label : 'CLEAN', head === 'DAMAGE' ? label : 'NONE', seed);
        const r = await call(app, 'POST', '/api/vision/brain/teach', {
          domain, head, label, embedding: b64(embedding),
          captureGroup: `cg_${head}_${label}_${i}`,
          partName
        }, auth(token));
        assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      }
    }
  }
}

/** Live agreement: `n` proposals a person kept (or corrected). */
function propose(domain: 'SPRING' | 'WAGON_PART', head: string, corrected: boolean, n: number, label = 'OUTER') {
  const ls = new LearningService(getDatabase());
  for (let i = 0; i < n; i++) {
    ls.recordOutcome({
      subsystem: domain === 'SPRING' ? 'SPRING_VISION' : 'PART_VISION',
      machineOutput: { head, label },
      humanOutput: { head, label: corrected ? 'OTHER' : label },
      wasCorrected: corrected,
      userId: 'usr_insp_001'
    });
  }
}

const SPRING_HEADS = ['CATEGORY', 'SURFACE', 'DAMAGE'];

/**
 * The shop's own evidence that a person can judge condition from a
 * photograph: `n` blind reads of `n` stored spring images, `agreeing` of
 * them agreeing with the recorded status. Written straight to the tables —
 * the reading screen is driven elsewhere; what these tests need is the
 * figure the camera's condition heads are now ceilinged by.
 */
function blindReads(n: number, agreeing: number) {
  const db = getDatabase();
  const img = db.prepare(`INSERT INTO spring_images (id, batch_id, bogie_type, spring_condition, spring_position, labelled_status, mime_type, image_data, inspector_id) VALUES (?, 'b', 'CASNUB_22_NLB', 'USED', 'OUTER', 'PASS', 'image/jpeg', 'data:image/jpeg;base64,AAAA', 'usr_insp_002')`);
  const read = db.prepare(`INSERT INTO spring_image_blind_reads (id, image_id, reader_id, read_status, status_agrees, band_agrees) VALUES (?, ?, 'usr_insp_001', 'PASS', ?, 1)`);
  for (let i = 0; i < n; i++) {
    img.run(`simg_t_${i}`);
    read.run(`sbr_t_${i}`, `simg_t_${i}`, i < agreeing ? 1 : 0);
  }
}
const PART_HEADS = ['SURFACE', 'DAMAGE'];

/** A clean, undamaged outer spring the camera has seen the like of, but not this one. */
const cleanOuterFrame = (seed = 5000) => springFrame('OUTER', 'CLEAN', 'NONE', seed);

const springEvidence = (emb: Float32Array, labels: Record<string, string> = { CATEGORY: 'OUTER', SURFACE: 'CLEAN', DAMAGE: 'NONE' }) => ({
  embedding: b64(emb),
  heads: Object.entries(labels).map(([head, label]) => ({ head, label, confidence: 0.95 }))
});

const spring = (extra: Record<string, unknown> = {}) => ({
  batchId: 'b1',
  bogieType: 'CASNUB_22_NLB',
  condition: 'USED',
  springPosition: 'OUTER',
  measuredFreeHeight: 258,
  ...extra
});

// ---------------------------------------------------------------------------

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

  it('TC-ACS-02: a bare CAMERA_AUTO claim is refused before anything is written', async () => {
    const r = await call(app, 'POST', '/api/sorting/record', spring({ measurementSource: 'CAMERA_AUTO' }), auth(token));
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, 'AUTO_EVIDENCE_MISSING');
    const n = getDatabase().prepare('SELECT COUNT(*) n FROM spring_sorting_records').get() as any;
    assert.strictEqual(n.n, 0);
  });

  it('TC-ACS-03: a source outside the union is refused, not coerced to MANUAL', async () => {
    const r = await call(app, 'POST', '/api/sorting/record', spring({ measurementSource: 'GUESSED' }), auth(token));
    assert.strictEqual(r.status, 400);
    assert.match(r.body.message, /measurementSource must be/);
  });

  it('TC-ACS-04: a client may not claim OCR — only the caliper route knows that', async () => {
    const r = await call(app, 'POST', '/api/sorting/record', spring({ measurementSource: 'OCR' }), auth(token));
    assert.strictEqual(r.status, 400);
  });

  it('TC-ACS-05: on a fresh installation the camera has earned nothing, and the server says so', async () => {
    const r = await call(app, 'POST', '/api/sorting/record',
      spring({ measurementSource: 'CAMERA_AUTO', autoEvidence: springEvidence(cleanOuterFrame()) }), auth(token));
    assert.strictEqual(r.status, 422, JSON.stringify(r.body));
    // The server's own camera has no examples, so it cannot even name the
    // spring — and it says so rather than pretending to agree.
    assert.strictEqual(r.body.error, 'AUTO_LABELS_DISAGREE');
    assert.match(r.body.message, /does not recognise/);
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

describe('The server judges a spring for itself', () => {
  let app: ExpressApp;
  let token: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
    config.visionAutoCommit = true;
  });
  afterEach(() => {
    config.visionAutoCommit = true;
  });

  async function earnEverything() {
    await teachEarned(app, token, 'SPRING', SPRING_HEADS, 20);
    for (const head of ['CATEGORY', 'SURFACE', 'DAMAGE']) propose('SPRING', head, false, 40);
    // And the people: thirty blind reads, all agreeing, so the condition heads are not ceilinged.
    blindReads(30, 30);
  }

  it('TC-ACS-10: once every head has earned it on the server\'s examples, a clean in-band spring is written CAMERA_AUTO', async () => {
    await earnEverything();
    const status = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    for (const h of status.body.data.heads.filter((h: any) => h.head !== 'PART_ID')) {
      assert.strictEqual(h.measured.verdict, 'ASSIST', `${h.head}: ${JSON.stringify(h.measured)}`);
      assert.strictEqual(h.allowed, true, h.reason);
    }

    const frame = cleanOuterFrame();
    const r = await call(app, 'POST', '/api/sorting/record',
      spring({ measurementSource: 'CAMERA_AUTO', autoEvidence: springEvidence(frame) }), auth(token));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.data.status, 'PASS');
    const row = getDatabase().prepare('SELECT measurement_source s FROM spring_sorting_records WHERE id = ?').get(r.body.data.id) as any;
    assert.strictEqual(row.s, 'CAMERA_AUTO');

    // The ledger row was written by the server, in this request, as an auto
    // decision — judged by the server, excluded from the live agreement.
    const led = getDatabase().prepare(
      `SELECT context_json FROM machine_learning_events
       WHERE subsystem = 'SPRING_VISION' AND json_extract(context_json, '$.auto') = 1`
    ).all() as any[];
    assert.strictEqual(led.length, 3, 'one auto row per head');
    for (const l of led) {
      const ctx = JSON.parse(l.context_json);
      assert.strictEqual(ctx.judgedBy, 'SERVER');
      assert.strictEqual(ctx.recordId, r.body.data.id);
    }
    const after = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const cat = after.body.data.heads.find((h: any) => h.head === 'CATEGORY');
    assert.strictEqual(cat.sampled, 40, 'the auto row must not join the live agreement');
  });

  it('TC-ACS-11: the kill switch is consulted on the write path, not just reported', async () => {
    await earnEverything();
    config.visionAutoCommit = false;
    const r = await call(app, 'POST', '/api/sorting/record',
      spring({ measurementSource: 'CAMERA_AUTO', autoEvidence: springEvidence(cleanOuterFrame()) }), auth(token));
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, 'AUTO_COMMIT_OFF');
    const n = getDatabase().prepare('SELECT COUNT(*) n FROM spring_sorting_records').get() as any;
    assert.strictEqual(n.n, 0);
  });

  it('TC-ACS-12: a head that has not earned it on the server refuses, whatever the bench believed', async () => {
    // Earned CATEGORY and SURFACE; DAMAGE has too few to score.
    await teachEarned(app, token, 'SPRING', ['CATEGORY', 'SURFACE'], 20);
    await teachEarned(app, token, 'SPRING', ['DAMAGE'], 5);
    for (const head of ['CATEGORY', 'SURFACE', 'DAMAGE']) propose('SPRING', head, false, 40);
    blindReads(30, 30);
    const r = await call(app, 'POST', '/api/sorting/record',
      spring({ measurementSource: 'CAMERA_AUTO', autoEvidence: springEvidence(cleanOuterFrame()) }), auth(token));
    assert.strictEqual(r.status, 422, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, 'AUTO_COMMIT_REFUSED');
    assert.strictEqual(r.body.data.decision.stoppedBy, 'NOT_EARNED');
    assert.match(r.body.message, /damage/i);
  });

  it('TC-ACS-13: the bench\'s labels must be the server\'s labels', async () => {
    await earnEverything();
    // The bench says INNER; the server's own vote on this frame says OUTER.
    const r = await call(app, 'POST', '/api/sorting/record',
      spring({ springPosition: 'INNER', measurementSource: 'CAMERA_AUTO',
        autoEvidence: springEvidence(cleanOuterFrame(), { CATEGORY: 'INNER', SURFACE: 'CLEAN', DAMAGE: 'NONE' }) }), auth(token));
    assert.strictEqual(r.status, 422, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, 'AUTO_LABELS_DISAGREE');
    assert.match(r.body.message, /says OUTER.*bench said INNER/);
  });

  it('TC-ACS-14: the recorded position must be the one the server\'s camera names — the band table depends on it', async () => {
    await earnEverything();
    // The bench and the server agree the camera says OUTER — but the row is
    // being filed as INNER. That is the wrong band table.
    const r = await call(app, 'POST', '/api/sorting/record',
      spring({ springPosition: 'INNER', measurementSource: 'CAMERA_AUTO', autoEvidence: springEvidence(cleanOuterFrame()) }), auth(token));
    assert.strictEqual(r.status, 422, JSON.stringify(r.body));
    assert.strictEqual(r.body.data.decision.stoppedBy, 'DISAGREES_WITH_BENCH');
  });

  it('TC-ACS-15: the camera may never condemn on its own — an out-of-band height is refused', async () => {
    await earnEverything();
    const r = await call(app, 'POST', '/api/sorting/record',
      spring({ measuredFreeHeight: 200, measurementSource: 'CAMERA_AUTO', autoEvidence: springEvidence(cleanOuterFrame()) }), auth(token));
    assert.strictEqual(r.status, 422, JSON.stringify(r.body));
    assert.strictEqual(r.body.data.decision.stoppedBy, 'MEASUREMENT_FAILED');
    assert.strictEqual(r.body.data.decision.outcome, 'CONDEMN');
  });

  it('TC-ACS-16: a fault the server\'s camera sees is refused, whatever the bench claimed', async () => {
    await earnEverything();
    // A cracked outer spring, claimed as NONE.
    const r = await call(app, 'POST', '/api/sorting/record',
      spring({ measurementSource: 'CAMERA_AUTO', autoEvidence: springEvidence(springFrame('OUTER', 'CLEAN', 'CRACK', 6000)) }), auth(token));
    assert.strictEqual(r.status, 422, JSON.stringify(r.body));
    // Refused on the label disagreement — the server said CRACK, the bench
    // said NONE — which is earlier in the gate than the fault itself.
    assert.strictEqual(r.body.error, 'AUTO_LABELS_DISAGREE');
    assert.match(r.body.message, /says CRACK/);
  });

  it('TC-ACS-17: the live agreement falling switches the head off on the write path', async () => {
    await teachEarned(app, token, 'SPRING', SPRING_HEADS, 20);
    propose('SPRING', 'CATEGORY', false, 36);
    propose('SPRING', 'CATEGORY', true, 4); // 90%
    for (const head of ['SURFACE', 'DAMAGE']) propose('SPRING', head, false, 40);
    const r = await call(app, 'POST', '/api/sorting/record',
      spring({ measurementSource: 'CAMERA_AUTO', autoEvidence: springEvidence(cleanOuterFrame()) }), auth(token));
    assert.strictEqual(r.status, 422, JSON.stringify(r.body));
    assert.strictEqual(r.body.data.decision.stoppedBy, 'AGREEMENT_FELL');
  });
});

describe('The server judges a wagon part for itself', () => {
  let app: ExpressApp;
  let token: string;
  let wagon: string;
  let item: any;
  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
    config.visionAutoCommit = true;
    wagon = `SECR/BOXNHL/${60000 + Math.floor(Math.random() * 9000)}`;
    const reg = await call(app, 'POST', '/api/wagons/register', { wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR' }, auth(token));
    assert.strictEqual(reg.status, 201, JSON.stringify(reg.body));
    const list = await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}/checklist`, undefined, auth(token));
    item = list.body.data.allItems.find((i: any) => i.category !== 'SPRINGS');
  });

  const partEvidence = (frame: Float32Array, labels: Record<string, string> = { SURFACE: 'CLEAN', DAMAGE: 'NONE' }) => ({
    embedding: b64(frame),
    heads: Object.entries(labels).map(([head, label]) => ({ head, label, confidence: 0.95 }))
  });
  const put = (body: any) => call(app, 'PUT', `/api/wagons/${encodeURIComponent(wagon)}/checklist/items/${item.id}`, body, auth(token));

  it('TC-ACS-20: a bare CAMERA_AUTO on a checklist line is refused and nothing is written', async () => {
    const upd = await put({ status: 'PASS', verdictSource: 'CAMERA_AUTO' });
    assert.strictEqual(upd.status, 400, JSON.stringify(upd.body));
    assert.strictEqual(upd.body.error, 'AUTO_EVIDENCE_MISSING');
    const row = getDatabase().prepare('SELECT status FROM checklist_items WHERE id = ?').get(item.id) as any;
    assert.notStrictEqual(row.status, 'PASS');
  });

  it('TC-ACS-21: an earned camera passes a clean part, CAMERA_AUTO on the row and in the audit chain', async () => {
    await teachEarned(app, token, 'WAGON_PART', PART_HEADS, 20, 'Brake Block');
    for (const head of ['SURFACE', 'DAMAGE']) propose('WAGON_PART', head, false, 40, 'CLEAN');
    const upd = await put({ status: 'PASS', reinspectedStatus: 'PASS', verdictSource: 'CAMERA_AUTO', autoEvidence: partEvidence(partFrame('CLEAN', 'NONE', 7000)) });
    assert.strictEqual(upd.status, 200, JSON.stringify(upd.body));
    const row = getDatabase().prepare('SELECT verdict_source s, status FROM checklist_items WHERE id = ?').get(item.id) as any;
    assert.strictEqual(row.s, 'CAMERA_AUTO');
    assert.strictEqual(row.status, 'PASS');
    const audit = getDatabase().prepare(
      "SELECT payload_json FROM inspection_audit_log WHERE event_type = 'CHECKLIST_ITEM_INSPECTED' ORDER BY rowid DESC LIMIT 1"
    ).get() as any;
    assert.match(String(audit.payload_json), /CAMERA_AUTO/);
    const led = getDatabase().prepare(
      `SELECT COUNT(*) n FROM machine_learning_events WHERE subsystem = 'PART_VISION' AND json_extract(context_json, '$.auto') = 1`
    ).get() as any;
    assert.strictEqual(led.n, 2);
  });

  it('TC-ACS-22: the camera may record a PASS without a tap; it may never record a fault', async () => {
    await teachEarned(app, token, 'WAGON_PART', PART_HEADS, 20, 'Brake Block');
    for (const head of ['SURFACE', 'DAMAGE']) propose('WAGON_PART', head, false, 40, 'CLEAN');
    const upd = await put({ status: 'FAIL', verdictSource: 'CAMERA_AUTO', autoEvidence: partEvidence(partFrame('CLEAN', 'NONE', 7000)) });
    assert.strictEqual(upd.status, 422, JSON.stringify(upd.body));
    assert.match(upd.body.message, /never record a fault/);
    const row = getDatabase().prepare('SELECT status FROM checklist_items WHERE id = ?').get(item.id) as any;
    assert.notStrictEqual(row.status, 'FAIL');
  });

  it('TC-ACS-23: a part the server\'s camera sees a crack on is not auto-passed', async () => {
    await teachEarned(app, token, 'WAGON_PART', PART_HEADS, 20, 'Brake Block');
    for (const head of ['SURFACE', 'DAMAGE']) propose('WAGON_PART', head, false, 40, 'CLEAN');
    const upd = await put({ status: 'PASS', verdictSource: 'CAMERA_AUTO', autoEvidence: partEvidence(partFrame('CLEAN', 'CRACK', 7000)) });
    assert.strictEqual(upd.status, 422, JSON.stringify(upd.body));
    assert.strictEqual(upd.body.error, 'AUTO_LABELS_DISAGREE');
    assert.match(upd.body.message, /says CRACK/);
  });
});

describe('Drawn examples are not knowledge', () => {
  let app: ExpressApp;
  let token: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
    config.visionCountSynthetic = false;
  });
  afterEach(() => {
    config.visionCountSynthetic = false;
  });

  it('TC-ACS-30: SYNTHETIC_DRIVE rows are left out of what the camera compares against and out of the counts', async () => {
    await teachEarned(app, token, 'SPRING', SPRING_HEADS, 20, SYNTHETIC_PART_NAME);
    const brain = await call(app, 'GET', '/api/vision/brain?domain=SPRING', undefined, auth(token));
    assert.strictEqual(brain.body.data.examples.length, 0);
    assert.deepStrictEqual(brain.body.data.counts, {});
    assert.strictEqual(brain.body.data.countSynthetic, false);
    const status = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const cat = status.body.data.heads.find((h: any) => h.head === 'CATEGORY');
    assert.strictEqual(cat.measured.taught, 0);
    assert.strictEqual(cat.measured.verdict, 'INSUFFICIENT');
  });

  it('TC-ACS-31: with VISION_COUNT_SYNTHETIC on, a drive can prove the pipeline on drawn parts', async () => {
    config.visionCountSynthetic = true;
    await teachEarned(app, token, 'SPRING', SPRING_HEADS, 20, SYNTHETIC_PART_NAME);
    const brain = await call(app, 'GET', '/api/vision/brain?domain=SPRING', undefined, auth(token));
    assert.strictEqual(brain.body.data.examples.length, 160);
    assert.strictEqual(brain.body.data.countSynthetic, true);
    const status = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const cat = status.body.data.heads.find((h: any) => h.head === 'CATEGORY');
    assert.strictEqual(cat.measured.verdict, 'ASSIST');
  });

  it('TC-ACS-32: real teachings and drawn ones share a table and are told apart by the mark alone', async () => {
    await teachEarned(app, token, 'SPRING', ['CATEGORY'], 5, SYNTHETIC_PART_NAME);
    await teachEarned(app, token, 'SPRING', ['CATEGORY'], 3);
    const brain = await call(app, 'GET', '/api/vision/brain?domain=SPRING', undefined, auth(token));
    assert.strictEqual(brain.body.data.examples.length, 9);
    assert.ok(brain.body.data.examples.every((e: any) => e.partName !== SYNTHETIC_PART_NAME));
  });
});

describe('The leave-one-out score hides what would answer for itself', () => {
  let app: ExpressApp;
  let token: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
  });

  const teach = (label: string, cls: number, seed: number, captureGroup: string | null) =>
    call(app, 'POST', '/api/vision/brain/teach', {
      domain: 'SPRING', head: 'CATEGORY', label, embedding: b64(compose([cls], seed)), captureGroup
    }, auth(token));

  it('TC-ACS-40: a sitting is hidden whole — the same frame taught thrice does not vouch for itself', async () => {
    // 30 distinct OUTER sittings and 30 INNER, so the head is scoreable —
    // then one OUTER sitting taught three times over from one frame.
    for (let i = 0; i < 30; i++) { await teach('OUTER', 0, i, `o${i}`); await teach('INNER', 1, i, `i${i}`); }
    for (let k = 0; k < 3; k++) await teach('OUTER', 0, 999, 'same_sitting');
    const status = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const cat = status.body.data.heads.find((h: any) => h.head === 'CATEGORY').measured;
    assert.strictEqual(cat.taught, 63);
    // Grouped, so no twin had to be caught by distance.
    assert.strictEqual(cat.twinsHeldOut, 0);
    assert.strictEqual(cat.verdict, 'ASSIST');
  });

  it('TC-ACS-41: an ungrouped twin is hidden by distance, and the count says so', async () => {
    for (let i = 0; i < 30; i++) { await teach('OUTER', 0, i, null); await teach('INNER', 1, i, null); }
    for (let k = 0; k < 3; k++) await teach('OUTER', 0, 999, null);
    const status = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const cat = status.body.data.heads.find((h: any) => h.head === 'CATEGORY').measured;
    // Three identical frames: each of the three hides the other two.
    assert.strictEqual(cat.twinsHeldOut, 6);
  });

  it('TC-ACS-42: the server refuses a capture group that is not an id', async () => {
    const r = await call(app, 'POST', '/api/vision/brain/teach', {
      domain: 'SPRING', head: 'CATEGORY', label: 'OUTER', embedding: b64(compose([0], 1)),
      captureGroup: 'a note, not a key'
    }, auth(token));
    assert.strictEqual(r.status, 201);
    const row = getDatabase().prepare('SELECT capture_group FROM vision_examples').get() as any;
    assert.strictEqual(row.capture_group, null);
  });
});


describe('The camera cannot be better than the people who labelled its examples', () => {
  let app: ExpressApp;
  let token: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
    config.visionAutoCommit = true;
    config.visionCountSynthetic = false;
  });
  afterEach(() => { config.visionAutoCommit = true; config.visionCountSynthetic = false; });

  async function earnedHeadsOnly() {
    await teachEarned(app, token, 'SPRING', SPRING_HEADS, 20);
    for (const head of ['CATEGORY', 'SURFACE', 'DAMAGE']) propose('SPRING', head, false, 40);
  }

  it('TC-ACS-50: with no blind reads, SURFACE and DAMAGE are FLAG_ONLY however their own score reads; CATEGORY is not', async () => {
    await earnedHeadsOnly();
    const status = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    const by = Object.fromEntries(status.body.data.heads.map((h: any) => [h.head, h]));
    assert.strictEqual(by.CATEGORY.measured.verdict, 'ASSIST');
    assert.strictEqual(by.CATEGORY.measured.ceiling, null);
    for (const h of ['SURFACE', 'DAMAGE']) {
      assert.strictEqual(by[h].measured.accuracy >= 0.95, true, `${h} scores 95% on its own examples`);
      assert.strictEqual(by[h].measured.verdict, 'FLAG_ONLY', `${h} is ceilinged`);
      assert.match(by[h].measured.ceiling, /only 0 of 30 blind reads/);
      assert.strictEqual(by[h].allowed, false);
    }
    // And on the write path, the reason names the blind read, not the head's score.
    const r = await call(app, 'POST', '/api/sorting/record', spring({ measurementSource: 'CAMERA_AUTO', autoEvidence: springEvidence(cleanOuterFrame()) }), auth(token));
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.body.data.decision.stoppedBy, 'NOT_EARNED');
    assert.match(r.body.message, /blind reads/);
  });

  it('TC-ACS-51: thirty blind reads at 95% lift the ceiling; at 90% they do not, and the reason says how often people agree', async () => {
    await earnedHeadsOnly();
    blindReads(30, 27); // 90%
    let status = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    let dmg = status.body.data.heads.find((h: any) => h.head === 'DAMAGE');
    assert.strictEqual(dmg.measured.verdict, 'FLAG_ONLY');
    assert.match(dmg.measured.ceiling, /only 90% of the time \(30 blind reads\)/);

    const app2 = createApp(':memory:');
    const t2 = await signIn(app2, 'inspector1');
    await teachEarned(app2, t2, 'SPRING', SPRING_HEADS, 20);
    for (const head of ['CATEGORY', 'SURFACE', 'DAMAGE']) propose('SPRING', head, false, 40);
    blindReads(30, 29); // 96.7%
    status = await call(app2, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(t2));
    dmg = status.body.data.heads.find((h: any) => h.head === 'DAMAGE');
    assert.strictEqual(dmg.measured.verdict, 'ASSIST');
    assert.strictEqual(dmg.measured.ceiling, null);
    const r = await call(app2, 'POST', '/api/sorting/record', spring({ measurementSource: 'CAMERA_AUTO', autoEvidence: springEvidence(cleanOuterFrame()) }), auth(t2));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  });

  it('TC-ACS-52: a drive with drawn springs is not ceilinged — there are no photographs for anyone to read', async () => {
    config.visionCountSynthetic = true;
    await teachEarned(app, token, 'SPRING', SPRING_HEADS, 20, SYNTHETIC_PART_NAME);
    for (const head of ['CATEGORY', 'SURFACE', 'DAMAGE']) propose('SPRING', head, false, 40);
    const status = await call(app, 'GET', '/api/vision/auto/status?domain=SPRING', undefined, auth(token));
    assert.strictEqual(status.body.data.heads.find((h: any) => h.head === 'DAMAGE').measured.verdict, 'ASSIST');
  });
});
