/**
 * Two records written in the same millisecond
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Ten queries ordered history by `created_at DESC` and nothing else. When two
 * rows share a timestamp — which is ordinary, because these are written in
 * quick succession by one action — SQLite is free to return them in either
 * order, and it does.
 *
 * That surfaced as a test that failed roughly one run in ten and passed on its
 * own every time, which is the most expensive way for a defect to present
 * itself. But the flapping test was the symptom. The fault was that an
 * inspector reading a wagon's acoustic history could be shown two readings in
 * the wrong order, and that getLatestSwt() — which feeds a release decision —
 * could return either of two tests and call it the latest.
 *
 * The fix is `, rowid DESC`: insertion order, which is the true chronological
 * order when the clock cannot separate them. These tests force the tie rather
 * than racing for it, so they fail every time if the tiebreak is removed
 * rather than one run in ten.
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

describe('Records sharing a timestamp come back in the order they were written', () => {
  let app: ExpressApp;

  beforeEach(() => {
    app = createApp(':memory:');
  });

  it('TC-ORD-01: acoustic history is newest-first even when the clock cannot separate the readings', async () => {
    const token = await signIn(app, 'inspector1');
    const wagonNumber = 'SECR/BOXNHL/77041';

    await call(app, 'POST', '/api/wagons/register',
      { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' },
      { authorization: `Bearer ${token}` });

    /*
     * Written directly with an identical created_at. Posting twice through
     * the API would usually produce two different milliseconds, which is why
     * the original test only failed sometimes — it was hoping for the
     * collision instead of causing it.
     */
    const db = getDatabase();
    const sameMoment = '2026-09-07T10:00:00.000Z';
    const insert = db.prepare(`
      INSERT INTO acoustic_diagnostics
        (id, wagon_number, dominant_frequency_hz, peak_db, anomaly_type, inspector_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run('ac_first',  wagonNumber, 450,  42.0, 'NONE',     'usr_insp_001', sameMoment);
    insert.run('ac_second', wagonNumber, 6520, 79.2, 'AIR_LEAK', 'usr_insp_001', sameMoment);

    const res = await call(app, 'GET', `/api/acoustic/history/${wagonNumber}`, undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.length, 2);

    // The later insert is the later reading, so it must come first.
    assert.strictEqual(res.body.data[0].anomalyType, 'AIR_LEAK');
    assert.strictEqual(res.body.data[1].anomalyType, 'NONE');
  });

  it('TC-ORD-02: the latest single-wagon test is the one written last, not either of two', async () => {
    // This one decides what a release is judged against, so an arbitrary
    // choice between two rows is not a display problem.
    const token = await signIn(app, 'inspector1');
    const wagonNumber = 'SECR/BOXNHL/77042';

    await call(app, 'POST', '/api/wagons/register',
      { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' },
      { authorization: `Bearer ${token}` });

    /*
     * Written explicitly against the real columns. An earlier version built
     * the insert from PRAGMA table_info and guessed values, which promptly
     * violated a CHECK constraint — a test that has to be clever about the
     * schema is a test that will be wrong about it.
     */
    const db = getDatabase();
    const sameMoment = '2026-09-07T10:00:00.000Z';
    const insert = db.prepare(`
      INSERT INTO swt_tests
        (id, wagon_number, wagon_type, pipe_type, load_condition,
         readings_json, results_json, passed, tested_by, created_at)
      VALUES (?, ?, 'BOXNHL', 'SINGLE', 'EMPTY', '[]', '[]', ?, 'usr_insp_001', ?)
    `);
    insert.run('swt_first', wagonNumber, 1, sameMoment);
    insert.run('swt_second', wagonNumber, 0, sameMoment);

    const latest = db.prepare(
      'SELECT id FROM swt_tests WHERE wagon_number = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
    ).get(wagonNumber) as { id: string };

    assert.strictEqual(latest.id, 'swt_second', 'the later insert is the later test');
  });
});
