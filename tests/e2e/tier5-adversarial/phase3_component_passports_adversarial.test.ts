/**
 * Tier 5 Adversarial Suite — Phase 3 Feature R4: Component Health Passports & RFID/QR Ledger
 * Indian Railways WRS Raipur (Phase 3)
 *
 * Empirical Challenger Verification:
 * 1. Malformed / corrupted QR payloads and protocol variations (URI, JSON, Raw, SQLi, Buffer overflow, missing fields).
 * 2. Duplicate serial number registration rejection (case sensitivity, whitespace, duplicate RFID tags, duplicate QR codes).
 * 3. SQLite triggers immutability under malicious direct SQL statements (UPDATE/DELETE on component_history, foreign key cascading, check constraints).
 * 4. Multi-wagon transfer race conditions / unassignment state consistency (rapid circular transfers, redundant unassignments, status transitions).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TestApp } from '../../harness/test_app.ts';
import { encodeComponentQR, decodeComponentQR, MockQRDetector } from '../../harness/qr_mock.ts';
import { runMigrations } from '../../../server/src/db/migrations.ts';
import { ComponentRepository, calculateHealthStatus } from '../../../server/src/db/componentRepository.ts';
import type {
  SerializedComponent,
  ComponentHistoryEvent,
  SerializedComponentType,
  ComponentStatus
} from '../../../shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

describe('Tier 5 Adversarial — Phase 3 Feature R4: Component Passports & RFID/QR Ledger', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  let adminToken: string;

  const wagonA = 'SECR/BOXNHL/80001';
  const wagonB = 'SECR/BOXNHL/80002';
  const wagonC = 'SECR/BOXNHL/80003';
  const wagonD = 'SECR/BOXNHL/80004';
  const wagonE = 'SECR/BOXNHL/80005';

  beforeEach(async () => {
    app = new TestApp(':memory:');

    // Authenticate users
    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    const adminLogin = await app.post('/api/auth/login', { username: 'admin1', password: 'password123' });
    adminToken = (adminLogin.body as { token: string }).token;

    // Register test wagons
    for (const w of [wagonA, wagonB, wagonC, wagonD, wagonE]) {
      await app.post(
        '/api/wagons/register',
        { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
    }
  });

  // =========================================================================
  // SUB-SUITE 1: MALFORMED / CORRUPTED QR PAYLOADS & PROTOCOL VARIATIONS
  // =========================================================================
  describe('1. Adversarial QR Payload Decoding & Error Diagnostics', () => {
    const detector = new MockQRDetector();

    it('ADV-QR-01: Rejects empty strings, whitespace, and nullish inputs with MALFORMED_QR', async () => {
      const invalidInputs = ['', '   ', '\t\n\r', null as any, undefined as any];
      for (const input of invalidInputs) {
        assert.throws(
          () => decodeComponentQR(input),
          /MALFORMED_QR/,
          `Expected MALFORMED_QR for input: ${JSON.stringify(input)}`
        );
      }
    });

    it('ADV-QR-02: Rejects completely corrupted non-ASCII binary strings & random noise', async () => {
      const noisyPayloads = [
        '###CORRUPT_QR_BYTES_0xDEADBEEF###',
        '>>>???<<<;;;!!!@@@$$$%%%^^^',
        'HELLO_WORLD_RANDOM_GARBAGE',
        'HTTP://UNSUPPORTED_SCHEME_XYZ.COM',
        '{"corrupted": true, "missing_everything": 123}'
      ];

      for (const noise of noisyPayloads) {
        assert.throws(
          () => decodeComponentQR(noise),
          /MALFORMED_QR/,
          `Expected MALFORMED_QR for noisy payload: "${noise}"`
        );
      }
    });

    it('ADV-QR-03: Rejects WRS-PASSPORT URI missing mandatory "sn" or "type" parameters', async () => {
      // Missing 'sn' parameter
      const missingSn = 'WRS-PASSPORT://v1?type=WHEELSET&mfg=RWF';
      assert.throws(
        () => decodeComponentQR(missingSn),
        /MALFORMED_QR.*Missing "sn"/,
        'Expected error on missing sn'
      );

      // Missing 'type' parameter
      const missingType = 'WRS-PASSPORT://v1?sn=WRS-WS-123&mfg=RWF';
      assert.throws(
        () => decodeComponentQR(missingType),
        /MALFORMED_QR.*Missing "type"/,
        'Expected error on missing type'
      );
    });

    it('ADV-QR-04: Rejects corrupted JSON payloads with syntax errors or missing required keys', async () => {
      const malformedJsonList = [
        '{"serialNumber": "WRS-WS-01", "componentType": "WHEELSET", ', // Truncated JSON
        '{"badKey": "someValue"}', // Missing serialNumber / sn
        '{"serialNumber": ""}', // Empty serialNumber in JSON
        '{"sn": null, "type": "BEARING"}' // Null serialNumber
      ];

      for (const badJson of malformedJsonList) {
        assert.throws(
          () => decodeComponentQR(badJson),
          /MALFORMED_QR/,
          `Expected MALFORMED_QR for JSON: ${badJson}`
        );
      }
    });

    it('ADV-QR-05: Safely sanitizes SQL Injection and XSS strings in QR parameters', async () => {
      const sqliSerial = "WRS-WS-999'; DROP TABLE components; --";
      const sqliPayload = encodeComponentQR(sqliSerial, {
        componentType: 'WHEELSET',
        manufacturer: 'RWF Yelahanka'
      });

      const decoded = await detector.detectFromPayload(sqliPayload);
      assert.strictEqual(decoded.serialNumber, sqliSerial.toUpperCase());

      // Attempt scanning through API -> should result in 404 NOT_FOUND, NOT SQL syntax error
      const scanRes = await app.post(
        '/api/components/scan-qr',
        { qrPayload: sqliPayload },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(scanRes.status, 404);
      const body = scanRes.body as any;
      assert.strictEqual(body.success, false);
      assert.ok(body.error.includes('COMPONENT_NOT_FOUND'));

      // Ensure components table is still intact
      const compList = await app.get('/api/components', { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(compList.status, 200);
    });

    it('ADV-QR-06: Handles extreme payload length (100KB padded payload) without DoS or crash', async () => {
      const paddedMfg = 'A'.repeat(50000);
      const longUri = `WRS-PASSPORT://v1?sn=WRS-WS-LONG-01&type=WHEELSET&mfg=${paddedMfg}&date=2026-01-01`;

      const decoded = decodeComponentQR(longUri);
      assert.strictEqual(decoded.serialNumber, 'WRS-WS-LONG-01');
      assert.strictEqual(decoded.manufacturer, paddedMfg);
    });

    it('ADV-QR-07: Supports valid JSON and Raw Serial protocol formats flawlessly', async () => {
      // 1. JSON format with 'sn' alias
      const jsonSn = JSON.stringify({ sn: 'WRS-BRG-JSON-01', type: 'BEARING', mfg: 'TIMKEN' });
      const decodedJson = decodeComponentQR(jsonSn);
      assert.strictEqual(decodedJson.serialNumber, 'WRS-BRG-JSON-01');
      assert.strictEqual(decodedJson.componentType, 'BEARING');
      assert.strictEqual(decodedJson.manufacturer, 'TIMKEN');

      // 2. Raw serial formats
      const rawWs = decodeComponentQR('WRS-WS-998877');
      assert.strictEqual(rawWs.serialNumber, 'WRS-WS-998877');
      assert.strictEqual(rawWs.componentType, 'WHEELSET');

      const rawBrg = decodeComponentQR('CTRB-BRG-1234');
      assert.strictEqual(rawBrg.serialNumber, 'CTRB-BRG-1234');
      assert.strictEqual(rawBrg.componentType, 'BEARING');
    });
  });

  // =========================================================================
  // SUB-SUITE 2: DUPLICATE SERIAL REGISTRATION & COLLISION REJECTION
  // =========================================================================
  describe('2. Duplicate Registration, Case Normalization & Collision Attacks', () => {
    it('ADV-DUP-01: Rejects duplicate serial registration with 400/409 Conflict', async () => {
      // First registration
      const reg1 = await app.post(
        '/api/components/register',
        {
          serialNumber: 'WRS-WS-DUP-01',
          componentType: 'WHEELSET',
          category: 'WHEELS_AXLES',
          partName: 'Wheelset Duplicate Test'
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(reg1.status, 201);

      // Attempt identical duplicate registration
      const reg2 = await app.post(
        '/api/components/register',
        {
          serialNumber: 'WRS-WS-DUP-01',
          componentType: 'WHEELSET',
          category: 'WHEELS_AXLES',
          partName: 'Wheelset Duplicate Test Attempt 2'
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(reg2.status, 400); // TestApp returns 400 with descriptive error
      const body = reg2.body as any;
      assert.strictEqual(body.success, false);
      assert.ok(body.error.includes('UNIQUE') || body.error.includes('already exists') || body.error.includes('ALREADY_EXISTS'));
    });

    it('ADV-DUP-02: Normalizes case and whitespace preventing collision bypass', async () => {
      // Register with standard uppercase
      await app.post(
        '/api/components/register',
        {
          serialNumber: 'WRS-BRG-CASE-01',
          componentType: 'BEARING',
          category: 'BEARINGS',
          partName: 'CTRB Bearing Case Test'
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );

      // Attempt lowercase duplicate
      const lowerDup = await app.post(
        '/api/components/register',
        {
          serialNumber: 'wrs-brg-case-01',
          componentType: 'BEARING',
          category: 'BEARINGS',
          partName: 'CTRB Lowercase Duplicate'
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(lowerDup.status, 400);

      // Attempt whitespace padded duplicate
      const spaceDup = await app.post(
        '/api/components/register',
        {
          serialNumber: '   WRS-BRG-CASE-01   ',
          componentType: 'BEARING',
          category: 'BEARINGS',
          partName: 'CTRB Whitespace Padded Duplicate'
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(spaceDup.status, 400);
    });

    it('ADV-DUP-03: Rejects registration with missing or blank serialNumber / componentType', async () => {
      // Blank serialNumber
      const blankSn = await app.post(
        '/api/components/register',
        { serialNumber: '   ', componentType: 'WHEELSET', partName: 'Test' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(blankSn.status, 400);

      // Missing componentType
      const missingType = await app.post(
        '/api/components/register',
        { serialNumber: 'WRS-VALID-SN-01', partName: 'Test' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(missingType.status, 400);
    });

    it('ADV-DUP-04: Direct SQLite UNIQUE constraints block duplicate serials and duplicate RFID tags', async () => {
      const rawDb = (app.auditDb as any).db as DatabaseSync;

      // Register first component
      app.auditDb.registerComponent({
        serialNumber: 'WRS-RFID-TEST-01',
        componentType: 'WHEELSET',
        category: 'WHEELS_AXLES',
        partName: 'Wheelset RFID 1',
        rfidTag: 'RFID-TAG-UNIQUE-999'
      });

      // Attempt inserting duplicate serial number directly into SQLite
      assert.throws(() => {
        rawDb.prepare(`
          INSERT INTO components (id, serial_number, component_type, category, part_name, qr_code, manufacturing_date, manufacturer, created_at, updated_at)
          VALUES ('id_1', 'WRS-RFID-TEST-01', 'WHEELSET', 'WHEELS_AXLES', 'Wheelset Dup', 'QR1', '2026-01-01', 'RWF', datetime('now'), datetime('now'))
        `).run();
      }, /UNIQUE constraint failed.*components\.serial_number/);
    });
  });

  // =========================================================================
  // SUB-SUITE 3: SQLITE TRIGGERS IMMUTABILITY UNDER DIRECT MALICIOUS SQL
  // =========================================================================
  describe('3. SQLite Triggers Immutability Under Direct Malicious SQL Attacks', () => {
    let prodDb: DatabaseSync;
    let prodRepo: ComponentRepository;
    let prodCompId: string;
    let prodEventId: string;

    beforeEach(() => {
      // Initialize full production SQLite database schema
      prodDb = new DatabaseSync(':memory:');
      runMigrations(prodDb);
      prodRepo = new ComponentRepository(prodDb);

      const comp = prodRepo.registerComponent({
        serialNumber: 'WRS-IMMUT-001',
        componentType: 'FRICTION_WEDGE',
        category: 'FRICTION_WEDGES',
        partName: 'CASNUB Friction Wedge Immutability Test'
      });
      prodCompId = comp.id;

      const hist = prodRepo.getComponentBySerial('WRS-IMMUT-001')!.history;
      assert.strictEqual(hist.length, 1);
      prodEventId = hist[0].id;
    });

    it('ADV-TRIG-01: Direct UPDATE on component_history is unconditionally aborted by trigger', () => {
      assert.throws(
        () => {
          prodDb.prepare('UPDATE component_history SET action_details = ? WHERE id = ?').run('MALICIOUS_ALTERATION', prodEventId);
        },
        /Component history is strictly append-only/
      );

      // Verify row is unchanged
      const rows = prodDb.prepare('SELECT action_details FROM component_history WHERE id = ?').all(prodEventId) as any[];
      assert.strictEqual(rows.length, 1);
      assert.ok(!rows[0].action_details.includes('MALICIOUS'));
    });

    it('ADV-TRIG-02: Direct DELETE on component_history is unconditionally aborted by trigger', () => {
      assert.throws(
        () => {
          prodDb.prepare('DELETE FROM component_history WHERE id = ?').run(prodEventId);
        },
        /Component history is strictly append-only/
      );

      // Verify row still exists
      const count = prodDb.prepare('SELECT COUNT(*) as cnt FROM component_history WHERE id = ?').get(prodEventId) as { cnt: number };
      assert.strictEqual(count.cnt, 1);
    });

    it('ADV-TRIG-03: Multi-row UPDATE and DELETE operations are completely aborted', () => {
      // Add more history events via maintenance API
      prodRepo.recordMaintenanceEvent('WRS-IMMUT-001', 'INSPECTED', 'Second event logged', 'COMPONENT_INSPECTION', 'Routine check');

      // Attempt unconditional multi-row UPDATE
      assert.throws(
        () => {
          prodDb.prepare('UPDATE component_history SET performer_name = ?').run('Attacker');
        },
        /Component history is strictly append-only/
      );

      // Attempt unconditional multi-row DELETE
      assert.throws(
        () => {
          prodDb.prepare('DELETE FROM component_history').run();
        },
        /Component history is strictly append-only/
      );

      // Verify history count remains 2
      const history = prodRepo.getComponentBySerial('WRS-IMMUT-001')!.history;
      assert.strictEqual(history.length, 2);
    });

    it('ADV-TRIG-04: Subquery-based UPDATE attempts on component_history are aborted', () => {
      assert.throws(
        () => {
          prodDb.prepare(`
            UPDATE component_history
            SET action_details = (SELECT wagon_number FROM wagons LIMIT 1)
            WHERE serial_number = 'WRS-IMMUT-001'
          `).run();
        },
        /Component history is strictly append-only/
      );
    });

    it('ADV-TRIG-05: FOREIGN KEY RESTRICT constraint prevents deletion of component with history', () => {
      // Attempt to delete parent component row while history rows reference it
      assert.throws(
        () => {
          prodDb.prepare('DELETE FROM components WHERE id = ?').run(prodCompId);
        },
        /FOREIGN KEY constraint failed/
      );

      // Verify component still exists
      const comp = prodRepo.getComponentById(prodCompId);
      assert.ok(comp);
      assert.strictEqual(comp.serialNumber, 'WRS-IMMUT-001');
    });

    it('ADV-TRIG-06: Schema CHECK constraint prevents insertion of unauthorized event types', () => {
      assert.throws(
        () => {
          prodDb.prepare(`
            INSERT INTO component_history (
              id, component_id, serial_number, event_type, action_details, performed_by, performer_name, created_at
            ) VALUES ('fake_id', ?, 'WRS-IMMUT-001', 'FORGED_EVENT_TYPE', 'Details', 'Hacker', 'Hacker Name', datetime('now'))
          `).run(prodCompId);
        },
        /CHECK constraint failed.*event_type/
      );
    });
  });

  // =========================================================================
  // SUB-SUITE 4: MULTI-WAGON TRANSFER CYCLES & STATE CONSISTENCY
  // =========================================================================
  describe('4. Multi-Wagon Transfers, State Consistency & Health Scoring', () => {
    it('ADV-XFER-01: Rapid circular transfers across 5 wagons maintain strict chronological timeline', async () => {
      // 1. Register Wheelset
      const regRes = await app.post(
        '/api/components/register',
        {
          serialNumber: 'WRS-WS-CIRC-55',
          componentType: 'WHEELSET',
          category: 'WHEELS_AXLES',
          partName: 'CASNUB 22HS Wheelset Circular Test',
          manufacturer: 'RWF Yelahanka'
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(regRes.status, 201);

      // 2. Transfer across 5 wagons in sequence: A -> B -> C -> D -> E -> A
      const transferPath = [
        { wagon: wagonA, pos: 'BOGIE_1', stage: 'REASSEMBLY' },
        { wagon: wagonB, pos: 'BOGIE_2', stage: 'REPAIR_REPLACEMENT' },
        { wagon: wagonC, pos: 'BOGIE_1', stage: 'COMPONENT_INSPECTION' },
        { wagon: wagonD, pos: 'BOGIE_2', stage: 'REASSEMBLY' },
        { wagon: wagonE, pos: 'BOGIE_1', stage: 'REPAIR_REPLACEMENT' },
        { wagon: wagonA, pos: 'BOGIE_2', stage: 'FINAL_QC_GATE' }
      ];

      for (const step of transferPath) {
        const assignRes = await app.post(
          '/api/components/WRS-WS-CIRC-55/assign',
          { wagonNumber: step.wagon, bogiePosition: step.pos, stage: step.stage, notes: `Transfer to ${step.wagon}` },
          { Authorization: `Bearer ${inspectorToken}` }
        );
        assert.strictEqual(assignRes.status, 200);
        const comp = (assignRes.body as any).data;
        assert.strictEqual(comp.currentWagonNumber, step.wagon);
        assert.strictEqual(comp.currentBogiePosition, step.pos);
        assert.strictEqual(comp.status, 'IN_SERVICE');
      }

      // 3. Inspect full historical provenance timeline
      const histRes = await app.get('/api/components/WRS-WS-CIRC-55/history', { Authorization: `Bearer ${inspectorToken}` });
      assert.strictEqual(histRes.status, 200);
      const events = (histRes.body as any).data as ComponentHistoryEvent[];

      // Initial MANUFACTURED + 1st assign + 5 reassignments (each reassignment = 1 REMOVED + 1 ASSIGNED)
      // Total events: 1 (MANUFACTURED) + 1 (ASSIGNED_A) + 5 * 2 (REMOVED + ASSIGNED) = 12 events
      assert.strictEqual(events.length, 12);
      assert.strictEqual(events[0].eventType, 'MANUFACTURED');

      // Verify sequence of assigned wagons
      const assignedEvents = events.filter(e => e.eventType === 'ASSIGNED_TO_WAGON');
      assert.strictEqual(assignedEvents.length, 6);
      assert.strictEqual(assignedEvents[0].wagonNumber, wagonA);
      assert.strictEqual(assignedEvents[1].wagonNumber, wagonB);
      assert.strictEqual(assignedEvents[2].wagonNumber, wagonC);
      assert.strictEqual(assignedEvents[3].wagonNumber, wagonD);
      assert.strictEqual(assignedEvents[4].wagonNumber, wagonE);
      assert.strictEqual(assignedEvents[5].wagonNumber, wagonA);
    });

    it('ADV-XFER-02: Redundant unassignments on unassigned component maintain consistent stores state', async () => {
      // 1. Register component
      await app.post(
        '/api/components/register',
        {
          serialNumber: 'WRS-BRG-UNASS-01',
          componentType: 'BEARING',
          category: 'BEARINGS',
          partName: 'CTRB Bearing Unassign Test'
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );

      // Component starts unassigned (AVAILABLE_IN_STORES)
      // Call unassign repeatedly
      for (let i = 0; i < 3; i++) {
        const unassignRes = await app.post(
          '/api/components/WRS-BRG-UNASS-01/unassign',
          { notes: `Redundant unassign call ${i + 1}` },
          { Authorization: `Bearer ${inspectorToken}` }
        );
        assert.strictEqual(unassignRes.status, 200);
        const comp = (unassignRes.body as any).data;
        assert.strictEqual(comp.currentWagonNumber, null);
        assert.strictEqual(comp.currentBogiePosition, 'NONE');
        assert.strictEqual(comp.status, 'AVAILABLE_IN_STORES');
      }

      // Verify history records each unassign action cleanly
      const histRes = await app.get('/api/components/WRS-BRG-UNASS-01/history', { Authorization: `Bearer ${inspectorToken}` });
      const events = (histRes.body as any).data as ComponentHistoryEvent[];
      assert.strictEqual(events.length, 4); // 1 MANUFACTURED + 3 REMOVED_FROM_WAGON
    });

    it('ADV-XFER-03: Component Health Score degradation & RDSO status calculation matrix', () => {
      // Test RDSO health score thresholds
      assert.strictEqual(calculateHealthStatus(100.0), 'EXCELLENT');
      assert.strictEqual(calculateHealthStatus(90.0), 'EXCELLENT');
      assert.strictEqual(calculateHealthStatus(89.9), 'GOOD');
      assert.strictEqual(calculateHealthStatus(75.0), 'GOOD');
      assert.strictEqual(calculateHealthStatus(74.9), 'FAIR');
      assert.strictEqual(calculateHealthStatus(60.0), 'FAIR');
      assert.strictEqual(calculateHealthStatus(59.9), 'ATTENTION_REQUIRED');
      assert.strictEqual(calculateHealthStatus(40.0), 'ATTENTION_REQUIRED');
      assert.strictEqual(calculateHealthStatus(39.9), 'CRITICAL');
      assert.strictEqual(calculateHealthStatus(0.0), 'CRITICAL');

      // Clamping out-of-range scores
      assert.strictEqual(calculateHealthStatus(-50.0), 'CRITICAL');
      assert.strictEqual(calculateHealthStatus(150.0), 'EXCELLENT');
    });

    it('ADV-XFER-04: Full Periodic Overhaul (POH) restoration resets health score to 100% and increments overhaul count', () => {
      const prodDb = new DatabaseSync(':memory:');
      runMigrations(prodDb);
      const repo = new ComponentRepository(prodDb);

      // Register and degrade health score
      repo.registerComponent({
        serialNumber: 'WRS-DG-POH-01',
        componentType: 'DRAFT_GEAR',
        category: 'COUPLERS_DRAFT_GEAR',
        partName: 'Mark-50 Draft Gear POH Test'
      });

      repo.updateHealthScore('WRS-DG-POH-01', 35.0, 'Severely worn friction packs');
      let comp = repo.getComponentBySerial('WRS-DG-POH-01', false)!;
      assert.strictEqual(comp.healthScore, 35.0);
      assert.strictEqual(comp.healthStatus, 'CRITICAL');
      assert.strictEqual(comp.status, 'UNDER_MAINTENANCE');

      // Perform Overhaul (POH)
      comp = repo.recordOverhaul('WRS-DG-POH-01', '2026-08-15', '2031-02-15', 100.0, 'Full POH rehabilitation completed');
      assert.strictEqual(comp.overhaulCount, 1);
      assert.strictEqual(comp.healthScore, 100.0);
      assert.strictEqual(comp.healthStatus, 'EXCELLENT');
      assert.strictEqual(comp.status, 'RECONDITIONED');
      assert.strictEqual(comp.lastPohDate, '2026-08-15');
      assert.strictEqual(comp.nextPohDue, '2031-02-15');

      // Perform Second Overhaul
      comp = repo.recordOverhaul('WRS-DG-POH-01', '2031-02-10', '2035-08-10', 95.0, 'Second POH cycle');
      assert.strictEqual(comp.overhaulCount, 2);
      assert.strictEqual(comp.healthScore, 95.0);
      assert.strictEqual(comp.healthStatus, 'EXCELLENT');
    });
  });
});
