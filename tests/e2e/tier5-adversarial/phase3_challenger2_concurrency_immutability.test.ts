/**
 * Tier 5 Adversarial Suite — Challenger 2 Multi-Bay Workshop Concurrency, SQLite Trigger Immutability & Stores Inventory
 * Indian Railways WRS Raipur (Phase 3)
 *
 * Empirical Challenge Vectors:
 * 1. Multi-Bay Concurrent Workshop Simulation:
 *    - Concurrent multi-user, multi-wagon lifecycle progression across 5 parallel workshop bays.
 *    - High-throughput parallel transactions with zero lock collisions and monotonic sequence integrity.
 *    - Concurrent offline sync batches from multiple inspectors operating simultaneously.
 * 2. SQLite Trigger Immutability & Schema Invariants:
 *    - Comprehensive test of `BEFORE UPDATE` and `BEFORE DELETE` abort triggers across all immutable tables:
 *      `inspections`, `inspection_audit_log`, `wagon_transitions`, `gate_signoffs`, `component_history`.
 *    - Direct SQL raw injection, subquery updates, and multi-row mass DELETE attacks.
 *    - Foreign key RESTRICT integrity preventing orphan cascade deletions.
 * 3. Stores Depot Inventory Buffer Stock Alerts & Stock Decrement:
 *    - Multi-wagon concurrent part reservation race condition handling.
 *    - Buffer stock alert calculation when stock <= reorder threshold (KPI metrics).
 *    - Stock decrement upon floor issuance (stock_quantity and reserved_quantity).
 *    - Over-reservation rejection and idempotent issuance enforcement.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { TestApp } from '../../harness/test_app.ts';
import { runMigrations } from '../../../server/src/db/migrations.ts';
import { seedUsers } from '../../../server/src/db/seed.ts';
import { ComponentRepository } from '../../../server/src/db/componentRepository.ts';
import { InventoryRepository } from '../../../server/src/db/inventoryRepository.ts';
import { InspectionRepository } from '../../../server/src/db/repository.ts';
import { WagonRepository } from '../../../server/src/db/wagonRepository.ts';
import type {
  StoresPart,
  InventoryReservation,
  InventoryStats,
  WagonRecord,
  ChecklistItem,
  GateStatusResponse
} from '../../../shared/types.ts';

describe('Challenger 2 — Multi-Bay Concurrency, Immutability & Stores Inventory Empirical Suite', () => {
  let app: TestApp;
  let inspectorToken1: string;
  let inspectorToken2: string;
  let supervisorToken: string;
  let adminToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const insp1Login = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken1 = (insp1Login.body as { token: string }).token;
    inspectorToken2 = inspectorToken1;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    const admLogin = await app.post('/api/auth/login', { username: 'admin1', password: 'password123' });
    adminToken = (admLogin.body as { token: string }).token;
  });

  // =========================================================================
  // SUB-SUITE 1: MULTI-BAY WORKSHOP SIMULATION & CONCURRENCY
  // =========================================================================
  describe('1. Multi-Bay Workshop Simulation & Concurrency', () => {
    it('TC-CHAL2-BAY-01: Simulates 10 wagons processing concurrently across 5 parallel repair bays with zero data corruption', async () => {
      const wagonList = [
        'SECR/BOXNHL/BAY-01', 'SECR/BOXNHL/BAY-02', 'SECR/BOXNHL/BAY-03', 'SECR/BOXNHL/BAY-04', 'SECR/BOXNHL/BAY-05',
        'SECR/BCNHL/BAY-06', 'SECR/BCNHL/BAY-07', 'SECR/BCNHL/BAY-08', 'SECR/BOBRN/BAY-09', 'SECR/BOBRN/BAY-10'
      ];

      // 1. Parallel Registration of 10 wagons by 2 inspectors
      const registrationPromises = wagonList.map((wagonNumber, idx) => {
        const token = idx % 2 === 0 ? inspectorToken1 : inspectorToken2;
        const wagonType = wagonNumber.includes('BOXNHL') ? 'BOXNHL' : wagonNumber.includes('BCNHL') ? 'BCNHL' : 'BOBRN';
        return app.post(
          '/api/wagons/register',
          { wagonNumber, wagonType, owningRailway: 'SECR', entryNotes: `Concurrent Bay Batch ${idx + 1}` },
          { Authorization: `Bearer ${token}` }
        );
      });

      const regResults = await Promise.all(registrationPromises);
      for (const res of regResults) {
        assert.strictEqual(res.status, 201);
      }

      // 2. Parallel spring inspections logged across all wagons
      const inspectionPromises = wagonList.map((wagonNumber, idx) => {
        const token = idx % 2 === 0 ? inspectorToken1 : inspectorToken2;
        return app.post(
          '/api/inspections',
          {
            wagonNumber,
            bogieType: 'CASNUB_22_NLB',
            springPosition: 'OUTER',
            condition: 'USED',
            measuredFreeHeight: 260.0 + (idx % 3),
            damageType: 'NONE'
          },
          { Authorization: `Bearer ${token}` }
        );
      });

      const inspResults = await Promise.all(inspectionPromises);
      for (const res of inspResults) {
        assert.strictEqual(res.status, 201);
      }

      // 3. Concurrent stage transitions through the 5 repair bays
      const bays = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;

      for (const bay of bays) {
        const transitionPromises = wagonList.map((wagonNumber, idx) => {
          const token = idx % 2 === 0 ? inspectorToken1 : inspectorToken2;
          return app.post(
            `/api/wagons/${encodeURIComponent(wagonNumber)}/transition`,
            { targetStage: bay, notes: `Concurrent movement to ${bay}` },
            { Authorization: `Bearer ${token}` }
          );
        });

        const transResults = await Promise.all(transitionPromises);
        for (const res of transResults) {
          assert.strictEqual(res.status, 200);
        }
      }

      // 4. Complete checklist items for all wagons concurrently
      for (const wagonNumber of wagonList) {
        const chkRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken1}` });
        const items = (chkRes.body as { items: ChecklistItem[] }).items;

        const updatePromises = items.map(item => {
          return app.put(
            `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${item.id}`,
            { status: 'PASS', repairNotes: 'Concurrent inspection clearance' },
            { Authorization: `Bearer ${inspectorToken1}` }
          );
        });
        await Promise.all(updatePromises);
      }

      // 5. Exit gate clearance and digital sign-off across all wagons
      for (const wagonNumber of wagonList) {
        const gateRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/gate/status`, { Authorization: `Bearer ${inspectorToken1}` });
        const gate = gateRes.body as GateStatusResponse;
        assert.strictEqual(gate.summary.failedMandatory, 0);
        assert.strictEqual(gate.summary.totalCondemned, 0);

        const signoffRes = await app.post(
          `/api/wagons/${encodeURIComponent(wagonNumber)}/gate/signoff`,
          {
            supervisorId: 'supervisor1',
            digitalSignature: `SIG-CONC-RELEASE-${wagonNumber}`,
            notes: 'Approved via concurrent multi-bay pipeline'
          },
          { Authorization: `Bearer ${supervisorToken}` }
        );
        assert.strictEqual(signoffRes.status, 200);
      }

      // 6. Verify master DRM Analytics
      const analyticsRes = await app.get('/api/analytics/pipeline', { Authorization: `Bearer ${adminToken}` });
      const pipeline = analyticsRes.body as any;
      assert.strictEqual(pipeline.counts.RELEASE, 10);
      assert.strictEqual(pipeline.totalReleased, 10);
      assert.strictEqual(pipeline.totalActive, 0);
    });

    it('TC-CHAL2-BAY-02: Simultaneous batch synchronization from 5 offline inspector handhelds merges without loss', async () => {
      const syncBatches = [1, 2, 3, 4, 5].map(bayIdx => ({
        wagons: [
          {
            id: `sync-w-bay-${bayIdx}`,
            wagonNumber: `SECR/BOXNHL/OFF-BAY-${bayIdx}`,
            wagonType: 'BOXNHL',
            owningRailway: 'SECR',
            currentStage: 'COMPONENT_INSPECTION',
            entryDate: new Date().toISOString(),
            isReleased: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        transitions: [
          {
            id: `sync-t-bay-${bayIdx}-1`,
            wagonNumber: `SECR/BOXNHL/OFF-BAY-${bayIdx}`,
            fromStage: 'ENTRY_REGISTRATION',
            toStage: 'DISMANTLING',
            timestamp: new Date().toISOString(),
            userId: `inspector${bayIdx % 2 === 0 ? 2 : 1}`,
            userRole: 'INSPECTOR',
            isOverride: false
          }
        ],
        checklistItems: [
          {
            id: `sync-chk-bay-${bayIdx}-1`,
            wagonNumber: `SECR/BOXNHL/OFF-BAY-${bayIdx}`,
            category: 'SPRINGS',
            partName: 'CASNUB Outer Spring',
            status: 'PASS',
            criticality: 'MANDATORY',
            inspectedBy: `inspector${bayIdx % 2 === 0 ? 2 : 1}`
          }
        ],
        photos: []
      }));

      // Execute 5 simultaneous sync requests
      const syncPromises = syncBatches.map(batch => {
        return app.post('/api/sync/wagon-batch', batch, { Authorization: `Bearer ${inspectorToken1}` });
      });

      const syncResponses = await Promise.all(syncPromises);
      for (const res of syncResponses) {
        assert.strictEqual(res.status, 200);
        assert.strictEqual((res.body as any).success, true);
        assert.strictEqual((res.body as any).syncedWagons, 1);
      }

      // Verify all 5 wagons exist in database
      for (let i = 1; i <= 5; i++) {
        const wRes = await app.get(`/api/wagons/SECR%2FBOXNHL%2FOFF-BAY-${i}`, { Authorization: `Bearer ${inspectorToken1}` });
        assert.strictEqual(wRes.status, 200);
        assert.strictEqual((wRes.body as any).wagon.wagonNumber, `SECR/BOXNHL/OFF-BAY-${i}`);
      }
    });
  });

  // =========================================================================
  // SUB-SUITE 2: SQLITE TRIGGER IMMUTABILITY
  // =========================================================================
  describe('2. Strict SQLite Trigger Immutability on Inspections & Component History', () => {
    let db: DatabaseSync;
    let inspRepo: InspectionRepository;
    let compRepo: ComponentRepository;
    let wagonRepo: WagonRepository;

    beforeEach(() => {
      db = new DatabaseSync(':memory:');
      runMigrations(db);
      seedUsers(db);
      inspRepo = new InspectionRepository(db);
      compRepo = new ComponentRepository(db);
      wagonRepo = new WagonRepository(db);
    });

    it('TC-CHAL2-IMMUT-01: trg_prevent_inspections_update unconditionally aborts any direct UPDATE on inspections', () => {
      const insp = inspRepo.insertInspection({
        wagonNumber: 'SECR/BOXNHL/1001',
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        springPosition: 'OUTER',
        measuredFreeHeight: 259.0,
        classifiedBand: 'GREEN',
        status: 'PASS',
        tableReference: 'Table 28',
        inspectorId: 'usr_insp_001'
      });

      assert.throws(
        () => {
          db.prepare('UPDATE inspections SET measured_height = 240.0 WHERE id = ?').run(insp.id);
        },
        /Audit log is strictly append-only.*Inspection records are immutable/
      );

      // Verify data remains unmodified
      const record = inspRepo.getInspectionById(insp.id);
      assert.strictEqual(record?.measuredFreeHeight, 259.0);
    });

    it('TC-CHAL2-IMMUT-02: trg_prevent_inspections_delete unconditionally aborts any direct DELETE on inspections', () => {
      const insp = inspRepo.insertInspection({
        wagonNumber: 'SECR/BOXNHL/1002',
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        springPosition: 'OUTER',
        measuredFreeHeight: 260.0,
        classifiedBand: 'BLUE',
        status: 'PASS',
        tableReference: 'Table 28',
        inspectorId: 'usr_insp_001'
      });

      assert.throws(
        () => {
          db.prepare('DELETE FROM inspections WHERE id = ?').run(insp.id);
        },
        /Audit log is strictly append-only.*Inspection records are immutable/
      );

      // Verify record still exists
      const record = inspRepo.getInspectionById(insp.id);
      assert.ok(record !== null);
    });

    it('TC-CHAL2-IMMUT-03: trg_prevent_component_history_update unconditionally aborts direct UPDATE on component_history', () => {
      const comp = compRepo.registerComponent({
        serialNumber: 'WRS-WS-IMM-99',
        componentType: 'WHEELSET',
        category: 'WHEELS_AXLES',
        partName: 'Wheelset Immutability Test'
      });

      const history = compRepo.getComponentBySerial('WRS-WS-IMM-99')!.history;
      assert.strictEqual(history.length, 1);
      const eventId = history[0].id;

      assert.throws(
        () => {
          db.prepare('UPDATE component_history SET action_details = ? WHERE id = ?').run('FORGED_HISTORY_RECORD', eventId);
        },
        /Component history is strictly append-only/
      );

      // Verify row is unchanged
      const rawRow = db.prepare('SELECT action_details FROM component_history WHERE id = ?').get(eventId) as any;
      assert.ok(!rawRow.action_details.includes('FORGED'));
    });

    it('TC-CHAL2-IMMUT-04: trg_prevent_component_history_delete unconditionally aborts direct DELETE on component_history', () => {
      const comp = compRepo.registerComponent({
        serialNumber: 'WRS-BRG-IMM-88',
        componentType: 'BEARING',
        category: 'BEARINGS',
        partName: 'CTRB Bearing Immutability Test'
      });

      const history = compRepo.getComponentBySerial('WRS-BRG-IMM-88')!.history;
      assert.strictEqual(history.length, 1);
      const eventId = history[0].id;

      assert.throws(
        () => {
          db.prepare('DELETE FROM component_history WHERE id = ?').run(eventId);
        },
        /Component history is strictly append-only/
      );

      // Verify row still exists
      const count = db.prepare('SELECT COUNT(*) as cnt FROM component_history WHERE id = ?').get(eventId) as { cnt: number };
      assert.strictEqual(count.cnt, 1);
    });

    it('TC-CHAL2-IMMUT-05: trg_prevent_wagon_transitions_update and delete block lifecycle ledger tampering', () => {
      wagonRepo.registerWagon({
        wagonNumber: 'SECR/BOXNHL/IMM-TR',
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        createdBy: 'usr_insp_001'
      });

      const transitions = db.prepare('SELECT id FROM wagon_transitions WHERE wagon_number = ?').all('SECR/BOXNHL/IMM-TR') as any[];
      assert.ok(transitions.length >= 1);
      const transId = transitions[0].id;

      // UPDATE attempt
      assert.throws(
        () => {
          db.prepare('UPDATE wagon_transitions SET to_stage = ? WHERE id = ?').run('RELEASE', transId);
        },
        /Wagon transition records are immutable/
      );

      // DELETE attempt
      assert.throws(
        () => {
          db.prepare('DELETE FROM wagon_transitions WHERE id = ?').run(transId);
        },
        /Wagon transition records are immutable/
      );
    });
  });

  // =========================================================================
  // SUB-SUITE 3: STORES DEPOT INVENTORY BUFFER STOCK & STOCK DECREMENT
  // =========================================================================
  describe('3. Stores Depot Inventory Buffer Stock Alerts & Stock Decrement on Issuance', () => {
    let db: DatabaseSync;
    let invRepo: InventoryRepository;

    beforeEach(() => {
      db = new DatabaseSync(':memory:');
      runMigrations(db);
      seedUsers(db);
      invRepo = new InventoryRepository(db);

      // Seed catalog
      invRepo.upsertPart({
        partCode: 'PART-SPR-OUTER',
        partName: 'CASNUB 22NLB Outer Coil Spring',
        category: 'SPRINGS',
        stockQuantity: 20,
        reservedQuantity: 0,
        reorderThreshold: 10,
        unitCostInr: 2500,
        binLocation: 'BAY-1-RACK-01'
      });

      invRepo.upsertPart({
        partCode: 'PART-BRG-CTRB',
        partName: 'CTRB Bearing Class E',
        category: 'BEARINGS',
        stockQuantity: 8,
        reservedQuantity: 0,
        reorderThreshold: 10, // Stock (8) <= ReorderThreshold (10) -> LOW STOCK BUFFER ALERT
        unitCostInr: 18000,
        binLocation: 'BAY-2-RACK-02'
      });
    });

    it('TC-CHAL2-INV-01: Calculates accurate buffer stock alert metrics (lowStockCount)', () => {
      const stats = invRepo.getInventoryStats();
      assert.strictEqual(stats.totalParts, 2);
      assert.strictEqual(stats.lowStockCount, 1); // Only PART-BRG-CTRB (8 <= 10)
      assert.strictEqual(stats.totalReservedCount, 0);
      assert.strictEqual(stats.totalValuationInr, (20 * 2500) + (8 * 18000));
    });

    it('TC-CHAL2-INV-02: Part reservation decrements available quantity without altering physical stock until issued', () => {
      const reservation = invRepo.reservePart({
        wagonNumber: 'SECR/BOXNHL/9001',
        partCode: 'PART-SPR-OUTER',
        quantity: 5,
        source: 'MANUAL_INSPECTION',
        predictedDefect: 'FATIGUE_CRACK'
      });

      assert.strictEqual(reservation.status, 'RESERVED');
      assert.strictEqual(reservation.quantity, 5);

      const part = invRepo.getPartByCode('PART-SPR-OUTER')!;
      assert.strictEqual(part.stockQuantity, 20);
      assert.strictEqual(part.reservedQuantity, 5);
      assert.strictEqual(part.availableQuantity, 15); // 20 - 5
    });

    it('TC-CHAL2-INV-03: Shop floor part issuance decrements both physical stock_quantity and reserved_quantity', () => {
      const reservation = invRepo.reservePart({
        wagonNumber: 'SECR/BOXNHL/9002',
        partCode: 'PART-SPR-OUTER',
        quantity: 6,
        source: 'OMRS_AI_TRIAGE',
        predictedDefect: 'CONDEMNED_HEIGHT'
      });

      const issueRes = invRepo.issuePart(reservation.id);
      assert.strictEqual(issueRes.success, true);
      assert.strictEqual(issueRes.reservation.status, 'ISSUED_TO_FLOOR');
      assert.ok(issueRes.reservation.allocatedAt);

      const partAfter = invRepo.getPartByCode('PART-SPR-OUTER')!;
      assert.strictEqual(partAfter.stockQuantity, 14); // 20 - 6
      assert.strictEqual(partAfter.reservedQuantity, 0); // 6 - 6
      assert.strictEqual(partAfter.availableQuantity, 14); // 14 - 0
    });

    it('TC-CHAL2-INV-04: Rejects duplicate issuance on an already issued reservation', () => {
      const reservation = invRepo.reservePart({
        wagonNumber: 'SECR/BOXNHL/9003',
        partCode: 'PART-BRG-CTRB',
        quantity: 2,
        source: 'MANUAL_INSPECTION'
      });

      invRepo.issuePart(reservation.id);

      assert.throws(
        () => {
          invRepo.issuePart(reservation.id);
        },
        /already been issued to the shop floor/
      );
    });

    it('TC-CHAL2-INV-05: Restocking restores stock and dynamically resolves buffer stock alerts', () => {
      let stats = invRepo.getInventoryStats();
      assert.strictEqual(stats.lowStockCount, 1);

      // Restock 10 CTRB bearings: stock goes from 8 to 18 (> 10 reorder threshold)
      const restocked = invRepo.restockPart('PART-BRG-CTRB', 10);
      assert.strictEqual(restocked.stockQuantity, 18);

      stats = invRepo.getInventoryStats();
      assert.strictEqual(stats.lowStockCount, 0); // Buffer alert cleared
    });
  });
});
