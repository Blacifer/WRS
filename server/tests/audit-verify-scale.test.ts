/**
 * Verifying the chain without freezing the shop
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * verifyAuditChain re-derives every hash in the log, and it was running on
 * every dashboard load. Measured on a year of data at Raipur's volume:
 * 250,000 entries took 1.3s, 500,000 took 4.2s, 750,000 took 8.0s — growing
 * faster than the log because every payload was held in memory at once. The
 * shop PC is three to five times slower and Node serves one request at a
 * time, so in year three an officer opening a dashboard would have stopped
 * the shop floor for half a minute.
 *
 * The fix is a tail walk for screens that ask in passing. The danger in that
 * fix is the reason for these tests: a tail pass can say "verified" about a
 * log that is broken further back. It must never be renderable as "the chain
 * is intact", so the scope travels with the answer.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { logAuditEvent, verifyAuditChain, verifyAuditChainTail } from '../src/db/auditLog.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

describe('Verifying the audit chain at scale', () => {
  let app: ExpressApp;

  beforeEach(() => {
    app = createApp(':memory:');
    const db = getDatabase();
    for (let i = 0; i < 60; i++) {
      logAuditEvent(db, { eventType: 'CHECKLIST_ITEM_INSPECTED', userId: 'usr_insp_001', userRole: 'INSPECTOR', payload: { i } });
    }
  });

  it('TC-AVS-01: a full walk covers the whole log and says so', () => {
    const r = verifyAuditChain(getDatabase());
    assert.strictEqual(r.scope, 'FULL');
    assert.strictEqual(r.entriesChecked, r.totalEntries);
    assert.strictEqual(r.verified, true);
  });

  it('TC-AVS-02: a tail walk checks only the window, and reports the total honestly', () => {
    const r = verifyAuditChainTail(getDatabase(), 10);
    assert.strictEqual(r.scope, 'TAIL');
    assert.strictEqual(r.entriesChecked, 10);
    assert.ok(r.totalEntries > 10, 'the log is larger than the window');
    assert.strictEqual(r.verified, true, 'a healthy tail verifies');
  });

  it('TC-AVS-03: the tail does not start from genesis — a healthy chain raises no false alarm', () => {
    // Starting a window at the genesis hash would report a break on the first
    // entry of every window, on a perfectly good log.
    for (const n of [1, 5, 25, 59]) {
      const r = verifyAuditChainTail(getDatabase(), n);
      assert.strictEqual(r.verified, true, `a window of ${n} must verify on a healthy chain`);
      assert.strictEqual(r.breaksFound, 0);
    }
  });

  it('TC-AVS-04: a window larger than the log is a full walk, not a lie about scope', () => {
    const r = verifyAuditChainTail(getDatabase(), 100000);
    assert.strictEqual(r.scope, 'FULL', 'if everything was walked, say FULL');
    assert.strictEqual(r.entriesChecked, r.totalEntries);
  });

  it('TC-AVS-05: a break behind the window is invisible to the tail — which is why scope travels', () => {
    /*
     * The case that makes honest labelling non-negotiable. An early entry is
     * tampered with; the tail still verifies. A screen that printed that as
     * "the record is intact" would be concealing a real break.
     */
    const db = getDatabase();

    /*
     * The table forbids UPDATE and DELETE by trigger, so a break is created
     * the way a real one appears: an entry whose previous_hash points at
     * nothing. Sixty good entries are then appended, which chain correctly
     * from it — so the break sits genuinely BEHIND a small tail window rather
     * than merely being older by timestamp. The walk orders by rowid, not by
     * created_at, and a first attempt at this test got that wrong.
     */
    db.prepare(`INSERT INTO inspection_audit_log (id, event_type, user_id, user_role, payload_json, previous_hash, hash, created_at)
                VALUES ('aud_broken', 'SECURITY_ALERT', 'usr_insp_001', 'INSPECTOR', '{}', 'NOT_A_REAL_HASH', 'deadbeef', ?)`)
      .run(new Date().toISOString());
    for (let i = 0; i < 60; i++) {
      logAuditEvent(db, { eventType: 'CHECKLIST_ITEM_INSPECTED', userId: 'usr_insp_001', userRole: 'INSPECTOR', payload: { after: i } });
    }

    const full = verifyAuditChain(db);
    assert.strictEqual(full.verified, false, 'the full walk sees the break');

    const tail = verifyAuditChainTail(db, 5);
    assert.strictEqual(tail.scope, 'TAIL');
    assert.strictEqual(tail.verified, true, 'the tail does not see it — by design, which is why scope travels');
  });

  it('TC-AVS-06: the tail endpoint never claims more than it walked', async () => {
    const token = await signIn(app, 'supervisor1');
    // The window is floored at 50: a handful of entries is not worth a round
    // trip, and a caller asking for 1 would get an answer that means nothing.
    const res = await call(app, 'GET', '/api/audit/verify/tail?entries=10', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.scope, 'TAIL');
    assert.strictEqual(res.body.data.entriesChecked, 50, 'the floor is applied, not the request');
    assert.match(res.body.data.summary, /most recent 50 of \d+/);
    assert.doesNotMatch(res.body.data.summary, /chain verified/i, 'a tail must not be worded as a full verification');
  });
});
