/**
 * Tier 1 Test Suite — Feature R3: Inspection Logging & Immutable Audit Trail
 * Indian Railways WRS Raipur
 *
 * Verifies complete metadata logging, immutable SQLite trigger protection
 * (prevention of direct UPDATE and DELETE), API 405 enforcement,
 * and multi-criteria search/filtering.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AuditDatabase } from '../../harness/audit_db.ts';
import { TestApp } from '../../harness/test_app.ts';

describe('Tier 1 — R3: Inspection Logging & Audit Trail', () => {
  let db: AuditDatabase;
  let app: TestApp;
  let inspectorToken: string;

  beforeEach(async () => {
    db = new AuditDatabase(':memory:');
    app = new TestApp(':memory:');

    const loginRes = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (loginRes.body as { token: string }).token;
  });

  // Test Case 1: Inspection record creation with all required metadata
  it('TC-R3-01: Successfully logs inspection with complete metadata and returns created record with sequence ID', () => {
    const record = db.logInspection({
      inspectorId: 'insp-001',
      inspectorName: 'R. K. Sharma',
      wagonNumber: 'SE-BOXN-984210',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      damageNotes: 'Standard overhaul inspection',
      isOverridden: false,
      tableReference: 'Table 28'
    });

    assert.ok(record.id);
    assert.strictEqual(record.sequenceNumber, 1);
    assert.strictEqual(record.wagonNumber, 'SE-BOXN-984210');
    assert.strictEqual(record.inspectorId, 'insp-001');
    assert.strictEqual(record.measuredFreeHeight, 260.0);
    assert.strictEqual(record.classifiedBand, 'BLUE');
    assert.strictEqual(record.status, 'PASS');
    assert.ok(record.timestamp);
  });

  // Test Case 2: Immutability — Direct SQLite UPDATE is prevented by triggers
  it('TC-R3-02: SQLite trigger strictly aborts direct UPDATE attempt on inspection records', () => {
    const record = db.logInspection({
      inspectorId: 'insp-001',
      wagonNumber: 'SE-BOXN-112233',
      bogieType: 'CASNUB_22_HS',
      springPosition: 'INNER',
      condition: 'USED',
      measuredFreeHeight: 243.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 29'
    });

    assert.throws(
      () => {
        db.attemptDirectUpdate(record.id, 250.0);
      },
      (err: Error) => {
        return err.message.includes('Audit log is strictly append-only') && err.message.includes('UPDATE');
      },
      'Direct SQL UPDATE must trigger an abort error'
    );
  });

  // Test Case 3: Immutability — Direct SQLite DELETE is prevented by triggers
  it('TC-R3-03: SQLite trigger strictly aborts direct DELETE attempt on inspection records', () => {
    const record = db.logInspection({
      inspectorId: 'insp-001',
      wagonNumber: 'SE-BOXN-445566',
      bogieType: 'CASNUB_22_RFT',
      springPosition: 'SNUBBER',
      condition: 'NEW',
      measuredFreeHeight: 305.0,
      classifiedBand: 'GREEN',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 33'
    });

    assert.throws(
      () => {
        db.attemptDirectDelete(record.id);
      },
      (err: Error) => {
        return err.message.includes('Audit log is strictly append-only') && err.message.includes('DELETE');
      },
      'Direct SQL DELETE must trigger an abort error'
    );
  });

  // Test Case 4: Immutability — HTTP API returns 405 Method Not Allowed for PUT/DELETE/PATCH
  it('TC-R3-04: HTTP API rejects PUT, PATCH, and DELETE requests on /api/inspections with 405 Method Not Allowed', async () => {
    const resPut = await app.put('/api/inspections/some-uuid', { measuredFreeHeight: 260.0 });
    assert.strictEqual(resPut.status, 405);
    assert.ok((resPut.body as { error: string }).error.includes('immutable'));

    const resDelete = await app.delete('/api/inspections/some-uuid');
    assert.strictEqual(resDelete.status, 405);

    const resPatch = await app.patch('/api/inspections/some-uuid', { status: 'CONDEMNED' });
    assert.strictEqual(resPatch.status, 405);
  });

  // Test Case 5: Multi-Criteria Filter — Filter by Wagon Number
  it('TC-R3-05: Multi-criteria query filters accurately by wagon number substring', () => {
    db.logInspection({
      inspectorId: 'insp-1',
      wagonNumber: 'WAGON-ALPHA-101',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });
    db.logInspection({
      inspectorId: 'insp-1',
      wagonNumber: 'WAGON-BETA-202',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 257.0,
      classifiedBand: 'GREEN',
      bandRoman: 'Band II',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });

    const result = db.queryInspections({ wagonNumber: 'ALPHA' });
    assert.strictEqual(result.records.length, 1);
    assert.strictEqual(result.records[0].wagonNumber, 'WAGON-ALPHA-101');
  });

  // Test Case 6: Multi-Criteria Filter — Filter by Date Range
  it('TC-R3-06: Multi-criteria query filters accurately by date range (startDate & endDate)', () => {
    db.logInspection({
      inspectorId: 'insp-1',
      wagonNumber: 'WAGON-DATE-1',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28',
      timestamp: '2026-08-10T08:00:00.000Z'
    });
    db.logInspection({
      inspectorId: 'insp-1',
      wagonNumber: 'WAGON-DATE-2',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28',
      timestamp: '2026-08-14T08:00:00.000Z'
    });

    const result = db.queryInspections({
      startDate: '2026-08-13T00:00:00.000Z',
      endDate: '2026-08-15T00:00:00.000Z'
    });
    assert.strictEqual(result.records.length, 1);
    assert.strictEqual(result.records[0].wagonNumber, 'WAGON-DATE-2');
  });

  // Test Case 7: Multi-Criteria Filter — Filter by Inspector, Band, and Status
  it('TC-R3-07: Multi-criteria query filters accurately by Inspector ID, Band, and Status combination', () => {
    db.logInspection({
      inspectorId: 'insp-101',
      wagonNumber: 'W-1',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 261.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });
    db.logInspection({
      inspectorId: 'insp-101',
      wagonNumber: 'W-2',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 240.0,
      classifiedBand: null,
      bandRoman: null,
      status: 'CONDEMNED',
      damageType: 'CRACK',
      isOverridden: false,
      tableReference: 'Table 28'
    });
    db.logInspection({
      inspectorId: 'insp-102',
      wagonNumber: 'W-3',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 261.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });

    // Query for Inspector insp-101, Status PASS, Band BLUE
    const filtered = db.queryInspections({
      inspectorId: 'insp-101',
      status: 'PASS',
      band: 'BLUE'
    });
    assert.strictEqual(filtered.records.length, 1);
    assert.strictEqual(filtered.records[0].wagonNumber, 'W-1');
  });

  // Test Case 8: Sequential sequence numbers are monotonically increasing
  it('TC-R3-08: Consecutive inspections receive unique, strictly increasing sequence numbers', () => {
    const r1 = db.logInspection({
      inspectorId: 'insp-1',
      wagonNumber: 'W-SEQ-1',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });
    const r2 = db.logInspection({
      inspectorId: 'insp-1',
      wagonNumber: 'W-SEQ-2',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 257.0,
      classifiedBand: 'GREEN',
      bandRoman: 'Band II',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });

    assert.strictEqual(r2.sequenceNumber, r1.sequenceNumber + 1);
  });

});
