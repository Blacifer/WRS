/**
 * Adversarial Verifier Suite: Database Immutability & API Integrity
 * Indian Railways WRS Raipur Spring Classification System
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { getDatabase, setDatabaseInstance } from '../src/db/connection.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { InspectionRepository } from '../src/db/repository.ts';
import type { ExpressApp } from '../src/framework/index.ts';
import type { BogieType, SpringCondition, SpringPosition } from '../../shared/types.ts';

/*
 * POST /api/inspections now requires authentication. These tests used to
 * rely on it not doing so — the route accepted an unauthenticated write and
 * attributed it to a hardcoded inspector, which is the fault being fixed.
 */
const INSPECTOR_AUTH = {
  authorization: `Bearer ${generateToken({
    id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR', name: 'Ramesh Kumar'
  } as any)}`
};

async function mockFetch(app: ExpressApp, method: string, path: string, body: any = { _dummy: true }, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}

describe('Adversarial Verification: Database Immutability & API Integrity', () => {
  let db: DatabaseSync;
  let repo: InspectionRepository;
  let app: ExpressApp;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    setDatabaseInstance(db);
    runMigrations(db);
    seedUsers(db);
    repo = new InspectionRepository(db);
    app = createApp(':memory:');
    setDatabaseInstance(db);
  });

  describe('1. Direct SQL Attacks & SQLite Trigger Immutability Enforcement', () => {
    let testRecordId: string;

    beforeEach(() => {
      const record = repo.insertInspection({
        inspectorId: 'usr_insp_001',
        wagonNumber: 'SE-BOXN-100001',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 260.0
      });
      testRecordId = record.id;
    });

    it('ADV-SQL-01: Direct single-row UPDATE on inspections table is strictly aborted by trigger', () => {
      assert.throws(
        () => db.prepare('UPDATE inspections SET measured_height = 250.0 WHERE id = ?').run(testRecordId),
        (err: any) => err.message.includes('Audit log is strictly append-only') || err.message.includes('immutable')
      );
    });

    it('ADV-SQL-02: Bulk UPDATE without WHERE clause is strictly aborted by trigger', () => {
      repo.insertInspection({ wagonNumber: 'SE-BOXN-100002', measuredFreeHeight: 244.0 });
      assert.throws(
        () => db.prepare("UPDATE inspections SET status = 'CONDEMNED'").run(),
        (err: any) => err.message.includes('Audit log is strictly append-only')
      );
    });

    it('ADV-SQL-03: Subquery-based UPDATE on inspections is strictly aborted', () => {
      assert.throws(
        () => db.prepare('UPDATE inspections SET measured_height = 200.0 WHERE id IN (SELECT id FROM inspections)').run(),
        (err: any) => err.message.includes('Audit log is strictly append-only')
      );
    });

    it('ADV-SQL-04: Direct single-row DELETE on inspections table is strictly aborted by trigger', () => {
      assert.throws(
        () => db.prepare('DELETE FROM inspections WHERE id = ?').run(testRecordId),
        (err: any) => err.message.includes('Audit log is strictly append-only') || err.message.includes('immutable')
      );
    });

    it('ADV-SQL-05: Bulk table wipe DELETE FROM inspections is strictly aborted', () => {
      assert.throws(
        () => db.prepare('DELETE FROM inspections').run(),
        (err: any) => err.message.includes('Audit log is strictly append-only')
      );
    });

    it('ADV-SQL-06: Direct UPDATE on inspection_audit_log table is strictly aborted', () => {
      const auditEntry = db.prepare('SELECT id FROM inspection_audit_log WHERE inspection_id = ?').get(testRecordId) as { id: string };
      assert.ok(auditEntry);
      assert.throws(
        () => db.prepare("UPDATE inspection_audit_log SET user_role = 'ATTACKER' WHERE id = ?").run(auditEntry.id),
        (err: any) => err.message.includes('Audit log is strictly append-only')
      );
    });

    it('ADV-SQL-07: Direct DELETE on inspection_audit_log table is strictly aborted', () => {
      const auditEntry = db.prepare('SELECT id FROM inspection_audit_log WHERE inspection_id = ?').get(testRecordId) as { id: string };
      assert.ok(auditEntry);
      assert.throws(
        () => db.prepare('DELETE FROM inspection_audit_log WHERE id = ?').run(auditEntry.id),
        (err: any) => err.message.includes('Audit log is strictly append-only')
      );
    });

    it('ADV-SQL-08: Transaction rollback upon trigger abortion prevents tampering', () => {
      assert.throws(() => {
        db.exec('BEGIN TRANSACTION;');
        db.prepare('UPDATE inspections SET measured_height = 200.0 WHERE id = ?').run(testRecordId);
        db.exec('COMMIT;');
      });
      try { db.exec('ROLLBACK;'); } catch {}

      const row = db.prepare('SELECT measured_height FROM inspections WHERE id = ?').get(testRecordId) as any;
      assert.strictEqual(row.measured_height, 260.0);
    });
  });

  describe('2. HTTP Immutability & 405 Method Not Allowed Enforcement', () => {
    it('ADV-HTTP-01: PUT /api/inspections and PUT /api/inspections/:id return HTTP 405', async () => {
      const r1 = await mockFetch(app, 'PUT', '/api/inspections', { measuredHeight: 255.0 });
      assert.strictEqual(r1.status, 405);
      assert.strictEqual(r1.body.error, 'METHOD_NOT_ALLOWED');

      const r2 = await mockFetch(app, 'PUT', '/api/inspections/insp_999', { measuredHeight: 255.0 });
      assert.strictEqual(r2.status, 405);
    });

    it('ADV-HTTP-02: PATCH /api/inspections and PATCH /api/inspections/:id return HTTP 405', async () => {
      const r1 = await mockFetch(app, 'PATCH', '/api/inspections', { status: 'CONDEMNED' });
      assert.strictEqual(r1.status, 405);

      const r2 = await mockFetch(app, 'PATCH', '/api/inspections/insp_999', { status: 'CONDEMNED' });
      assert.strictEqual(r2.status, 405);
    });

    it('ADV-HTTP-03: DELETE /api/inspections and DELETE /api/inspections/:id return HTTP 405', async () => {
      const r1 = await mockFetch(app, 'DELETE', '/api/inspections', {});
      assert.strictEqual(r1.status, 405);

      const r2 = await mockFetch(app, 'DELETE', '/api/inspections/insp_999', {});
      assert.strictEqual(r2.status, 405);
    });

    it('ADV-HTTP-04: PUT/DELETE/PATCH on /api/inspections/stats and /export return HTTP 405', async () => {
      for (const endpoint of ['/api/inspections/stats', '/api/inspections/export']) {
        for (const method of ['PUT', 'PATCH', 'DELETE']) {
          const res = await mockFetch(app, method, endpoint, { dummy: 1 });
          assert.strictEqual(res.status, 405, `${method} ${endpoint} must return 405`);
        }
      }
    });
  });

  describe('3. Concurrency Stress Testing & Cryptographic Audit Hash Verification', () => {
    it('ADV-CONC-01: 500 concurrent inspection inserts maintain strictly monotonic sequence numbers without collision or gaps', async () => {
      const totalRecords = 500;
      const bogieTypes: BogieType[] = ['CASNUB_22_NLB', 'CASNUB_22_HS', 'CASNUB_22_RFT'];
      const conditions: SpringCondition[] = ['USED', 'NEW'];
      const positions: SpringPosition[] = ['OUTER', 'INNER', 'SNUBBER'];

      const promises: Promise<any>[] = [];
      for (let i = 0; i < totalRecords; i++) {
        promises.push(
          mockFetch(app, 'POST', '/api/inspections', {
            wagonNumber: `SE-BOXN-${String(100000 + i).padStart(6, '0')}`,
            bogieType: bogieTypes[i % bogieTypes.length],
            condition: conditions[i % conditions.length],
            position: positions[i % positions.length],
            measuredHeight: 245.0 + (i % 20) * 1.0,
            inspectorId: `usr_insp_${String((i % 4) + 1).padStart(3, '0')}`
          }, INSPECTOR_AUTH)
        );
      }

      const results = await Promise.all(promises);
      for (let i = 0; i < results.length; i++) {
        assert.strictEqual(results[i].status, 201);
        assert.strictEqual(results[i].body.success, true);
        assert.ok(results[i].body.data.id);
      }

      const queryRes = await mockFetch(app, 'GET', `/api/inspections?limit=${totalRecords}&sortBy=created_at&sortOrder=ASC`);
      assert.strictEqual(queryRes.status, 200);
      assert.strictEqual(queryRes.body.pagination.totalCount, totalRecords);

      const records = queryRes.body.data;
      const sequenceNumbers = records.map((r: any) => r.sequenceNumber).sort((a: number, b: number) => a - b);

      assert.strictEqual(sequenceNumbers.length, totalRecords);
      const uniqueSeqs = new Set(sequenceNumbers);
      assert.strictEqual(uniqueSeqs.size, totalRecords, 'Zero sequence number collisions');

      for (let i = 0; i < totalRecords; i++) {
        assert.strictEqual(sequenceNumbers[i], i + 1, `Monotonic sequence check at ${i}`);
      }
    });

    it('ADV-CONC-02: Cryptographic SHA-256 audit hash verification across all inserted records', async () => {
      const recordsCount = 50;
      for (let i = 0; i < recordsCount; i++) {
        await mockFetch(app, 'POST', '/api/inspections', {
          wagonNumber: `WAG-HASH-${i}`,
          bogieType: 'CASNUB_22_NLB',
          condition: 'USED',
          position: 'OUTER',
          measuredHeight: 260.0,
          inspectorId: 'usr_insp_001'
        }, INSPECTOR_AUTH);
      }

      const queryRes = await mockFetch(app, 'GET', `/api/inspections?limit=${recordsCount}`);
      assert.strictEqual(queryRes.body.data.length, recordsCount);

      for (const record of queryRes.body.data) {
        assert.ok(record.auditHash);
        const canonicalString = [
          record.id,
          record.sequenceNumber,
          record.wagonNumber,
          record.bogieType,
          record.springPosition,
          record.condition,
          record.measuredFreeHeight,
          record.classifiedBand,
          record.status,
          record.inspectorId,
          record.timestamp
        ].join('|');

        const expectedHash = crypto.createHash('sha256').update(canonicalString).digest('hex');
        assert.strictEqual(record.auditHash, expectedHash);
      }
    });

    it('ADV-CONC-03: Automatic audit trigger produces 100% matched inspection_audit_log entries', async () => {
      for (let i = 0; i < 20; i++) {
        repo.insertInspection({ wagonNumber: `WAG-TRIGGER-${i}`, measuredFreeHeight: 260.0, inspectorId: 'usr_insp_001' });
      }
      const count = (db.prepare("SELECT COUNT(*) as cnt FROM inspection_audit_log WHERE event_type = 'INSPECTION_CREATED'").get() as any).cnt;
      assert.strictEqual(count, 20);
    });
  });

  describe('4. Search/Filter Injection & Malformed Query Safety', () => {
    beforeEach(() => {
      repo.insertInspection({ wagonNumber: 'SEC-BOXN-554400', measuredFreeHeight: 260.0, inspectorId: 'usr_insp_001' });
      repo.insertInspection({ wagonNumber: 'CR-BCNA-223311', measuredFreeHeight: 244.0, inspectorId: 'usr_insp_002' });
      repo.insertInspection({ wagonNumber: 'WR-BOBRN-998877', measuredFreeHeight: 270.0, inspectorId: 'usr_insp_001' });
    });

    it('ADV-INJ-01: SQL Injection payloads in wagonNumber and inspectorId are safely parameterized', async () => {
      const payloads = ["' OR '1'='1", "'; DROP TABLE inspections; --", "' UNION SELECT * FROM users --"];
      for (const payload of payloads) {
        const res = await mockFetch(app, 'GET', `/api/inspections?wagonNumber=${encodeURIComponent(payload)}`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.data.length, 0);
      }
      const count = (db.prepare('SELECT COUNT(*) as cnt FROM inspections').get() as any).cnt;
      assert.strictEqual(count, 3);
    });

    it('ADV-INJ-02: Malicious sortBy and sortOrder parameters safely fallback to whitelist defaults', async () => {
      const res = await mockFetch(app, 'GET', '/api/inspections?sortBy=wagon_number;DROP TABLE inspections;--&sortOrder=INVALID');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.length, 3);
    });

    it('ADV-INJ-03: Extreme and invalid pagination values are sanitized safely', async () => {
      const res1 = await mockFetch(app, 'GET', '/api/inspections?page=-5&limit=-10');
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.body.pagination.page, 1);
      assert.strictEqual(res1.body.pagination.limit, 1);

      const res2 = await mockFetch(app, 'GET', '/api/inspections?page=9999&limit=999999');
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.pagination.limit, 500);
    });

    it('ADV-INJ-04: Malformed dates and Devanagari Unicode queries are safely handled', async () => {
      const resDate = await mockFetch(app, 'GET', '/api/inspections?startDate=invalid-date&endDate=9999-99-99');
      assert.strictEqual(resDate.status, 200);

      repo.insertInspection({ wagonNumber: 'SE-देवनागरी-101', measuredFreeHeight: 260.0, damageNotes: 'स्प्रिंग में दरार 🛑' });
      const resDev = await mockFetch(app, 'GET', `/api/inspections?wagonNumber=${encodeURIComponent('देवनागरी')}`);
      assert.strictEqual(resDev.status, 200);
      assert.strictEqual(resDev.body.data.length, 1);
    });
  });
});
