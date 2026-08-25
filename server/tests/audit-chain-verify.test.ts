/**
 * Audit Chain Verification Tests
 * Indian Railways WRS Raipur
 *
 * The system tells the DRM that nothing can be altered after the fact. Until
 * now the chain was written but never read back, so that claim rested on code
 * nobody had exercised.
 *
 * These tests corrupt a real chain in the specific ways a real tamperer would
 * — edit a value, change who did it, delete an entry, splice one in, cut the
 * beginning off — and require the verifier to notice each one and say where.
 *
 * Note the tampering here is done with the append-only triggers dropped,
 * which is exactly the threat the chain exists for: someone who bypassed the
 * application and reached the database file directly.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { logAuditEvent, verifyAuditChain, computeAuditHash, GENESIS_HASH } from '../src/db/auditLog.ts';

/** Drops the append-only guards, simulating an attacker who reached the file. */
function unlockAuditTable(db: DatabaseSync) {
  db.exec('DROP TRIGGER IF EXISTS trg_prevent_audit_log_update;');
  db.exec('DROP TRIGGER IF EXISTS trg_prevent_audit_log_delete;');
}

describe('Audit Chain Verification', () => {
  let db: DatabaseSync;

  const writeEvents = (n: number) => {
    for (let i = 1; i <= n; i++) {
      logAuditEvent(db, {
        eventType: 'INSPECTION_CREATED',
        userId: 'usr_insp_001',
        userRole: 'INSPECTOR',
        payload: { spring: i }
      });
    }
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
  });

  // -------------------------------------------------------------------------
  // The healthy case
  // -------------------------------------------------------------------------
  it('TC-AUD-01: an untouched chain verifies', () => {
    writeEvents(25);

    const r = verifyAuditChain(db);
    assert.strictEqual(r.verified, true);
    assert.strictEqual(r.entriesChecked, 25);
    assert.strictEqual(r.breaksFound, 0);
    assert.strictEqual(r.firstBrokenAt, null);
  });

  it('TC-AUD-02: an empty log verifies rather than erroring', () => {
    // A brand-new deployment has nothing logged yet. That is not a fault, and
    // must not present as one on the dashboard.
    const r = verifyAuditChain(db);
    assert.strictEqual(r.verified, true);
    assert.strictEqual(r.entriesChecked, 0);
  });

  it('TC-AUD-03: the first entry is anchored to the genesis seed', () => {
    writeEvents(1);
    const row = db.prepare('SELECT previous_hash FROM inspection_audit_log').get() as any;
    assert.strictEqual(row.previous_hash, GENESIS_HASH);
  });

  // -------------------------------------------------------------------------
  // Content tampering
  // -------------------------------------------------------------------------
  it('TC-AUD-04: editing a recorded payload is detected and located', () => {
    writeEvents(10);
    unlockAuditTable(db);

    const target = db.prepare('SELECT id FROM inspection_audit_log ORDER BY rowid LIMIT 1 OFFSET 4').get() as any;
    db.prepare('UPDATE inspection_audit_log SET payload_json = ? WHERE id = ?')
      .run('{"spring":999}', target.id);

    const r = verifyAuditChain(db);
    assert.strictEqual(r.verified, false);
    assert.strictEqual(r.firstBrokenAt!.id, target.id, 'must name the altered entry');
    assert.strictEqual(r.firstBrokenAt!.reason, 'CONTENT_ALTERED');
  });

  it('TC-AUD-05: changing who performed an action is detected', () => {
    // The hole this closes. user_role was not part of the hash, so an
    // inspector's action could be re-attributed to an admin — rewriting the
    // answer to the one question an audit log exists to answer — without
    // disturbing a single hash.
    writeEvents(6);
    unlockAuditTable(db);

    const target = db.prepare('SELECT id FROM inspection_audit_log ORDER BY rowid LIMIT 1 OFFSET 2').get() as any;
    db.prepare("UPDATE inspection_audit_log SET user_role = 'ADMIN' WHERE id = ?").run(target.id);

    const r = verifyAuditChain(db);
    assert.strictEqual(r.verified, false, 'a re-attributed action must not verify');
    assert.strictEqual(r.firstBrokenAt!.id, target.id);
    assert.strictEqual(r.firstBrokenAt!.reason, 'CONTENT_ALTERED');
  });

  it('TC-AUD-06: changing the recorded actor is detected', () => {
    writeEvents(4);
    unlockAuditTable(db);
    const target = db.prepare('SELECT id FROM inspection_audit_log ORDER BY rowid LIMIT 1').get() as any;
    db.prepare("UPDATE inspection_audit_log SET user_id = 'usr_adm_001' WHERE id = ?").run(target.id);

    assert.strictEqual(verifyAuditChain(db).verified, false);
  });

  it('TC-AUD-07: back-dating an entry is detected', () => {
    writeEvents(4);
    unlockAuditTable(db);
    const target = db.prepare('SELECT id FROM inspection_audit_log ORDER BY rowid LIMIT 1 OFFSET 1').get() as any;
    db.prepare("UPDATE inspection_audit_log SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
      .run(target.id);

    const r = verifyAuditChain(db);
    assert.strictEqual(r.verified, false);
    assert.strictEqual(r.firstBrokenAt!.reason, 'CONTENT_ALTERED');
  });

  // -------------------------------------------------------------------------
  // Sequence tampering
  // -------------------------------------------------------------------------
  it('TC-AUD-08: deleting an entry breaks the link, not the contents', () => {
    // The distinction matters to whoever investigates: nothing was edited,
    // an entry was removed. Reporting that as "contents altered" would send
    // them looking for the wrong thing.
    writeEvents(10);
    unlockAuditTable(db);

    const victim = db.prepare('SELECT id FROM inspection_audit_log ORDER BY rowid LIMIT 1 OFFSET 5').get() as any;
    db.prepare('DELETE FROM inspection_audit_log WHERE id = ?').run(victim.id);

    const r = verifyAuditChain(db);
    assert.strictEqual(r.verified, false);
    assert.strictEqual(r.firstBrokenAt!.reason, 'BROKEN_LINK');
    assert.strictEqual(r.entriesChecked, 9);
  });

  it('TC-AUD-09: one deletion reports one break, not a cascade', () => {
    // Judging each row against its own stored previous_hash keeps a single
    // removal from painting every later entry as altered and burying it.
    writeEvents(20);
    unlockAuditTable(db);
    const victim = db.prepare('SELECT id FROM inspection_audit_log ORDER BY rowid LIMIT 1 OFFSET 3').get() as any;
    db.prepare('DELETE FROM inspection_audit_log WHERE id = ?').run(victim.id);

    const r = verifyAuditChain(db);
    assert.strictEqual(r.breaksFound, 1, 'a single deletion is a single break');
  });

  it('TC-AUD-10: truncating the start of the log is detected', () => {
    // Removing the beginning is how someone hides that anything preceded them.
    writeEvents(8);
    unlockAuditTable(db);
    const first = db.prepare('SELECT id FROM inspection_audit_log ORDER BY rowid LIMIT 1').get() as any;
    db.prepare('DELETE FROM inspection_audit_log WHERE id = ?').run(first.id);

    const r = verifyAuditChain(db);
    assert.strictEqual(r.verified, false);
    assert.strictEqual(r.firstBrokenAt!.reason, 'GENESIS_MISMATCH');
  });

  it('TC-AUD-11: a forged entry spliced in is detected', () => {
    // The hardest case: an attacker who knows the formula can make a row that
    // hashes correctly on its own. It still cannot be made to follow the row
    // before it without recomputing every hash after it too.
    writeEvents(5);
    unlockAuditTable(db);

    const forgedId = 'audit_forged_1';
    const createdAt = new Date().toISOString();
    const payload = '{"forged":true}';
    const forgedHash = computeAuditHash({
      previousHash: 'GENESIS_BLOCK',
      id: forgedId,
      inspectionId: null,
      eventType: 'GATE_SIGNOFF_COMPLETED',
      userId: 'usr_insp_001',
      userRole: 'ADMIN',
      ipAddress: null,
      payloadJson: payload,
      createdAt
    });

    db.prepare(`
      INSERT INTO inspection_audit_log
        (id, inspection_id, event_type, user_id, user_role, ip_address, payload_json, previous_hash, hash, created_at)
      VALUES (?, NULL, 'GATE_SIGNOFF_COMPLETED', 'usr_insp_001', 'ADMIN', NULL, ?, 'GENESIS_BLOCK', ?, ?)
    `).run(forgedId, payload, forgedHash, createdAt);

    const r = verifyAuditChain(db);
    assert.strictEqual(r.verified, false, 'an internally-consistent forgery must still fail the chain');
    assert.strictEqual(r.firstBrokenAt!.id, forgedId);
    assert.strictEqual(r.firstBrokenAt!.reason, 'BROKEN_LINK');
  });

  it('TC-AUD-12: an unchained row is reported rather than skipped', () => {
    // Rows written straight to the table, bypassing the audit writer, carry no
    // hash. Treating them as fine would let the simplest bypass go unnoticed.
    writeEvents(3);
    db.prepare(`
      INSERT INTO inspection_audit_log
        (id, inspection_id, event_type, user_id, user_role, payload_json, previous_hash, hash)
      VALUES ('audit_raw_1', NULL, 'SECURITY_ALERT', 'usr_insp_001', 'INSPECTOR', '{}', NULL, NULL)
    `).run();

    const r = verifyAuditChain(db);
    assert.strictEqual(r.verified, false);
    assert.strictEqual(r.firstBrokenAt!.reason, 'UNCHAINED');
  });

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------
  it('TC-AUD-13: verification does not modify the log', () => {
    writeEvents(12);
    const before = db.prepare('SELECT id, hash FROM inspection_audit_log ORDER BY rowid').all();
    verifyAuditChain(db);
    verifyAuditChain(db);
    const after = db.prepare('SELECT id, hash FROM inspection_audit_log ORDER BY rowid').all();
    assert.deepStrictEqual(after, before, 'reading the chain must never write to it');
  });

  it('TC-AUD-14: every hashed field is actually covered', () => {
    // Guards against a field being dropped from the formula later — the exact
    // regression that left user_role unprotected.
    writeEvents(1);
    unlockAuditTable(db);
    const columns = ['inspection_id', 'event_type', 'user_id', 'user_role', 'ip_address', 'payload_json', 'created_at'];

    for (const col of columns) {
      const fresh = new DatabaseSync(':memory:');
      runMigrations(fresh);
      seedUsers(fresh);
      logAuditEvent(fresh, {
        eventType: 'INSPECTION_CREATED',
        userId: 'usr_insp_001',
        userRole: 'INSPECTOR',
        inspectionId: 'insp_1',
        ipAddress: '10.0.0.1',
        payload: { a: 1 }
      });
      fresh.exec('DROP TRIGGER IF EXISTS trg_prevent_audit_log_update;');

      // Each column gets a value the schema still accepts, so what is being
      // proven is that the hash covers it — not that a constraint blocks it.
      const TAMPER: Record<string, string> = {
        inspection_id: 'insp_other',
        event_type: 'SECURITY_ALERT',
        user_id: 'usr_adm_001',
        user_role: 'ADMIN',
        ip_address: '10.9.9.9',
        payload_json: '{"a":2}',
        created_at: '2019-01-01T00:00:00.000Z'
      };
      fresh.prepare(`UPDATE inspection_audit_log SET ${col} = ?`).run(TAMPER[col]);

      assert.strictEqual(
        verifyAuditChain(fresh).verified,
        false,
        `${col} is not covered by the hash — it can be altered undetected`
      );
    }
  });
});

describe('Audit Coverage — what actually reaches the chain', () => {
  // The system's claim to the DRM is that everything is logged. Auditing which
  // event types were ever written found two holes at the centre of it: an
  // inspector's verdict on a component was recorded nowhere, and the release
  // sign-off produced only a stage transition — a side effect of the release
  // rather than a record of it. The log could not answer "who released this
  // wagon, under which certificate, accepting what".
  it('TC-AUD-15: a full wagon lifecycle is auditable end to end', async () => {
    const { createApp } = await import('../src/app.ts');
    const { generateToken } = await import('../src/auth/jwt.ts');
    const { getDatabase } = await import('../src/db/connection.ts');
    const { verifyAuditChain } = await import('../src/db/auditLog.ts');

    const app = createApp(':memory:');
    const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
    const ins = generateToken({ id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR', name: 'R' } as any);
    const sup = generateToken({ id: 'usr_sup_001', username: 'supervisor1', role: 'SUPERVISOR', name: 'S' } as any);
    const W = 'SECR/AUDCOV/1';

    await app.dispatch({ method: 'POST', url: '/api/wagons/register', headers: H(ins), body: { wagonNumber: W, wagonType: 'BOXNHL', owningRailway: 'SECR' } });
    for (const st of ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'])
      await app.dispatch({ method: 'POST', url: `/api/wagons/${W}/transition`, headers: H(ins), body: { targetStage: st } });

    const chk: any = await app.dispatch({ method: 'GET', url: `/api/wagons/${W}/checklist`, headers: H(ins) });
    for (const it of chk.body.data.allItems)
      await app.dispatch({ method: 'PUT', url: `/api/wagons/${W}/checklist/items/${it.id}`, headers: H(ins), body: { status: 'PASS', reinspectedStatus: 'PASS' } });

    await app.dispatch({ method: 'POST', url: '/api/inspections', headers: H(ins), body: { wagonNumber: W, bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 258 } });

    await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${W}/swt`,
      headers: H(ins),
      body: { wagonType: 'BOXN', pipeType: 'SINGLE', loadCondition: 'EMPTY', readings: [
          { ref: '1', value: 5.0 }, { ref: '2', value: 5.0 }, { ref: '3', value: 0.05 },
          { ref: '4.1', value: 24 }, { ref: '4.2', value: 3.8 }, { ref: '4.3', value: 1.45 },
          { ref: '5.1', value: 52 }, { ref: '6', value: 4 }, { ref: '7', observed: true },
          { ref: '8.1', value: 25 }, { ref: '8.2', value: 3.8 }, { ref: '9', value: 85 },
          { ref: '10', value: 0.05 }, { ref: '12', observed: true }
        ] }
    });

    const sign: any = await app.dispatch({ method: 'POST', url: `/api/wagons/${W}/gate/signoff`, headers: H(sup), body: { otpToken: 'test_token_override' } });
    assert.strictEqual(sign.status, 200);

    const db = getDatabase();
    const types = new Set(
      (db.prepare('SELECT DISTINCT event_type t FROM inspection_audit_log').all() as any[]).map((r) => r.t)
    );

    for (const required of [
      'WAGON_REGISTERED',
      'WAGON_STAGE_TRANSITION',
      'CHECKLIST_ITEM_INSPECTED',
      'INSPECTION_CREATED',
      'GATE_SIGNOFF_COMPLETED'
    ]) {
      assert.ok(types.has(required), `${required} never reaches the audit log`);
    }

    // Each component's verdict, not one row for the batch.
    const itemEvents = db
      .prepare("SELECT COUNT(*) c FROM inspection_audit_log WHERE event_type='CHECKLIST_ITEM_INSPECTED'")
      .get() as any;
    assert.strictEqual(
      itemEvents.c,
      chk.body.data.allItems.length,
      'every checklist verdict must be individually recorded'
    );

    // The release must be answerable from the log alone.
    const signoffRow = db
      .prepare("SELECT payload_json, user_id FROM inspection_audit_log WHERE event_type='GATE_SIGNOFF_COMPLETED'")
      .get() as any;
    const payload = JSON.parse(signoffRow.payload_json);
    assert.strictEqual(signoffRow.user_id, 'usr_sup_001', 'who signed');
    assert.ok(payload.certificateNumber, 'under which certificate');
    assert.ok('acknowledgedAdvisoryIds' in payload, 'accepting what');

    // And all of it still chains.
    assert.strictEqual(verifyAuditChain(db).verified, true, 'the enlarged log must still verify');
  });
});
