/**
 * Adversarial Challenger Suite for Milestone 1 (M1)
 * Component Health Passports, Immutability Triggers, Health Boundary Transitions & Harness Fixes
 * 
 * Indian Railways WRS Raipur (Phase 3 - M1 / R4)
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { ComponentRepository, calculateHealthStatus } from '../src/db/componentRepository.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import { AuditDatabase } from '../../tests/harness/audit_db.ts';

describe('M1 Adversarial Challenger: Deep Stress & Invariant Verification', () => {
  let db: DatabaseSync;
  let componentRepo: ComponentRepository;
  let wagonRepo: WagonRepository;
  let auditDb: AuditDatabase;

  before(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db);
    componentRepo = new ComponentRepository(db);
    wagonRepo = new WagonRepository(db);
    auditDb = new AuditDatabase(':memory:');

    // Register initial baseline wagons in wagonRepo
    wagonRepo.registerWagon({
      wagonNumber: 'SECR/BOXNHL/2026/001',
      wagonType: 'BOXNHL',
      owningRailway: 'SECR'
    });

    wagonRepo.registerWagon({
      wagonNumber: 'WR/BCN/2026/002',
      wagonType: 'BCN',
      owningRailway: 'WR'
    });

    wagonRepo.registerWagon({
      wagonNumber: 'NR/BOXN/2026/003',
      wagonType: 'BOXN',
      owningRailway: 'NR'
    });

    // Also register wagons in auditDb for harness filter verification
    auditDb.registerWagon({
      wagonNumber: 'SECR/BOXNHL/2026/001',
      wagonType: 'BOXNHL',
      owningRailway: 'SECR'
    });

    auditDb.registerWagon({
      wagonNumber: 'WR/BCN/2026/002',
      wagonType: 'BCN',
      owningRailway: 'WR'
    });

    auditDb.registerWagon({
      wagonNumber: 'NR/BOXN/2026/003',
      wagonType: 'BOXN',
      owningRailway: 'NR'
    });
  });

  // =========================================================================
  // 1. SQLite Append-Only Trigger Immutability & Forensic Integrity
  // =========================================================================
  describe('1. SQLite Append-Only Trigger Immutability', () => {
    let testCompSerial = 'WHL-IMM-STRESS-001';
    let testCompId: string;
    let initialHistoryId: string;

    before(() => {
      const comp = componentRepo.registerComponent({
        serialNumber: testCompSerial,
        componentType: 'WHEELSET',
        manufacturer: 'Rail Wheel Factory, Yelahanka',
        manufacturingDate: '2024-01-15'
      });
      testCompId = comp.id;

      const history = db.prepare('SELECT * FROM component_history WHERE serial_number = ?').all(testCompSerial) as any[];
      assert.strictEqual(history.length, 1);
      initialHistoryId = history[0].id;
    });

    it('TC-CHALL-01: Direct SQL UPDATE on component_history record is unconditionally blocked by trigger', () => {
      assert.throws(() => {
        db.prepare('UPDATE component_history SET action_details = ? WHERE id = ?').run(
          'TAMPERED_ACTION_DETAILS',
          initialHistoryId
        );
      }, (err: any) => {
        return err.message.includes('Component history is strictly append-only');
      });

      // Verify data remains pristine
      const row = db.prepare('SELECT action_details FROM component_history WHERE id = ?').get(initialHistoryId) as any;
      assert.ok(!row.action_details.includes('TAMPERED_ACTION_DETAILS'));
    });

    it('TC-CHALL-02: Direct bulk SQL UPDATE on component_history is unconditionally blocked', () => {
      assert.throws(() => {
        db.prepare('UPDATE component_history SET notes = ?').run('GLOBAL_MALICIOUS_NOTE');
      }, (err: any) => {
        return err.message.includes('Component history is strictly append-only');
      });
    });

    it('TC-CHALL-03: Direct SQL DELETE on single component_history record is unconditionally blocked', () => {
      assert.throws(() => {
        db.prepare('DELETE FROM component_history WHERE id = ?').run(initialHistoryId);
      }, (err: any) => {
        return err.message.includes('Component history is strictly append-only');
      });

      // Verify row still exists
      const row = db.prepare('SELECT id FROM component_history WHERE id = ?').get(initialHistoryId) as any;
      assert.strictEqual(row.id, initialHistoryId);
    });

    it('TC-CHALL-04: Direct bulk SQL DELETE on component_history is unconditionally blocked', () => {
      assert.throws(() => {
        db.prepare('DELETE FROM component_history').run();
      }, (err: any) => {
        return err.message.includes('Component history is strictly append-only');
      });

      const count = db.prepare('SELECT COUNT(*) as count FROM component_history').get() as any;
      assert.ok(count.count >= 1);
    });

    it('TC-CHALL-05: Parent component deletion is blocked by FOREIGN KEY ON DELETE RESTRICT when history exists', () => {
      assert.throws(() => {
        db.prepare('DELETE FROM components WHERE id = ?').run(testCompId);
      }, (err: any) => {
        return err.message.includes('FOREIGN KEY') || err.message.includes('constraint failed');
      });

      // Verify component still exists
      const comp = componentRepo.getComponentById(testCompId);
      assert.ok(comp);
      assert.strictEqual(comp.serialNumber, testCompSerial);
    });

    it('TC-CHALL-06: Commissioning trigger automatically records initial COMMISSIONED event', () => {
      const comp = componentRepo.registerComponent({
        serialNumber: 'BRG-IMM-STRESS-002',
        componentType: 'BEARING',
        manufacturer: 'SKF India'
      });

      const history = db.prepare('SELECT * FROM component_history WHERE serial_number = ?').all('BRG-IMM-STRESS-002') as any[];
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].event_type, 'COMMISSIONED');
      assert.strictEqual(history[0].performed_by, 'SYSTEM');
      assert.ok(history[0].action_details.includes('Component registered'));
    });

    it('TC-CHALL-07: Assignment trigger automatically records ASSIGNED_TO_WAGON on wagon/bogie change', () => {
      componentRepo.assignComponent('BRG-IMM-STRESS-002', 'SECR/BOXNHL/2026/001', 'BOGIE_1');

      const history = db.prepare('SELECT * FROM component_history WHERE serial_number = ? ORDER BY created_at ASC').all('BRG-IMM-STRESS-002') as any[];
      assert.ok(history.length >= 2);
      const assignEvent = history.find(h => h.event_type === 'ASSIGNED_TO_WAGON');
      assert.ok(assignEvent);
      assert.strictEqual(assignEvent.wagon_number, 'SECR/BOXNHL/2026/001');
    });

    it('TC-CHALL-08: Status change trigger automatically records CONDEMNED / MAINTENANCE event', () => {
      db.prepare("UPDATE components SET status = 'CONDEMNED', health_score = 0.0, health_status = 'CRITICAL' WHERE serial_number = ?").run('BRG-IMM-STRESS-002');

      const history = db.prepare('SELECT * FROM component_history WHERE serial_number = ? ORDER BY created_at ASC').all('BRG-IMM-STRESS-002') as any[];
      const condemnedEvent = history.find(h => h.event_type === 'CONDEMNED');
      assert.ok(condemnedEvent);
      assert.ok(condemnedEvent.action_details.includes('Component status updated'));
    });
  });

  // =========================================================================
  // 2. Component State Transitions & Constraint Invariants
  // =========================================================================
  describe('2. Component State Transitions & Constraint Invariants', () => {
    it('TC-CHALL-09: Rejects registration with empty or whitespace-only serial number', () => {
      assert.throws(() => {
        componentRepo.registerComponent({
          serialNumber: '',
          componentType: 'WHEELSET'
        });
      }, /SERIAL_NUMBER_REQUIRED/);

      assert.throws(() => {
        componentRepo.registerComponent({
          serialNumber: '    ',
          componentType: 'WHEELSET'
        });
      }, /SERIAL_NUMBER_REQUIRED/);
    });

    it('TC-CHALL-10: Rejects registration with missing componentType', () => {
      assert.throws(() => {
        componentRepo.registerComponent({
          serialNumber: 'WHL-NOTYPE-001',
          componentType: '' as any
        });
      }, /COMPONENT_TYPE_REQUIRED/);
    });

    it('TC-CHALL-11: Rejects duplicate serial number registration (exact & case-insensitive)', () => {
      componentRepo.registerComponent({
        serialNumber: 'DGF-DUP-001',
        componentType: 'DRAFT_GEAR'
      });

      // Exact duplicate
      assert.throws(() => {
        componentRepo.registerComponent({
          serialNumber: 'DGF-DUP-001',
          componentType: 'DRAFT_GEAR'
        });
      }, /COMPONENT_ALREADY_EXISTS/);

      // Case-insensitive duplicate
      assert.throws(() => {
        componentRepo.registerComponent({
          serialNumber: 'dgf-dup-001',
          componentType: 'DRAFT_GEAR'
        });
      }, /COMPONENT_ALREADY_EXISTS/);
    });

    it('TC-CHALL-12: Schema enforces UNIQUE constraint on qr_code column', () => {
      // First component
      componentRepo.registerComponent({
        serialNumber: 'CPL-QR-001',
        componentType: 'COUPLER',
        qrCode: 'UNIQUE-QR-CODE-123'
      });

      // Second component with duplicate explicit qrCode
      assert.throws(() => {
        componentRepo.registerComponent({
          serialNumber: 'CPL-QR-002',
          componentType: 'COUPLER',
          qrCode: 'UNIQUE-QR-CODE-123'
        });
      }, (err: any) => {
        return err.message.includes('UNIQUE constraint failed: components.qr_code');
      });
    });

    it('TC-CHALL-13: Schema enforces UNIQUE constraint on rfid_tag while permitting multiple NULLs', () => {
      // First component with RFID
      componentRepo.registerComponent({
        serialNumber: 'FW-RFID-001',
        componentType: 'FRICTION_WEDGE',
        rfidTag: 'RFID-HEX-998877'
      });

      // Second component with duplicate RFID
      assert.throws(() => {
        componentRepo.registerComponent({
          serialNumber: 'FW-RFID-002',
          componentType: 'FRICTION_WEDGE',
          rfidTag: 'RFID-HEX-998877'
        });
      }, (err: any) => {
        return err.message.includes('UNIQUE constraint failed: components.rfid_tag');
      });

      // Multiple components with no RFID (NULL) should succeed without conflict
      const c1 = componentRepo.registerComponent({
        serialNumber: 'FW-NULL-001',
        componentType: 'FRICTION_WEDGE'
      });
      const c2 = componentRepo.registerComponent({
        serialNumber: 'FW-NULL-002',
        componentType: 'FRICTION_WEDGE'
      });

      assert.ok(c1);
      assert.ok(c2);
      assert.strictEqual(c1.rfidTag, undefined);
      assert.strictEqual(c2.rfidTag, undefined);
    });

    it('TC-CHALL-14: Gracefully handles unassignment of an already unassigned component', () => {
      const comp = componentRepo.registerComponent({
        serialNumber: 'BV-UNASSIGN-001',
        componentType: 'BRAKE_VALVE'
      });
      assert.strictEqual(comp.currentWagonNumber, null);

      // Unassigning already unassigned part
      const unassigned = componentRepo.unassignComponent('BV-UNASSIGN-001', 'Routine verification');
      assert.strictEqual(unassigned.currentWagonNumber, null);
      assert.strictEqual(unassigned.status, 'AVAILABLE_IN_STORES');

      // History should record the unassignment event cleanly
      const withHistory = componentRepo.getComponentBySerial('BV-UNASSIGN-001', true);
      assert.ok(withHistory?.history);
      const unassignEvent = withHistory.history.find(h => h.eventType === 'REMOVED_FROM_WAGON');
      assert.ok(unassignEvent);
      assert.ok(unassignEvent.actionDetails.includes('Unassigned from wagon NONE'));
    });

    it('TC-CHALL-15: Multi-cycle assignment provenance chain integrity across 3 wagons', () => {
      const comp = componentRepo.registerComponent({
        serialNumber: 'WHL-MULTI-CYCLE-001',
        componentType: 'WHEELSET'
      });

      // 1. Assign Wagon 1
      componentRepo.assignComponent(comp.serialNumber, 'SECR/BOXNHL/2026/001', 'BOGIE_1', 'ENTRY_REGISTRATION');
      // 2. Unassign to stores
      componentRepo.unassignComponent(comp.serialNumber, 'Turning on lathe');
      // 3. Assign Wagon 2
      componentRepo.assignComponent(comp.serialNumber, 'WR/BCN/2026/002', 'BOGIE_2', 'REPAIR_REPLACEMENT');
      // 4. Overhaul POH
      componentRepo.recordOverhaul(comp.serialNumber, '2026-08-17', '2030-08-17', 98.0, 'Ultrasonic axle test OK');
      // 5. Assign Wagon 3
      componentRepo.assignComponent(comp.serialNumber, 'NR/BOXN/2026/003', 'BOGIE_1', 'REASSEMBLY');

      const fullHistory = componentRepo.getComponentBySerial(comp.serialNumber, true)!;
      assert.strictEqual(fullHistory.currentWagonNumber, 'NR/BOXN/2026/003');
      assert.strictEqual(fullHistory.currentBogiePosition, 'BOGIE_1');
      assert.strictEqual(fullHistory.overhaulCount, 1);
      assert.strictEqual(fullHistory.healthScore, 98.0);
      assert.strictEqual(fullHistory.healthStatus, 'EXCELLENT');

      // Verify all 3 wagons are present in history
      const wagonsRecorded = fullHistory.history.map(h => h.wagonNumber).filter(Boolean);
      assert.ok(wagonsRecorded.includes('SECR/BOXNHL/2026/001'));
      assert.ok(wagonsRecorded.includes('WR/BCN/2026/002'));
      assert.ok(wagonsRecorded.includes('NR/BOXN/2026/003'));
    });
  });

  // =========================================================================
  // 3. Health Score Boundaries & Degradation Invariants
  // =========================================================================
  describe('3. Health Score Boundaries & Status Calculation', () => {
    it('TC-CHALL-16: calculateHealthStatus strictly maps exact boundary transitions', () => {
      // 100.0 -> EXCELLENT
      assert.strictEqual(calculateHealthStatus(100.0), 'EXCELLENT');
      // 90.0 -> EXCELLENT (boundary)
      assert.strictEqual(calculateHealthStatus(90.0), 'EXCELLENT');
      // 89.999 -> GOOD
      assert.strictEqual(calculateHealthStatus(89.999), 'GOOD');
      // 75.0 -> GOOD (boundary)
      assert.strictEqual(calculateHealthStatus(75.0), 'GOOD');
      // 74.999 -> FAIR
      assert.strictEqual(calculateHealthStatus(74.999), 'FAIR');
      // 60.0 -> FAIR (boundary)
      assert.strictEqual(calculateHealthStatus(60.0), 'FAIR');
      // 59.999 -> ATTENTION_REQUIRED
      assert.strictEqual(calculateHealthStatus(59.999), 'ATTENTION_REQUIRED');
      // 40.0 -> ATTENTION_REQUIRED (boundary)
      assert.strictEqual(calculateHealthStatus(40.0), 'ATTENTION_REQUIRED');
      // 39.999 -> CRITICAL
      assert.strictEqual(calculateHealthStatus(39.999), 'CRITICAL');
      // 0.0 -> CRITICAL
      assert.strictEqual(calculateHealthStatus(0.0), 'CRITICAL');
    });

    it('TC-CHALL-17: Out-of-bounds health scores are safely clamped', () => {
      // Negative score clamped to 0 -> CRITICAL
      assert.strictEqual(calculateHealthStatus(-1), 'CRITICAL');
      assert.strictEqual(calculateHealthStatus(-100), 'CRITICAL');

      // Above 100 clamped to 100 -> EXCELLENT
      assert.strictEqual(calculateHealthStatus(105), 'EXCELLENT');
      assert.strictEqual(calculateHealthStatus(999.9), 'EXCELLENT');

      // Non-numeric / NaN
      assert.strictEqual(calculateHealthStatus(NaN), 'CRITICAL');
    });

    it('TC-CHALL-18: updateHealthScore automatically condemns component at 0.0 score', () => {
      const comp = componentRepo.registerComponent({
        serialNumber: 'WHL-HEALTH-001',
        componentType: 'WHEELSET'
      });

      const updated = componentRepo.updateHealthScore('WHL-HEALTH-001', 0.0, 'Severely shattered rim');
      assert.strictEqual(updated.healthScore, 0.0);
      assert.strictEqual(updated.healthStatus, 'CRITICAL');
      assert.strictEqual(updated.status, 'CONDEMNED');
    });

    it('TC-CHALL-19: updateHealthScore sets UNDER_MAINTENANCE when score < 40 for AVAILABLE_IN_STORES component', () => {
      const comp = componentRepo.registerComponent({
        serialNumber: 'WHL-HEALTH-002',
        componentType: 'WHEELSET'
      });
      assert.strictEqual(comp.status, 'AVAILABLE_IN_STORES');

      const updated = componentRepo.updateHealthScore('WHL-HEALTH-002', 35.0, 'Tread wear beyond RDSO limit');
      assert.strictEqual(updated.healthScore, 35.0);
      assert.strictEqual(updated.healthStatus, 'CRITICAL');
      assert.strictEqual(updated.status, 'UNDER_MAINTENANCE');
    });

    it('TC-CHALL-20: Database CHECK constraint prevents out-of-range health_score via direct SQL', () => {
      assert.throws(() => {
        db.prepare('UPDATE components SET health_score = 105.0 WHERE serial_number = ?').run('WHL-HEALTH-002');
      }, (err: any) => {
        return err.message.includes('CHECK constraint failed') || err.message.includes('constraint failed');
      });

      assert.throws(() => {
        db.prepare('UPDATE components SET health_score = -5.0 WHERE serial_number = ?').run('WHL-HEALTH-002');
      }, (err: any) => {
        return err.message.includes('CHECK constraint failed') || err.message.includes('constraint failed');
      });
    });
  });

  // =========================================================================
  // 4. Test Harness Search Filter Verification (tests/harness/audit_db.ts)
  // =========================================================================
  describe('4. Test Harness Search Filter (getAllWagons)', () => {
    it('TC-CHALL-21: getAllWagons() with no filter returns all registered wagons', () => {
      const wagons = auditDb.getAllWagons();
      assert.ok(wagons.length >= 3);
      const wagonNumbers = wagons.map(w => w.wagonNumber);
      assert.ok(wagonNumbers.includes('SECR/BOXNHL/2026/001'));
      assert.ok(wagonNumbers.includes('WR/BCN/2026/002'));
      assert.ok(wagonNumbers.includes('NR/BOXN/2026/003'));
    });

    it('TC-CHALL-22: getAllWagons({ search: "" }) with empty string returns all wagons', () => {
      const wagons = auditDb.getAllWagons({ search: '' });
      assert.ok(wagons.length >= 3);
    });

    it('TC-CHALL-23: getAllWagons({ search: "   " }) with whitespace-only returns all wagons', () => {
      const wagons = auditDb.getAllWagons({ search: '   ' });
      assert.ok(wagons.length >= 3);
    });

    it('TC-CHALL-24: getAllWagons({ search: "BOXN" }) returns matching wagons by wagon_type and wagon_number', () => {
      const wagons = auditDb.getAllWagons({ search: 'BOXN' });
      assert.ok(wagons.length >= 2);
      for (const w of wagons) {
        const matches = w.wagonNumber.includes('BOXN') || w.wagonType.includes('BOXN') || w.owningRailway.includes('BOXN');
        assert.ok(matches, `Wagon ${w.wagonNumber} must match search term 'BOXN'`);
      }
    });

    it('TC-CHALL-25: getAllWagons({ search: "secr" }) handles case variations case-insensitively', () => {
      const wagons = auditDb.getAllWagons({ search: 'secr' });
      assert.ok(wagons.length >= 1);
      const wagon = wagons.find(w => w.owningRailway === 'SECR');
      assert.ok(wagon, 'Must find wagon owned by SECR');
    });

    it('TC-CHALL-26: getAllWagons({ search: "NONEXISTENT_XYZ_9999" }) returns empty array []', () => {
      const wagons = auditDb.getAllWagons({ search: 'NONEXISTENT_XYZ_9999' });
      assert.strictEqual(wagons.length, 0);
    });

    it('TC-CHALL-27: getAllWagons combines search with stage, wagonType, and owningRailway filters', () => {
      const wagons = auditDb.getAllWagons({
        stage: 'ENTRY_REGISTRATION',
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        search: '2026'
      });
      assert.strictEqual(wagons.length, 1);
      assert.strictEqual(wagons[0].wagonNumber, 'SECR/BOXNHL/2026/001');
    });
  });

  // =========================================================================
  // 5. Query / Filter / QR Code Lookup Robustness
  // =========================================================================
  describe('5. Query & QR Lookup Robustness', () => {
    it('TC-CHALL-28: QR lookup handles exact QR, raw serial number, and pipe-delimited payload', () => {
      const comp = componentRepo.registerComponent({
        serialNumber: 'QR-TEST-001',
        componentType: 'COUPLER',
        manufacturer: 'BESCO Ltd'
      });

      // 1. Lookup by exact qr_code
      const byExactQR = componentRepo.getComponentByQR(comp.qrCode);
      assert.ok(byExactQR);
      assert.strictEqual(byExactQR.serialNumber, 'QR-TEST-001');

      // 2. Lookup by raw serial number passed to QR scanner
      const byRawSerial = componentRepo.getComponentByQR('QR-TEST-001');
      assert.ok(byRawSerial);
      assert.strictEqual(byRawSerial.serialNumber, 'QR-TEST-001');

      // 3. Lookup by pipe-delimited QR format: WRS-PASSPORT|QR-TEST-001|COUPLER|BESCO_Ltd
      const byPipe = componentRepo.getComponentByQR(`WRS-PASSPORT|QR-TEST-001|COUPLER|BESCO_Ltd`);
      assert.ok(byPipe);
      assert.strictEqual(byPipe.serialNumber, 'QR-TEST-001');

      // 4. Lookup by colon-delimited format: WRSRP-COMP:QR-TEST-001
      const byColon = componentRepo.getComponentByQR(`WRSRP-COMP:QR-TEST-001`);
      assert.ok(byColon);
      assert.strictEqual(byColon.serialNumber, 'QR-TEST-001');
    });

    it('TC-CHALL-29: Multi-criteria component filtering with pagination', () => {
      const res = componentRepo.getComponents({
        componentType: 'WHEELSET',
        page: 1,
        limit: 10,
        sortBy: 'health_score',
        sortOrder: 'DESC'
      });

      assert.ok(res.components.length >= 1);
      assert.ok(res.pagination.total >= 1);
      for (const c of res.components) {
        assert.strictEqual(c.componentType, 'WHEELSET');
      }
    });

    it('TC-CHALL-30: Component aggregate stats calculation reflects current state accurately', () => {
      const stats = componentRepo.getComponentStats();
      assert.ok(stats.totalComponents > 0);
      assert.ok(stats.availableInStores >= 0);
      assert.ok(stats.inService >= 0);
      assert.ok(stats.underMaintenance >= 0);
      assert.ok(stats.reconditioned >= 0);
      assert.ok(stats.condemned >= 0);
      assert.ok(stats.averageHealthScore >= 0 && stats.averageHealthScore <= 100);
    });
  });
});
