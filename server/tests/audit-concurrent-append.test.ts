/**
 * Two writers must not fork the chain
 * Indian Railways WRS Raipur
 *
 * FOUND BY RUNNING THE RESTORE DRILL, NOT BY A TEST
 * -------------------------------------------------
 * The pilot database's audit chain reported BROKEN. The restored copy
 * reported the same break at the same row, so the backup was faithful and the
 * damage was already in the live file.
 *
 * Rows 152 and 153 carried the same previous_hash and the same millisecond
 * timestamp. Two writers had each read the same "last hash" and each appended
 * their own entry. The chain forked. Nothing had been tampered with — two
 * people signed in at the same moment, which in a workshop with several
 * tablets is an ordinary Tuesday.
 *
 * The consequence was worse than a wrong figure. The chain is this system's
 * central claim: that the record cannot be altered without detection. A chain
 * that reports tampering because two logins coincided cries wolf, and after
 * the first false break a real one is indistinguishable from the noise.
 *
 * Two fixes, both pinned here. The append takes a write lock before it reads,
 * so the fork cannot happen. And the verifier now separates a fork — parent
 * present, both children present, nothing missing — from an entry that is
 * genuinely gone, because calling them by the same name was a false
 * accusation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { logAuditEvent, verifyAuditChain, computeAuditHash } from '../src/db/auditLog.ts';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  seedUsers(db);
  return db;
}

const append = (db: DatabaseSync, i: number) =>
  logAuditEvent(db, {
    eventType: 'AUTH_LOGIN',
    userId: 'usr_insp_001',
    userRole: 'INSPECTOR',
    payload: { i }
  });

describe('Audit chain — appending under concurrency', () => {
  test('TC-ACC-01: no two entries ever share a parent', () => {
    /*
     * The invariant the fork violated. In a linear chain each entry's hash is
     * the parent of at most one entry, so a duplicated previous_hash IS the
     * fork, expressed as a query.
     */
    const db = freshDb();
    for (let i = 0; i < 200; i++) append(db, i);

    const dupes = db.prepare(`
      SELECT previous_hash, COUNT(*) AS c
      FROM inspection_audit_log
      GROUP BY previous_hash
      HAVING c > 1
    `).all();

    assert.equal(dupes.length, 0, 'a shared parent means the chain forked');
    assert.equal(verifyAuditChain(db).verified, true);
  });

  test('TC-ACC-02: the writer leaves no transaction open behind it', () => {
    // A transaction left open would wedge every later write on this
    // connection behind a lock nobody holds a reason for.
    const db = freshDb();
    append(db, 1);
    assert.equal(db.isTransaction, false);
  });

  test('TC-ACC-03: it still works inside a caller\'s own transaction', () => {
    /*
     * Sign-off and stage transitions write several rows together. Starting a
     * second transaction inside theirs would throw, so the writer has to
     * notice it is already inside one — and it must not commit the caller's
     * transaction out from under them either.
     */
    const db = freshDb();
    db.exec('BEGIN IMMEDIATE');
    append(db, 1);
    assert.equal(db.isTransaction, true, 'the caller\'s transaction must survive');
    db.exec('COMMIT');

    assert.equal(verifyAuditChain(db).verified, true);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS c FROM inspection_audit_log').get() as any).c > 0,
      true
    );
  });

  test('TC-ACC-04: a fork is reported as a fork, not as a removal', () => {
    /*
     * Reconstructed the way it actually happened: a second entry appended
     * against a parent that already has a child, its own hash correctly
     * computed — because a race produces well-formed entries, not corrupt
     * ones. That is exactly what made it look like tampering.
     *
     * The verifier must say both are present and nothing is missing. "An
     * entry was removed" about a database where nothing was removed sends an
     * auditor hunting a crime that did not occur.
     */
    const db = freshDb();
    append(db, 1);
    append(db, 2);

    const first = db.prepare(`
      SELECT id, inspection_id, event_type, user_id, user_role, ip_address,
             payload_json, hash, created_at
      FROM inspection_audit_log ORDER BY rowid ASC LIMIT 1
    `).get() as any;

    const forkId = 'audit_fork_test';
    const forkHash = computeAuditHash({
      previousHash: first.hash,          // the same parent the second row claims
      id: forkId,
      inspectionId: first.inspection_id ?? null,
      eventType: first.event_type,
      userId: first.user_id,
      userRole: first.user_role,
      ipAddress: first.ip_address ?? null,
      payloadJson: first.payload_json,
      createdAt: first.created_at
    });

    db.prepare(`
      INSERT INTO inspection_audit_log
        (id, inspection_id, event_type, user_id, user_role, ip_address, payload_json, previous_hash, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      forkId, first.inspection_id, first.event_type, first.user_id, first.user_role,
      first.ip_address, first.payload_json, first.hash, forkHash, first.created_at
    );

    const result = verifyAuditChain(db);

    assert.equal(result.verified, false, 'a fork is still a break — somebody must look');
    assert.equal(result.firstBrokenAt?.reason, 'CONCURRENT_APPEND');
    assert.match(result.firstBrokenAt?.detail || '', /forked/);
    assert.match(result.firstBrokenAt?.detail || '', /nothing has been removed/);
  });

  test('TC-ACC-05: a genuinely missing entry is still called a removal', () => {
    /*
     * The distinction must not become an excuse for the real thing.
     *
     * An entry pointing at a parent that is nowhere in the log means the
     * parent is gone. Written this way rather than by deleting a row, because
     * the append-only trigger refuses a delete — correctly, and it refused
     * this test's first attempt — so the state is reached the way it would
     * actually be found: an entry whose parent cannot be produced.
     */
    const db = freshDb();
    for (let i = 0; i < 3; i++) append(db, i);

    const last = db.prepare(`
      SELECT inspection_id, event_type, user_id, user_role, ip_address,
             payload_json, created_at
      FROM inspection_audit_log ORDER BY rowid DESC LIMIT 1
    `).get() as any;

    // Its own contents hash correctly; only its parent is missing. Otherwise
    // the content check fires first and the link is never examined.
    const MISSING_PARENT = 'ff'.repeat(32);
    const orphanHash = computeAuditHash({
      previousHash: MISSING_PARENT,
      id: 'audit_orphan_test',
      inspectionId: last.inspection_id ?? null,
      eventType: last.event_type,
      userId: last.user_id,
      userRole: last.user_role,
      ipAddress: last.ip_address ?? null,
      payloadJson: last.payload_json,
      createdAt: last.created_at
    });

    db.prepare(`
      INSERT INTO inspection_audit_log
        (id, inspection_id, event_type, user_id, user_role, ip_address, payload_json, previous_hash, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'audit_orphan_test', last.inspection_id, last.event_type, last.user_id,
      last.user_role, last.ip_address, last.payload_json,
      MISSING_PARENT, orphanHash, last.created_at
    );

    const result = verifyAuditChain(db);
    assert.equal(result.verified, false);

    const json = JSON.stringify(result);
    assert.match(json, /removed|BROKEN_LINK/, 'a missing parent must not be softened into a fork');
    assert.ok(
      !/forked/.test(result.firstBrokenAt?.detail || ''),
      'an orphan is not a fork, and must not be described as one'
    );
  });
});
