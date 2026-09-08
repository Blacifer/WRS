/**
 * A conflict names the person who actually judged it
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * When an inspector's offline work is refused, the message tells them who
 * looked at the part since. It read `existing.inspectorName` — which on a
 * checklist row is whoever the row was CREATED for, and
 * initializeDefaultChecklist creates every template line under the literal
 * name "Intake Inspector".
 *
 * So every conflict message in the system named a person who does not exist.
 * An inspector told their condemnation was overruled would have gone looking
 * for them. The verdict's author is manual_verdict_by, and that is what the
 * message must resolve.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

const WAGON = 'SECR/BOXNHL/55502';

describe('Offline sync conflicts', () => {
  let app: ExpressApp;
  let a: string, b: string, part: any;

  beforeEach(async () => {
    app = createApp(':memory:');
    a = await signIn(app, 'inspector1');
    b = await signIn(app, 'inspector2');
    await call(app, 'POST', '/api/wagons/register', { wagonNumber: WAGON, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { authorization: `Bearer ${a}` });
    part = new WagonRepository(getDatabase()).getChecklistItems(WAGON).allItems[0];
  });

  it('TC-SCA-01: a stale PASS never overwrites a condemnation', async () => {
    await call(app, 'PUT', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items/${part.id}`,
      { status: 'CONDEMNED', conditionNotes: 'visible crack' }, { authorization: `Bearer ${a}` });

    const res = await call(app, 'POST', '/api/sync/batch', {
      checklistItems: [{ clientTempId: 'tmp_1', wagonNumber: WAGON, category: part.category, partName: part.partName, bogiePosition: part.bogiePosition, status: 'PASS', createdAt: new Date(Date.now() - 3600_000).toISOString() }]
    }, { authorization: `Bearer ${b}` });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.conflictCount, 1);
    const after = new WagonRepository(getDatabase()).getChecklistItems(WAGON).allItems.find((i: any) => i.id === part.id);
    assert.strictEqual(after.status, 'CONDEMNED', 'the finding must survive');
    assert.strictEqual(after.conditionNotes, 'visible crack');
  });

  it('TC-SCA-02: the message names the inspector who condemned it, not the row’s creator', async () => {
    await call(app, 'PUT', `/api/wagons/${encodeURIComponent(WAGON)}/checklist/items/${part.id}`,
      { status: 'CONDEMNED', conditionNotes: 'visible crack' }, { authorization: `Bearer ${a}` });

    const res = await call(app, 'POST', '/api/sync/batch', {
      checklistItems: [{ clientTempId: 'tmp_2', wagonNumber: WAGON, category: part.category, partName: part.partName, bogiePosition: part.bogiePosition, status: 'PASS', createdAt: new Date(Date.now() - 3600_000).toISOString() }]
    }, { authorization: `Bearer ${b}` });

    const reason = res.body.conflicts[0].reason as string;
    const real = getDatabase().prepare("SELECT full_name AS n FROM users WHERE id = 'usr_insp_001'").get() as { n: string };

    assert.doesNotMatch(reason, /Intake Inspector/, 'that name belongs to nobody');
    assert.ok(reason.includes(real.n), `the message should name ${real.n}, got: ${reason}`);
  });

  it('TC-SCA-03: an unjudged row falls back to an indefinite phrase, never a wrong name', async () => {
    /*
     * A row nobody has judged has no verdict author. Naming its creator would
     * be naming the registrar for work they did not do, so the message says
     * "someone else" instead.
     */
    const db = getDatabase();
    // Move the row's clock forward without giving it a verdict author.
    db.prepare("UPDATE checklist_items SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), part.id);

    const res = await call(app, 'POST', '/api/sync/batch', {
      checklistItems: [{ clientTempId: 'tmp_3', wagonNumber: WAGON, category: part.category, partName: part.partName, bogiePosition: part.bogiePosition, status: 'PASS', createdAt: new Date(Date.now() - 7200_000).toISOString() }]
    }, { authorization: `Bearer ${b}` });

    if (res.body.conflictCount > 0) {
      const reason = res.body.conflicts[0].reason as string;
      assert.doesNotMatch(reason, /Intake Inspector/);
      assert.match(reason, /someone else|another inspector/);
    }
  });
});
