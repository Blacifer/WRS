/**
 * Deep Adversarial Edge Case & Security Stress Suite
 * Indian Railways WRS Raipur Spring Classification System
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.ts';
import { getDatabase, setDatabaseInstance } from '../src/db/connection.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { InspectionRepository } from '../src/db/repository.ts';
import type { ExpressApp } from '../src/framework/index.ts';
import { generateToken } from '../src/auth/jwt.ts';

/*
 * These cases exercise query behaviour — filters, pagination, injection
 * safety — not authentication. They ran anonymously because the read routes
 * accepted anonymous callers, which was the bug rather than the intent, so
 * the helper now signs in as a supervisor by default. A case that is about
 * authentication passes its own headers and still gets exactly what it asks
 * for, including nothing.
 */
const SUPERVISOR_FOR_READS = generateToken({
  id: 'usr_sup_001',
  username: 'supervisor1',
  role: 'SUPERVISOR',
  name: 'S. K. Verma',
  employeeId: 'WRS-SUP-2019'
});

async function mockFetch(app: ExpressApp, method: string, path: string, body: any = { _dummy: true }, headers: Record<string, string> = {}) {
  const withAuth = 'authorization' in headers || 'Authorization' in headers
    ? headers
    : { ...headers, authorization: `Bearer ${SUPERVISOR_FOR_READS}` };
  return app.dispatch({ method, url: path, body, headers: withAuth });
}

describe('Deep Adversarial Stress: SQLite Invariants, Foreign Keys & Boundary Attack Vectors', () => {
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

  describe('1. SQLite Trigger Invariance & Schema Integrity Attacks', () => {
    it('ADV-DEEP-01: Trigger prevents cascading or multi-table UPDATE attacks', () => {
      const r1 = repo.insertInspection({ wagonNumber: 'W1', measuredFreeHeight: 260.0 });
      const r2 = repo.insertInspection({ wagonNumber: 'W2', measuredFreeHeight: 250.0 });

      assert.throws(
        () => {
          db.prepare('UPDATE inspections SET measured_height = measured_height + 1').run();
        },
        (err: any) => err.message.includes('Audit log is strictly append-only')
      );

      // Verify no heights were changed
      const row1 = db.prepare('SELECT measured_height FROM inspections WHERE id = ?').get(r1.id) as any;
      const row2 = db.prepare('SELECT measured_height FROM inspections WHERE id = ?').get(r2.id) as any;
      assert.strictEqual(row1.measured_height, 260.0);
      assert.strictEqual(row2.measured_height, 250.0);
    });

    it('ADV-DEEP-02: Trigger prevents UPDATE attempted via JOIN or CTE', () => {
      const r1 = repo.insertInspection({ wagonNumber: 'W1', measuredFreeHeight: 260.0 });

      assert.throws(
        () => {
          db.prepare(`
            WITH cte AS (SELECT id FROM inspections)
            UPDATE inspections SET status = 'CONDEMNED' WHERE id IN (SELECT id FROM cte)
          `).run();
        },
        (err: any) => err.message.includes('Audit log is strictly append-only')
      );
    });

    it('ADV-DEEP-03: Foreign key enforcement blocks invalid inspector deletion', () => {
      const r1 = repo.insertInspection({ inspectorId: 'usr_insp_001', wagonNumber: 'W-FK-1', measuredFreeHeight: 260.0 });

      assert.throws(
        () => {
          db.prepare("DELETE FROM users WHERE id = 'usr_insp_001'").run();
        },
        (err: any) => err.message.includes('FOREIGN KEY constraint failed')
      );
    });

    it('ADV-DEEP-04: CHECK constraint rejects out-of-physical-range measured_height in direct SQL', () => {
      assert.throws(
        () => {
          db.prepare(`
            INSERT INTO inspections (
              id, sequence_number, wagon_number, bogie_type, spring_condition, spring_position,
              measured_height, status, table_reference, valid_range_min, valid_range_max, inspector_id, inspector_name
            ) VALUES ('bad_h_1', 99999, 'W-BAD', 'CASNUB_22_NLB', 'USED', 'OUTER', -5.0, 'CONDEMNED', 'Table 28', 245.0, 263.0, 'usr_insp_001', 'Ramesh')
          `).run();
        },
        (err: any) => err.message.includes('CHECK constraint failed')
      );

      assert.throws(
        () => {
          db.prepare(`
            INSERT INTO inspections (
              id, sequence_number, wagon_number, bogie_type, spring_condition, spring_position,
              measured_height, status, table_reference, valid_range_min, valid_range_max, inspector_id, inspector_name
            ) VALUES ('bad_h_2', 99998, 'W-BAD2', 'CASNUB_22_NLB', 'USED', 'OUTER', 1500.0, 'CONDEMNED', 'Table 28', 245.0, 263.0, 'usr_insp_001', 'Ramesh')
          `).run();
        },
        (err: any) => err.message.includes('CHECK constraint failed')
      );
    });
  });

  describe('2. Multi-Criteria Search & Filter Boundary Attacks', () => {
    beforeEach(() => {
      repo.insertInspection({ wagonNumber: 'SE-BOXN-11', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 260.0, classifiedBand: 'BLUE', status: 'PASS', inspectorId: 'usr_insp_001', isOverridden: false });
      repo.insertInspection({ wagonNumber: 'SE-BOXN-22', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 250.0, classifiedBand: 'ORANGE', status: 'PASS', inspectorId: 'usr_insp_001', isOverridden: true, overrideBand: 'YELLOW', overrideReason: 'Supervisor override applied' });
      repo.insertInspection({ wagonNumber: 'CR-HS-33', bogieType: 'CASNUB_22_HS', condition: 'NEW', springPosition: 'INNER', measuredFreeHeight: 235.0, classifiedBand: null, status: 'CONDEMNED', inspectorId: 'usr_insp_002', damageType: 'CRACK' });
    });

    it('ADV-DEEP-05: Filter by supervisorOverride (boolean string query)', async () => {
      const resOverride = await mockFetch(app, 'GET', '/api/inspections?supervisorOverride=true');
      assert.strictEqual(resOverride.status, 200);
      assert.strictEqual(resOverride.body.data.length, 1);
      assert.strictEqual(resOverride.body.data[0].wagonNumber, 'SE-BOXN-22');

      const resNoOverride = await mockFetch(app, 'GET', '/api/inspections?supervisorOverride=false');
      assert.strictEqual(resNoOverride.status, 200);
      assert.strictEqual(resNoOverride.body.data.length, 2);
    });

    it('ADV-DEEP-06: Filter by damageType with defect criteria', async () => {
      const resCrack = await mockFetch(app, 'GET', '/api/inspections?damageType=CRACK');
      assert.strictEqual(resCrack.status, 200);
      assert.strictEqual(resCrack.body.data.length, 1);
      assert.strictEqual(resCrack.body.data[0].wagonNumber, 'CR-HS-33');
      assert.strictEqual(resCrack.body.data[0].status, 'CONDEMNED');
    });

    it('ADV-DEEP-07: Search by single wagon ID retrieves exact record or returns 404 for unknown ID', async () => {
      const allRes = await mockFetch(app, 'GET', '/api/inspections');
      const firstId = allRes.body.data[0].id;

      const singleRes = await mockFetch(app, 'GET', `/api/inspections/${firstId}`);
      assert.strictEqual(singleRes.status, 200);
      assert.strictEqual(singleRes.body.data.id, firstId);

      const notFoundRes = await mockFetch(app, 'GET', '/api/inspections/non_existent_id_99999');
      assert.strictEqual(notFoundRes.status, 404);
      assert.strictEqual(notFoundRes.body.error, 'NOT_FOUND');
    });

    it('ADV-DEEP-08: Export endpoint CSV output contains all required regulatory fields and audit hash header', async () => {
      const exportRes = await mockFetch(app, 'GET', '/api/inspections/export?format=csv');
      assert.strictEqual(exportRes.status, 200);
      assert.strictEqual(exportRes.headers['content-type'], 'text/csv');
      assert.ok(exportRes.body.includes('Audit Hash'));
      assert.ok(exportRes.body.includes('SE-BOXN-11'));
      assert.ok(exportRes.body.includes('CR-HS-33'));
    });

    it('ADV-DEEP-09: Export endpoint JSON output formats array of records accurately', async () => {
      const exportRes = await mockFetch(app, 'GET', '/api/inspections/export?format=json');
      assert.strictEqual(exportRes.status, 200);
      assert.strictEqual(exportRes.body.success, true);
      assert.strictEqual(exportRes.body.count, 3);
      assert.strictEqual(exportRes.body.records.length, 3);
    });
  });
});
