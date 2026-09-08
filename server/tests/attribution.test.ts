/**
 * Whose name is on the record
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * An inspection record says a named person judged a spring fit to run. Two
 * ways existed for that name to be wrong, and neither would have looked wrong
 * to anybody reading the record afterwards.
 *
 *   The offline sync spread the client's own record straight into the
 *   database. Every other loop in that same function — wagons, checklist
 *   items, voice actions, transitions, photos — took the actor from the
 *   token; the inspections loop did not, so a queued record could name
 *   whoever the payload said.
 *
 *   A record arriving with no inspector at all fell back to 'usr_insp_001'
 *   and the name 'Ramesh Kumar', a real person seeded into this database.
 *
 * Both produce a record that reads exactly like honest work by a real
 * inspector, which is the worst possible failure for an audit trail.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { InspectionRepository } from '../src/db/repository.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}

async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

describe('Whose name ends up on an inspection', () => {
  let app: ExpressApp;

  beforeEach(() => {
    app = createApp(':memory:');
  });

  it('TC-ATTR-01: a synced inspection names the person who synced it, not the payload', async () => {
    const token = await signIn(app, 'inspector1');

    const res = await call(app, 'POST', '/api/sync/batch', {
      records: [{
        clientTempId: 'tmp_1',
        wagonNumber: 'SECR/BOXNHL/40101',
        bogieType: 'CASNUB_22_NLB',
        condition: 'NEW',
        springPosition: 'OUTER',
        measuredFreeHeight: 258,
        // The payload names somebody else entirely.
        inspectorId: 'usr_sup_001',
        inspectorName: 'Someone Else'
      }]
    }, { authorization: `Bearer ${token}` });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    const row = getDatabase()
      .prepare('SELECT inspector_id, inspector_name FROM inspections ORDER BY rowid DESC LIMIT 1')
      .get() as { inspector_id: string; inspector_name: string };

    assert.strictEqual(row.inspector_id, 'usr_insp_001', 'the token decides, not the body');
    assert.notStrictEqual(row.inspector_name, 'Someone Else');
  });

  it('TC-ATTR-02: a record with no inspector is not filed under a real inspector', async () => {
    /*
     * The fallback is deliberately the seeded system account, whose name reads
     * "System (automated actions)". It is visibly not an inspector, so a
     * record that reaches it announces itself rather than passing as work
     * somebody did.
     */
    const repo = new InspectionRepository(getDatabase());
    const rec = repo.insertInspection({
      wagonNumber: 'SECR/BOXNHL/40102',
      bogieType: 'CASNUB_22_NLB',
      condition: 'NEW',
      springPosition: 'OUTER',
      measuredFreeHeight: 258
    } as any);

    const real = getDatabase()
      .prepare("SELECT id, full_name FROM users WHERE role = 'INSPECTOR' AND is_active = 1")
      .all() as Array<{ id: string; full_name: string }>;

    assert.ok(
      !real.some((u) => u.id === rec.inspectorId),
      `an unattributed inspection must not carry a real inspector's id (got ${rec.inspectorId})`
    );
    assert.ok(
      !real.some((u) => u.full_name === rec.inspectorName),
      `nor a real inspector's name (got ${rec.inspectorName})`
    );
    assert.match(String(rec.inspectorName), /system/i, 'and it should say so plainly');
  });

  it('TC-ATTR-03: sync still refuses a batch with no signed-in person at all', async () => {
    // The check that makes the two above meaningful: if the actor could be
    // absent, taking it from the token would be taking it from nothing.
    const res = await call(app, 'POST', '/api/sync/batch', { records: [] }, {});
    assert.strictEqual(res.status, 401);
  });
});
