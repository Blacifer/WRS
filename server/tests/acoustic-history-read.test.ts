/**
 * What the acoustic history says when somebody finally reads it
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Readings were recorded from the day the tool shipped and displayed nowhere.
 * Now that a screen shows them, two properties it relies on are worth pinning:
 * that the newest reading is first even when two share a timestamp, and that a
 * reading carries the name of whoever took it rather than an opaque id.
 *
 * The second is not cosmetic. The question asked a week later is "who heard
 * that", and `usr_insp_001` does not answer it.
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

const WAGON = 'SECR/BOXNHL/77050';

describe('Reading a wagon’s acoustic history', () => {
  let app: ExpressApp;
  let token: string;

  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
    await call(app, 'POST', '/api/wagons/register',
      { wagonNumber: WAGON, wagonType: 'BOXNHL', owningRailway: 'SECR' },
      { authorization: `Bearer ${token}` });
  });

  it('TC-AH-01: a reading names the inspector who took it', async () => {
    await call(app, 'POST', '/api/acoustic/diagnose',
      { wagonNumber: WAGON, dominantFrequencyHz: 6520, peakDb: 79.2, anomalyType: 'AIR_LEAK' },
      { authorization: `Bearer ${token}` });

    const res = await call(app, 'GET', `/api/acoustic/history/${encodeURIComponent(WAGON)}`, undefined,
      { authorization: `Bearer ${token}` });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.length, 1);
    assert.ok(res.body.data[0].inspectorName, 'the reading must carry a readable name');
    assert.notStrictEqual(
      res.body.data[0].inspectorName, res.body.data[0].inspectorId,
      'the name must be resolved, not the id echoed back'
    );
  });

  it('TC-AH-02: two readings in the same millisecond come back newest first', async () => {
    /*
     * Written directly with an identical created_at. Two readings taken
     * seconds apart are the ordinary case on a bench, and a list that shows
     * the older one first tells an inspector the opposite of what happened.
     */
    const db = getDatabase();
    const sameMoment = '2026-09-08T06:00:00.000Z';
    const insert = db.prepare(`
      INSERT INTO acoustic_diagnostics
        (id, wagon_number, dominant_frequency_hz, peak_db, anomaly_type, inspector_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'usr_insp_001', ?)
    `);
    insert.run('ah_first', WAGON, 6520, 79.2, 'AIR_LEAK', sameMoment);
    insert.run('ah_second', WAGON, 450, 42.0, 'NONE', sameMoment);

    const res = await call(app, 'GET', `/api/acoustic/history/${encodeURIComponent(WAGON)}`, undefined,
      { authorization: `Bearer ${token}` });

    assert.strictEqual(res.body.data[0].id, 'ah_second', 'the later insert is the later reading');
    assert.strictEqual(res.body.data[1].id, 'ah_first');
  });

  it('TC-AH-03: a wagon with no readings returns an empty list, not an error', async () => {
    // The screen distinguishes "none recorded" from "could not load", and it
    // can only do that if this stays a 200 with an empty array.
    const res = await call(app, 'GET', '/api/acoustic/history/SECR%2FBOXNHL%2F99999', undefined,
      { authorization: `Bearer ${token}` });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.data, []);
  });

  it('TC-AH-04: a reading with no inspector still comes back, unnamed', async () => {
    // inspector_id is nullable, so the join must not drop the row. A reading
    // that vanishes because nobody signed it is worse than one shown unsigned.
    const db = getDatabase();
    db.prepare(`
      INSERT INTO acoustic_diagnostics
        (id, wagon_number, dominant_frequency_hz, peak_db, anomaly_type, inspector_id, created_at)
      VALUES ('ah_orphan', ?, 900, 55, 'NONE', NULL, '2026-09-08T07:00:00.000Z')
    `).run(WAGON);

    const res = await call(app, 'GET', `/api/acoustic/history/${encodeURIComponent(WAGON)}`, undefined,
      { authorization: `Bearer ${token}` });

    const orphan = res.body.data.find((r: any) => r.id === 'ah_orphan');
    assert.ok(orphan, 'a reading with no inspector must still be listed');
    assert.strictEqual(orphan.inspectorName, null);
  });
});
