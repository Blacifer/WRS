/**
 * Sending a batch twice records it once — and a queued move fits the wagon
 * Indian Railways WRS Raipur
 *
 * The case that made these necessary is a tablet losing the wifi between the
 * server committing a batch and the 200 arriving. The queue keeps everything
 * and resends, which is right. What was wrong was what a resend did: moved
 * the wagon a second time, recorded the spoken verdict again with a second
 * audit entry, and stored the photograph twice. Spring readings were already
 * safe (sync_id UNIQUE); these three were not.
 *
 * And a queued stage move was written as sent, never checked against where
 * the wagon actually is now. Two tablets that both queued INSPECTION -> REPAIR
 * both inserted; a move queued from a stage the wagon had since left was
 * applied anyway. The live route runs the lifecycle engine; this one now does
 * too, and refuses an override outright because there is no live second
 * factor to check.
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
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const count = (sql: string, ...args: any[]) => (getDatabase().prepare(sql).get(...args) as any).n as number;
/** Registration writes its own ENTRY_REGISTRATION row; only moves are counted here. */
const moves = (wagon: string) => count("SELECT COUNT(*) n FROM wagon_transitions WHERE wagon_number = ? AND from_stage <> to_stage", wagon);

describe('A resent batch records nothing twice', () => {
  let app: ExpressApp;
  let token: string;
  let wagon: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
    wagon = `SECR/BOXNHL/${70000 + Math.floor(Math.random() * 9000)}`;
    const reg = await call(app, 'POST', '/api/wagons/register', { wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR' }, auth(token));
    assert.strictEqual(reg.status, 201, JSON.stringify(reg.body));
  });

  it('TC-SYI-01: a transition sent twice moves the wagon once, and the second is counted as a duplicate', async () => {
    const batch = { transitions: [{ clientTempId: 'trn-1', wagonNumber: wagon, fromStage: 'ENTRY_REGISTRATION', toStage: 'DISMANTLING' }] };
    const first = await call(app, 'POST', '/api/sync/batch', batch, auth(token));
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    assert.strictEqual(first.body.syncedTransitions, 1);
    // The 200 never arrived; the queue sends the same batch again.
    const second = await call(app, 'POST', '/api/sync/batch', batch, auth(token));
    assert.strictEqual(second.status, 200, JSON.stringify(second.body));
    assert.strictEqual(second.body.syncedTransitions, 0);
    assert.strictEqual(second.body.duplicateCount, 1);
    assert.strictEqual(second.body.conflictCount, 0, 'a resend is a duplicate, not a conflict');
    assert.strictEqual(moves(wagon), 1);
    assert.strictEqual(count("SELECT COUNT(*) n FROM inspection_audit_log WHERE event_type = 'WAGON_STAGE_TRANSITION' AND json_extract(payload_json, '$.toStage') = 'DISMANTLING'"), 1);
  });

  it('TC-SYI-02: a photograph sent twice is stored once', async () => {
    const batch = { photos: [{ clientTempId: 'pht-1', wagonNumber: wagon, partCategory: 'WHEELS_AXLES', partName: 'Wheel', imageBase64: 'data:image/jpeg;base64,AAAA' }] };
    await call(app, 'POST', '/api/sync/batch', batch, auth(token));
    const second = await call(app, 'POST', '/api/sync/batch', batch, auth(token));
    assert.strictEqual(second.body.syncedPhotos, 0);
    assert.strictEqual(second.body.duplicateCount, 1);
    assert.strictEqual(count('SELECT COUNT(*) n FROM wagon_photos WHERE wagon_number = ?', wagon), 1);
  });

  it('TC-SYI-03: a photograph is stored under the device\'s id, so even a lost receipt cannot store it twice', async () => {
    const batch = { photos: [{ clientTempId: 'pht-2', wagonNumber: wagon, partCategory: 'WHEELS_AXLES', partName: 'Wheel', imageBase64: 'data:image/jpeg;base64,AAAA' }] };
    await call(app, 'POST', '/api/sync/batch', batch, auth(token));
    const row = getDatabase().prepare('SELECT id FROM wagon_photos WHERE wagon_number = ?').get(wagon) as any;
    assert.strictEqual(row.id, 'pht-2');
  });

  it('TC-SYI-04: a spoken verdict sent twice is applied once, with one audit entry', async () => {
    const list = await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}/checklist`, undefined, auth(token));
    const item = list.body.data.allItems.find((i: any) => i.category !== 'SPRINGS');
    const batch = { voiceActions: [{ clientTempId: 'voi-1', wagonNumber: wagon, itemId: item.id, status: 'PASS', transcript: 'brake block passes', language: 'en-IN', confidence: 0.9 }] };
    const first = await call(app, 'POST', '/api/sync/batch', batch, auth(token));
    assert.strictEqual(first.body.syncedVoiceActions, 1, JSON.stringify(first.body));
    const audits = count("SELECT COUNT(*) n FROM inspection_audit_log WHERE event_type LIKE '%VOICE%'");
    const second = await call(app, 'POST', '/api/sync/batch', batch, auth(token));
    assert.strictEqual(second.body.syncedVoiceActions, 0);
    assert.strictEqual(second.body.duplicateCount, 1);
    assert.strictEqual(count("SELECT COUNT(*) n FROM inspection_audit_log WHERE event_type LIKE '%VOICE%'"), audits);
  });

  it('TC-SYI-05: a queued item with no device id is refused, not guessed at', async () => {
    const r = await call(app, 'POST', '/api/sync/batch', { transitions: [{ wagonNumber: wagon, fromStage: 'ENTRY_REGISTRATION', toStage: 'DISMANTLING' }] }, auth(token));
    assert.strictEqual(r.body.failedCount, 1);
    assert.match(r.body.errors[0].error, /clientTempId/);
    assert.strictEqual(moves(wagon), 0);
  });

  it('TC-SYI-06: a receipt cannot be deleted or rewritten', async () => {
    await call(app, 'POST', '/api/sync/batch', { transitions: [{ clientTempId: 'trn-9', wagonNumber: wagon, fromStage: 'ENTRY_REGISTRATION', toStage: 'DISMANTLING' }] }, auth(token));
    assert.throws(() => getDatabase().prepare('DELETE FROM sync_receipts').run(), /cannot be deleted/);
    assert.throws(() => getDatabase().prepare("UPDATE sync_receipts SET server_id = 'x'").run(), /cannot be rewritten/);
  });
});

describe('A queued stage move must fit the wagon as it is now', () => {
  let app: ExpressApp;
  let token: string;
  let wagon: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
    wagon = `SECR/BOXNHL/${70000 + Math.floor(Math.random() * 9000)}`;
    await call(app, 'POST', '/api/wagons/register', { wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR' }, auth(token));
  });

  it('TC-SYI-10: two tablets that both queued the same move — the second is a conflict naming the stage the wagon is at', async () => {
    const a = await call(app, 'POST', '/api/sync/batch', { transitions: [{ clientTempId: 'trn-a', wagonNumber: wagon, fromStage: 'ENTRY_REGISTRATION', toStage: 'DISMANTLING' }] }, auth(token));
    assert.strictEqual(a.body.syncedTransitions, 1);
    const b = await call(app, 'POST', '/api/sync/batch', { transitions: [{ clientTempId: 'trn-b', wagonNumber: wagon, fromStage: 'ENTRY_REGISTRATION', toStage: 'DISMANTLING' }] }, auth(token));
    assert.strictEqual(b.body.syncedTransitions, 0);
    assert.strictEqual(b.body.conflictCount, 1);
    assert.match(b.body.conflicts[0].reason, /now at DISMANTLING, not ENTRY_REGISTRATION/);
    assert.strictEqual(b.body.conflicts[0].clientTempId, 'trn-b');
    assert.strictEqual(moves(wagon), 1);
    const w = getDatabase().prepare('SELECT current_stage s FROM wagons WHERE wagon_number = ?').get(wagon) as any;
    assert.strictEqual(w.s, 'DISMANTLING');
  });

  it('TC-SYI-11: a move the lifecycle engine would refuse live is refused queued, with its reason', async () => {
    // Skipping straight to the exit gate is not a NORMAL move.
    const r = await call(app, 'POST', '/api/sync/batch', { transitions: [{ clientTempId: 'trn-skip', wagonNumber: wagon, fromStage: 'ENTRY_REGISTRATION', toStage: 'FINAL_QC_GATE' }] }, auth(token));
    assert.strictEqual(r.body.syncedTransitions, 0);
    assert.strictEqual(r.body.conflictCount, 1);
    assert.strictEqual(moves(wagon), 0);
  });

  it('TC-SYI-12: an override cannot be queued offline — there is no live second factor to check', async () => {
    const sup = await signIn(app, 'supervisor1');
    const r = await call(app, 'POST', '/api/sync/batch', { transitions: [{ clientTempId: 'trn-ovr', wagonNumber: wagon, fromStage: 'ENTRY_REGISTRATION', toStage: 'FINAL_QC_GATE', isOverride: true, overrideJustification: 'urgent' }] }, auth(sup));
    assert.strictEqual(r.body.syncedTransitions, 0);
    assert.strictEqual(r.body.conflictCount, 1);
    assert.match(r.body.conflicts[0].reason, /cannot be queued offline/);
    assert.strictEqual(moves(wagon), 0);
  });

  it('TC-SYI-13: the performer and role come from the token, whatever the body says', async () => {
    const r = await call(app, 'POST', '/api/sync/batch', { transitions: [{ clientTempId: 'trn-t', wagonNumber: wagon, fromStage: 'ENTRY_REGISTRATION', toStage: 'DISMANTLING', performedBy: 'usr_sup_001', performerRole: 'SUPERVISOR' }] }, auth(token));
    assert.strictEqual(r.body.syncedTransitions, 1, JSON.stringify(r.body));
    const t = getDatabase().prepare("SELECT performed_by p, performer_role r, is_override o FROM wagon_transitions WHERE wagon_number = ? AND to_stage = 'DISMANTLING'").get(wagon) as any;
    assert.strictEqual(t.r, 'INSPECTOR');
    assert.strictEqual(t.o, 0);
    assert.notStrictEqual(t.p, 'usr_sup_001');
  });
});
