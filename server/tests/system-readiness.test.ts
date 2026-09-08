/**
 * Is this installation ready to be used
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * The value of this panel is entirely in whether a tick can be trusted, so
 * what is worth guarding is not that it returns rows. It is that a row cannot
 * go green for the wrong reason: that "no account is on the demonstration
 * password" is a real hash comparison rather than a look at a flag, and that
 * "Zapheit answers" is a real call rather than the presence of a key.
 *
 * A readiness panel that reports configuration back to itself is at its most
 * confident on the installation that most needs telling.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}

async function signIn(app: ExpressApp, username: string, password = 'password123'): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

const findCheck = (body: any, id: string) =>
  (body.data.checks || []).find((c: any) => c.id === id);

describe('Deployment readiness', () => {
  let app: ExpressApp;

  beforeEach(() => {
    app = createApp(':memory:');
  });

  it('TC-RDY-01: an administrator gets every check, each with a state and a reason', async () => {
    const token = await signIn(app, 'admin1');
    const res = await call(app, 'GET', '/api/system/readiness', undefined, { authorization: `Bearer ${token}` });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const checks = res.data?.checks || res.body.data.checks;
    assert.ok(Array.isArray(checks) && checks.length >= 8, 'expected the full set of checks');

    for (const c of checks) {
      assert.ok(['PASS', 'WARN', 'FAIL'].includes(c.state), `${c.id} has state ${c.state}`);
      // A row with no reason is a row nobody can act on.
      assert.ok(c.detail && c.detail.length > 20, `${c.id} must say why`);
    }
  });

  it('TC-RDY-02: the demonstration-password check actually hashes, and finds the seeded accounts', async () => {
    // The seed creates accounts on password123. If this check consulted a flag
    // rather than the stored hash it would report nothing here.
    const token = await signIn(app, 'admin1');
    const res = await call(app, 'GET', '/api/system/readiness', undefined, { authorization: `Bearer ${token}` });

    const demo = findCheck(res.body, 'demo-passwords');
    assert.ok(demo, 'the demo-password check must be present');
    assert.notStrictEqual(demo.state, 'PASS', 'seeded accounts are on the demo password, so this cannot be green');
    assert.match(demo.detail, /inspector1/, 'it should name the accounts it found');
  });

  it('TC-RDY-03: changing a password is reflected — the check reads the database, not a constant', async () => {
    const insp = await signIn(app, 'inspector1');
    await call(
      app, 'POST', '/api/auth/password',
      { currentPassword: 'password123', newPassword: 'a-real-one-now-9' },
      { authorization: `Bearer ${insp}` }
    );

    const token = await signIn(app, 'admin1');
    const res = await call(app, 'GET', '/api/system/readiness', undefined, { authorization: `Bearer ${token}` });
    const demo = findCheck(res.body, 'demo-passwords');

    assert.doesNotMatch(demo.detail, /inspector1(,|\b)/, 'inspector1 no longer uses the demo password');
  });

  it('TC-RDY-04: Zapheit is never reported as a failure, configured or not', async () => {
    /*
     * The invariant, not the state.
     *
     * This first asserted WARN outright, and went red the moment a real key
     * was put in the environment — the test was reading the developer's own
     * .env and calling a working integration a failure. What actually matters
     * holds either way: absence is the ordinary case on a shop LAN, every
     * feature falls back, and a red row would push somebody to "fix" a system
     * that is working.
     */
    const token = await signIn(app, 'admin1');
    const res = await call(app, 'GET', '/api/system/readiness', undefined, { authorization: `Bearer ${token}` });

    const z = findCheck(res.body, 'zapheit');
    assert.notStrictEqual(z.state, 'FAIL', 'Zapheit must never be a hard failure — everything falls back without it');

    if (z.state === 'WARN') {
      // Either no key, or a key that did not answer. Both must say what the
      // reader can do, and both must say that nothing is broken meanwhile.
      assert.match(z.detail, /work(s)? without it|fall(s)? back|falls back|ZAPHEIT_API_KEY|did not answer/i);
    } else {
      // Green only ever means it actually answered from this machine.
      assert.match(z.detail, /answered/i);
    }
  });

  it('TC-RDY-05: the audit row reflects a real chain walk', async () => {
    const token = await signIn(app, 'admin1');
    const res = await call(app, 'GET', '/api/system/readiness', undefined, { authorization: `Bearer ${token}` });

    const chain = findCheck(res.body, 'audit-chain');
    // A fresh in-memory database has an intact chain, and the row must say so
    // with the number of entries it actually walked.
    assert.strictEqual(chain.state, 'PASS');
    assert.match(chain.detail, /\d+ entries/);
  });

  it('TC-RDY-05b: the manual row names each document, and what is not indexed', async () => {
    /*
     * A total on its own cannot tell a healthy index from one missing a
     * document, and the index now holds more than one. A deployment with the
     * manual but without the audit check-sheet reported thousands of passages
     * and looked entirely well.
     */
    const { createManualTables, indexManualText } = await import('../src/manual/manualIndex.ts');
    const db = getDatabase();
    createManualTables(db);
    // A clause marker is what buildPassages splits on; text without one yields
    // no passages at all, which is not what this test is about.
    indexManualText(db, 'CHAPTER-6 BOGIE\n308 E. Outer spring nominal 260 mm, condemning 245 mm.\n', 'manual.pdf', 'WMM');

    const token = await signIn(app, 'admin1');
    let res = await call(app, 'GET', '/api/system/readiness', undefined, { authorization: `Bearer ${token}` });
    let manual = findCheck(res.body, 'manual');

    assert.strictEqual(manual.state, 'WARN', 'a document that is not indexed must be said');
    assert.match(manual.detail, /check-sheet/i, 'and named');
    assert.match(manual.detail, /index-manual/, 'with the command that fixes it');

    indexManualText(
      db,
      'SN Requirements Clause Observation\nG Side bearer Nom Cond\n' +
        'Side bearer springs are condemned on the basis of height.\n',
      'audit.pdf',
      'ROH_AUDIT'
    );
    res = await call(app, 'GET', '/api/system/readiness', undefined, { authorization: `Bearer ${token}` });
    manual = findCheck(res.body, 'manual');

    assert.strictEqual(manual.state, 'PASS');
    assert.match(manual.detail, /WMM/);
    assert.match(manual.detail, /ROH_AUDIT/);
  });

  it('TC-RDY-06: a supervisor cannot read the installation’s state', async () => {
    const token = await signIn(app, 'supervisor1');
    const res = await call(app, 'GET', '/api/system/readiness', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 403);
  });

  it('TC-RDY-07: the DRM cannot either — this is the machine, not the workshop', async () => {
    const token = await signIn(app, 'drm1');
    const res = await call(app, 'GET', '/api/system/readiness', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 403);
  });

  it('TC-RDY-08: ready is true only when nothing warned and nothing failed', async () => {
    const token = await signIn(app, 'admin1');
    const res = await call(app, 'GET', '/api/system/readiness', undefined, { authorization: `Bearer ${token}` });
    const d = res.body.data;

    assert.strictEqual(d.ready, d.failed === 0 && d.warned === 0);
    assert.strictEqual(d.passed + d.warned + d.failed, d.checks.length);
  });
});
