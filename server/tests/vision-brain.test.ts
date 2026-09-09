/**
 * The camera's memory, over real HTTP
 * Indian Railways WRS Raipur
 *
 * What the camera learns has to outlive the browser, the bench and the
 * machine, and it has to be evidence rather than notes. These pin the four
 * properties that make that true: a malformed embedding is refused rather
 * than quietly stored, what was taught cannot afterwards be rewritten or
 * deleted, a correction is derived from the difference between what the camera
 * offered and what the person chose rather than taken on the client's word,
 * and a teaching where the camera stayed silent is not counted as agreement.
 *
 * The last one matters most. Without it a camera that never answers would
 * report perfect accuracy, which is the most flattering possible lie this
 * system could tell about itself.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { EMBEDDING_B64_LEN } from '../src/db/visionBrainRepository.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(
  app: ExpressApp,
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
) {
  return app.dispatch({ method, url: path, body, headers });
}

async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/** A well-formed embedding: 1280 float32 values, base64 of the raw bytes. */
function embedding(seed = 1): string {
  const v = new Float32Array(1280);
  let s = seed;
  for (let i = 0; i < 1280; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    v[i] = s / 2147483648 - 0.5;
  }
  return Buffer.from(v.buffer).toString('base64');
}

const teach = (label: string, extra: Record<string, unknown> = {}) => ({
  domain: 'SPRING',
  head: 'CATEGORY',
  label,
  embedding: embedding(label.length + Object.keys(extra).length),
  ...extra
});

describe('What the camera has been taught', () => {
  let app: ExpressApp;

  beforeEach(() => {
    app = createApp(':memory:');
  });

  it('TC-VBR-01: a fresh installation knows nothing, and says so rather than erroring', async () => {
    const token = await signIn(app, 'inspector1');
    const res = await call(app, 'GET', '/api/vision/brain?domain=SPRING', undefined, auth(token));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.data.examples, []);
    assert.deepStrictEqual(res.body.data.counts, {});
  });

  it('TC-VBR-02: a teaching comes back on the next load, so it survives the browser', async () => {
    const token = await signIn(app, 'inspector1');
    const t = await call(app, 'POST', '/api/vision/brain/teach', teach('OUTER'), auth(token));
    assert.strictEqual(t.status, 201, JSON.stringify(t.body));

    const res = await call(app, 'GET', '/api/vision/brain?domain=SPRING', undefined, auth(token));
    assert.strictEqual(res.body.data.examples.length, 1);
    assert.strictEqual(res.body.data.examples[0].label, 'OUTER');
    assert.strictEqual(res.body.data.examples[0].embedding.length, EMBEDDING_B64_LEN);
    assert.deepStrictEqual(res.body.data.counts, { CATEGORY: { OUTER: 1 } });
  });

  it('TC-VBR-03: a wrong-length embedding is refused, not silently stored', async () => {
    // The fault this exists to stop would never throw. It would sit in the
    // list comparing against nothing and make the camera quietly worse.
    const token = await signIn(app, 'inspector1');
    const short = Buffer.from(new Float32Array(64).buffer).toString('base64');
    const res = await call(
      app,
      'POST',
      '/api/vision/brain/teach',
      { domain: 'SPRING', head: 'CATEGORY', label: 'OUTER', embedding: short },
      auth(token)
    );
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /1280/);
  });

  it('TC-VBR-04: there is no BAND head, and asking for one is refused', async () => {
    // A band is 2-3mm on a component 245-290mm tall and a photograph carries
    // no scale. A technique that measures how alike two pictures look would be
    // confident and wrong, so the head does not exist at any layer.
    const token = await signIn(app, 'inspector1');
    const res = await call(
      app,
      'POST',
      '/api/vision/brain/teach',
      { domain: 'SPRING', head: 'BAND', label: 'BLUE', embedding: embedding(5) },
      auth(token)
    );
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /head must be one of/);
  });

  it('TC-VBR-05: labels are normalised, so the same answer is one class not three', async () => {
    const token = await signIn(app, 'inspector1');
    for (const raw of ['outer', ' Outer ', 'OUTER']) {
      const r = await call(
        app,
        'POST',
        '/api/vision/brain/teach',
        { domain: 'SPRING', head: 'CATEGORY', label: raw, embedding: embedding(raw.length) },
        auth(token)
      );
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      assert.strictEqual(r.body.data.label, 'OUTER');
    }
    const res = await call(app, 'GET', '/api/vision/brain?domain=SPRING', undefined, auth(token));
    assert.deepStrictEqual(res.body.data.counts, { CATEGORY: { OUTER: 3 } });
  });

  it('TC-VBR-06: a correction is derived from the difference, not taken on trust', async () => {
    const token = await signIn(app, 'inspector1');

    const agreed = await call(
      app,
      'POST',
      '/api/vision/brain/teach',
      teach('OUTER', { proposedLabel: 'OUTER' }),
      auth(token)
    );
    assert.strictEqual(agreed.body.data.wasCorrection, false);

    const corrected = await call(
      app,
      'POST',
      '/api/vision/brain/teach',
      teach('SNUBBER', { proposedLabel: 'INNER' }),
      auth(token)
    );
    assert.strictEqual(corrected.body.data.wasCorrection, true);
  });

  it('TC-VBR-07: a teaching the camera stayed silent on never counts as agreement', async () => {
    // The whole point. A camera that answers nothing must not score 100%.
    const token = await signIn(app, 'inspector1');
    const db = getDatabase();

    for (let i = 0; i < 5; i++) {
      await call(app, 'POST', '/api/vision/brain/teach', teach(`SILENT${i}`), auth(token));
    }
    const silentLedger = db
      .prepare("SELECT COUNT(*) c FROM machine_learning_events WHERE subsystem = 'SPRING_VISION'")
      .get() as { c: number };
    assert.strictEqual(silentLedger.c, 0, 'silence must not reach the accuracy ledger at all');

    await call(
      app,
      'POST',
      '/api/vision/brain/teach',
      teach('OUTER', { proposedLabel: 'INNER', confidence: 0.8 }),
      auth(token)
    );
    const withProposal = db
      .prepare("SELECT COUNT(*) c FROM machine_learning_events WHERE subsystem = 'SPRING_VISION'")
      .get() as { c: number };
    assert.strictEqual(withProposal.c, 1, 'an actual proposal must reach the ledger');
  });

  it('TC-VBR-08: what was taught cannot afterwards be rewritten or deleted', async () => {
    // These rows are the evidence for why the camera said what it said. An
    // inspector defending a condemnation can be shown the exact examples that
    // produced the answer, which is worth nothing if they can be revised.
    const token = await signIn(app, 'inspector1');
    const t = await call(app, 'POST', '/api/vision/brain/teach', teach('OUTER'), auth(token));
    const id = t.body.data.id;
    const db = getDatabase();

    assert.throws(
      () => db.prepare('UPDATE vision_examples SET label = ? WHERE id = ?').run('INNER', id),
      /cannot be rewritten/
    );
    assert.throws(
      () => db.prepare('DELETE FROM vision_examples WHERE id = ?').run(id),
      /cannot be deleted/
    );
  });

  it('TC-VBR-09: an administrator cannot teach it — that is bench work', async () => {
    // Admins deliberately hold no shop-floor capability. The people who know
    // what a snubber looks like are the people sorting springs.
    const token = await signIn(app, 'admin1');
    const res = await call(app, 'POST', '/api/vision/brain/teach', teach('OUTER'), auth(token));
    assert.strictEqual(res.status, 403);
  });

  it('TC-VBR-10: progress reports agreement, and refuses to call two points a trend', async () => {
    const token = await signIn(app, 'inspector1');
    for (let i = 0; i < 4; i++) {
      await call(
        app,
        'POST',
        '/api/vision/brain/teach',
        teach(`OUTER`, { proposedLabel: 'OUTER' }),
        auth(token)
      );
    }
    const drm = await signIn(app, 'admin1');
    const res = await call(app, 'GET', '/api/vision/brain/progress?domain=SPRING', undefined, auth(drm));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    // Everything lands in one week here, so there is no trend to report and
    // the summary must say that rather than inventing a direction.
    assert.match(res.body.data.summary, /Not enough weeks/i);
    assert.match(res.body.data.summary, /example count is not the answer/i);
  });

  it('TC-VBR-12: a thumbnail is stored and comes back, so an answer can be shown', async () => {
    /*
     * This is the test that would have caught a real bug. The column was added
     * and the bindings were updated, but the INSERT's column list was not — so
     * every teach returned 500 over real HTTP while eleven passing tests said
     * otherwise, because none of them sent a thumbnail. A field that is only
     * ever null is a field whose plumbing is never exercised.
     */
    const token = await signIn(app, 'inspector1');
    const thumb = 'data:image/jpeg;base64,' + 'A'.repeat(400);
    const t = await call(
      app,
      'POST',
      '/api/vision/brain/teach',
      teach('OUTER', { thumbnail: thumb }),
      auth(token)
    );
    assert.strictEqual(t.status, 201, JSON.stringify(t.body));

    const res = await call(app, 'GET', '/api/vision/brain?domain=SPRING', undefined, auth(token));
    assert.strictEqual(res.body.data.examples[0].thumbnail, thumb);
  });

  it('TC-VBR-13: a full-size photograph is refused as a thumbnail', async () => {
    // Without a cap, the storage argument that justifies keeping embeddings
    // rather than images would quietly stop being true.
    const token = await signIn(app, 'inspector1');
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(60000);
    const res = await call(
      app,
      'POST',
      '/api/vision/brain/teach',
      teach('OUTER', { thumbnail: huge }),
      auth(token)
    );
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /thumbnail/i);
  });

  it('TC-VBR-14: every column the insert names can actually be written at once', async () => {
    // The general form of TC-VBR-12: send every optional field together, so a
    // column list that has drifted from its bindings fails here rather than in
    // a shed.
    const token = await signIn(app, 'inspector1');
    const res = await call(
      app,
      'POST',
      '/api/vision/brain/teach',
      teach('OUTER', {
        thumbnail: 'data:image/png;base64,' + 'B'.repeat(200),
        sourceImageId: 'simg_test',
        partName: 'Outer Spring',
        bogiePosition: 'BOGIE_1',
        proposedLabel: 'INNER',
        confidence: 0.72
      }),
      auth(token)
    );
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.wasCorrection, true);

    const back = await call(app, 'GET', '/api/vision/brain?domain=SPRING', undefined, auth(token));
    const e = back.body.data.examples[0];
    assert.strictEqual(e.sourceImageId, 'simg_test');
    assert.strictEqual(e.partName, 'Outer Spring');
  });

  it('TC-VBR-11: teaching is refused without a token at all', async () => {
    const res = await call(app, 'POST', '/api/vision/brain/teach', teach('OUTER'));
    assert.strictEqual(res.status, 401);
  });
});
