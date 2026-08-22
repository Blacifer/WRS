/**
 * SQLite Immutability Triggers & Append-Only Audit Logging Tests
 * Indian Railways WRS Raipur
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getDatabase } from '../src/db/connection.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { InspectionRepository } from '../src/db/repository.ts';
import { DatabaseSync } from 'node:sqlite';

describe('SQLite Immutability Triggers & Append-Only Storage', () => {
  let db: DatabaseSync;
  let repo: InspectionRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    repo = new InspectionRepository(db);
  });

  // Test Case 1: Insert creates record with audit hash and sequence
  it('TC-DB-01: Successfully appends inspection with sequence number and cryptographic audit hash', () => {
    const record = repo.insertInspection({
      inspectorId: 'usr_insp_001',
      inspectorName: 'Ramesh Kumar',
      wagonNumber: 'SE-BOXN-984210',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      tableReference: 'Table 28'
    });

    assert.ok(record.id);
    assert.strictEqual(record.sequenceNumber, 1);
    assert.strictEqual(record.wagonNumber, 'SE-BOXN-984210');
    assert.strictEqual(record.classifiedBand, 'BLUE');
    assert.strictEqual(record.status, 'PASS');
    assert.ok(record.auditHash, 'Audit hash must be computed');
  });

  // Test Case 2: Direct SQL UPDATE is blocked by trigger
  it('TC-DB-02: SQLite trigger strictly aborts direct UPDATE attempt on inspections table', () => {
    const record = repo.insertInspection({
      inspectorId: 'usr_insp_001',
      wagonNumber: 'SE-BOXN-112233',
      bogieType: 'CASNUB_22_HS',
      springPosition: 'INNER',
      condition: 'USED',
      measuredFreeHeight: 243.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      tableReference: 'Table 29'
    });

    assert.throws(
      () => {
        repo.attemptDirectUpdate(record.id, 250.0);
      },
      (err: Error) => {
        return err.message.includes('Audit log is strictly append-only') || err.message.includes('immutable');
      },
      'Direct SQL UPDATE must trigger an abort error'
    );
  });

  // Test Case 3: Direct SQL DELETE is blocked by trigger
  it('TC-DB-03: SQLite trigger strictly aborts direct DELETE attempt on inspections table', () => {
    const record = repo.insertInspection({
      inspectorId: 'usr_insp_001',
      wagonNumber: 'SE-BOXN-445566',
      bogieType: 'CASNUB_22_RFT',
      springPosition: 'SNUBBER',
      condition: 'NEW',
      measuredFreeHeight: 305.0,
      classifiedBand: 'GREEN',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      tableReference: 'Table 33'
    });

    assert.throws(
      () => {
        repo.attemptDirectDelete(record.id);
      },
      (err: Error) => {
        return err.message.includes('Audit log is strictly append-only') || err.message.includes('immutable');
      },
      'Direct SQL DELETE must trigger an abort error'
    );
  });

  // Test Case 4: Direct UPDATE on inspection_audit_log is blocked
  it('TC-DB-04: SQLite trigger strictly aborts direct UPDATE attempt on inspection_audit_log', () => {
    const record = repo.insertInspection({
      inspectorId: 'usr_insp_001',
      wagonNumber: 'W-AUDIT-1',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      tableReference: 'Table 28'
    });

    const auditRow = db.prepare('SELECT id FROM inspection_audit_log WHERE inspection_id = ?').get(record.id) as { id: string };
    assert.ok(auditRow, 'Automatic audit log entry must exist');

    assert.throws(
      () => {
        db.prepare("UPDATE inspection_audit_log SET user_role = 'TAMPERED' WHERE id = ?").run(auditRow.id);
      },
      (err: Error) => {
        return err.message.includes('Audit log is strictly append-only') || err.message.includes('immutable');
      }
    );
  });

  // Test Case 5: Direct DELETE on inspection_audit_log is blocked
  it('TC-DB-05: SQLite trigger strictly aborts direct DELETE attempt on inspection_audit_log', () => {
    const record = repo.insertInspection({
      inspectorId: 'usr_insp_001',
      wagonNumber: 'W-AUDIT-2',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      tableReference: 'Table 28'
    });

    const auditRow = db.prepare('SELECT id FROM inspection_audit_log WHERE inspection_id = ?').get(record.id) as { id: string };
    assert.ok(auditRow);

    assert.throws(
      () => {
        db.prepare('DELETE FROM inspection_audit_log WHERE id = ?').run(auditRow.id);
      },
      (err: Error) => {
        return err.message.includes('Audit log is strictly append-only') || err.message.includes('immutable');
      }
    );
  });

  // Test Case 6: Automatic audit log entry created on insert
  it('TC-DB-06: Automatically generates inspection_audit_log record on inspection insertion', () => {
    const record = repo.insertInspection({
      inspectorId: 'usr_insp_001',
      wagonNumber: 'W-TRIGGER-CHECK',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      tableReference: 'Table 28'
    });

    const auditLogs = db.prepare('SELECT * FROM inspection_audit_log WHERE inspection_id = ?').all(record.id) as any[];
    assert.strictEqual(auditLogs.length, 1);
    assert.strictEqual(auditLogs[0].event_type, 'INSPECTION_CREATED');
    assert.strictEqual(auditLogs[0].user_id, 'usr_insp_001');

    const payload = JSON.parse(auditLogs[0].payload_json);
    assert.strictEqual(payload.wagonNumber, 'W-TRIGGER-CHECK');
    assert.strictEqual(payload.classifiedBand, 'BLUE');
  });

  // Test Case 7: Monotonically increasing sequence numbering
  it('TC-DB-07: Consecutive inspections receive unique, strictly increasing sequence numbers', () => {
    const r1 = repo.insertInspection({
      inspectorId: 'usr_insp_001',
      wagonNumber: 'W-SEQ-1',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      tableReference: 'Table 28'
    });

    const r2 = repo.insertInspection({
      inspectorId: 'usr_insp_001',
      wagonNumber: 'W-SEQ-2',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 257.0,
      classifiedBand: 'GREEN',
      bandRoman: 'Band II',
      status: 'PASS',
      damageType: 'NONE',
      tableReference: 'Table 28'
    });

    assert.strictEqual(r2.sequenceNumber, (r1.sequenceNumber || 1) + 1);
  });
});
