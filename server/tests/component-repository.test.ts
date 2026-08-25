/**
 * Component Repository Unit Tests (Phase 3 - M1 / R4)
 * Indian Railways WRS Raipur
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { ComponentRepository, calculateHealthStatus, deriveCategoryAndPartName } from '../src/db/componentRepository.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';

describe('Phase 3 M1: Component Repository Unit Tests (R4 Serialization)', () => {
  let db: DatabaseSync;
  let componentRepo: ComponentRepository;
  let wagonRepo: WagonRepository;

  before(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    componentRepo = new ComponentRepository(db);
    wagonRepo = new WagonRepository(db);

    // Register a test wagon
    wagonRepo.registerWagon({
      wagonNumber: 'SECR/BOXNHL/99101',
      wagonType: 'BOXNHL',
      owningRailway: 'SECR',
      createdBy: 'usr_insp_001'
    });

    wagonRepo.registerWagon({
      wagonNumber: 'ECOR/BOXNHL/99102',
      wagonType: 'BOXNHL',
      owningRailway: 'ECOR',
      createdBy: 'usr_insp_001'
    });
  });

  it('TC-COMP-REPO-01: calculateHealthStatus maps scores to correct RDSO categories', () => {
    assert.strictEqual(calculateHealthStatus(100), 'EXCELLENT');
    assert.strictEqual(calculateHealthStatus(92.5), 'EXCELLENT');
    assert.strictEqual(calculateHealthStatus(90.0), 'EXCELLENT');
    assert.strictEqual(calculateHealthStatus(89.9), 'GOOD');
    assert.strictEqual(calculateHealthStatus(75.0), 'GOOD');
    assert.strictEqual(calculateHealthStatus(74.9), 'FAIR');
    assert.strictEqual(calculateHealthStatus(60.0), 'FAIR');
    assert.strictEqual(calculateHealthStatus(59.9), 'ATTENTION_REQUIRED');
    assert.strictEqual(calculateHealthStatus(40.0), 'ATTENTION_REQUIRED');
    assert.strictEqual(calculateHealthStatus(39.9), 'CRITICAL');
    assert.strictEqual(calculateHealthStatus(0.0), 'CRITICAL');
  });

  it('TC-COMP-REPO-02: deriveCategoryAndPartName returns proper default categories and part names', () => {
    const wheelset = deriveCategoryAndPartName('WHEELSET');
    assert.strictEqual(wheelset.category, 'WHEELS_AXLES');
    assert.ok(wheelset.partName.includes('Wheelset'));

    const bearing = deriveCategoryAndPartName('BEARING');
    assert.strictEqual(bearing.category, 'BEARINGS');
    assert.ok(bearing.partName.includes('CTRB'));

    const draftGear = deriveCategoryAndPartName('DRAFT_GEAR');
    assert.strictEqual(draftGear.category, 'COUPLERS_DRAFT_GEAR');

    const custom = deriveCategoryAndPartName('BRAKE_VALVE', 'BRAKE_SYSTEM', 'Custom DV Knorr');
    assert.strictEqual(custom.category, 'BRAKE_SYSTEM');
    assert.strictEqual(custom.partName, 'Custom DV Knorr');
  });

  it('TC-COMP-REPO-03: Successfully registers new serialized component with initial history event', () => {
    const comp = componentRepo.registerComponent({
      serialNumber: 'WHL-RWF-2024-1101',
      componentType: 'WHEELSET',
      manufacturer: 'Rail Wheel Factory Yelahanka',
      manufacturingDate: '2024-02-15',
      binLocation: 'BAY-W-01'
    });

    assert.ok(comp.id.startsWith('comp_'));
    assert.strictEqual(comp.serialNumber, 'WHL-RWF-2024-1101');
    assert.strictEqual(comp.componentType, 'WHEELSET');
    assert.strictEqual(comp.category, 'WHEELS_AXLES');
    assert.strictEqual(comp.status, 'AVAILABLE_IN_STORES');
    assert.strictEqual(comp.currentWagonNumber, null);
    assert.strictEqual(comp.healthScore, 100.0);
    assert.strictEqual(comp.healthStatus, 'EXCELLENT');
    assert.strictEqual(comp.binLocation, 'BAY-W-01');

    // Verify auto-trigger history entry
    const fetched = componentRepo.getComponentBySerial('WHL-RWF-2024-1101', true);
    assert.ok(fetched);
    assert.ok(fetched.history);
    assert.strictEqual(fetched.history.length, 1);
    assert.strictEqual(fetched.history[0].eventType, 'COMMISSIONED');
    assert.strictEqual(fetched.history[0].serialNumber, 'WHL-RWF-2024-1101');
  });

  it('TC-COMP-REPO-04: Rejects duplicate serial registration with descriptive conflict error', () => {
    assert.throws(() => {
      componentRepo.registerComponent({
        serialNumber: 'WHL-RWF-2024-1101',
        componentType: 'WHEELSET'
      });
    }, /COMPONENT_ALREADY_EXISTS/);
  });

  it('TC-COMP-REPO-05: Retrieves component by serial number, ID, and QR code payload', () => {
    const comp = componentRepo.registerComponent({
      serialNumber: 'BRG-SKF-2024-2201',
      componentType: 'BEARING',
      manufacturer: 'SKF India'
    });

    const bySerial = componentRepo.getComponentBySerial('brg-skf-2024-2201');
    assert.ok(bySerial);
    assert.strictEqual(bySerial.id, comp.id);

    const byId = componentRepo.getComponentById(comp.id);
    assert.ok(byId);
    assert.strictEqual(byId.serialNumber, 'BRG-SKF-2024-2201');

    const byQrExact = componentRepo.getComponentByQR(comp.qrCode);
    assert.ok(byQrExact);
    assert.strictEqual(byQrExact.id, comp.id);

    const byQrStructured = componentRepo.getComponentByQR('WRS-PASSPORT|BRG-SKF-2024-2201|BEARING|SKF_INDIA');
    assert.ok(byQrStructured);
    assert.strictEqual(byQrStructured.id, comp.id);
  });

  it('TC-COMP-REPO-06: Multi-criteria query and pagination support', () => {
    componentRepo.registerComponent({
      serialNumber: 'DGF-CW-2024-3301',
      componentType: 'DRAFT_GEAR',
      manufacturer: 'Cardwell Westinghouse',
      binLocation: 'BAY-D-01'
    });

    componentRepo.registerComponent({
      serialNumber: 'CBC-TRSL-2024-4401',
      componentType: 'COUPLER',
      manufacturer: 'Titagarh Rail Systems',
      binLocation: 'BAY-C-01'
    });

    // Query all components
    const all = componentRepo.getComponents({ page: 1, limit: 10 });
    assert.ok(all.components.length >= 4);
    assert.strictEqual(all.pagination.page, 1);

    // Filter by type
    const draftGears = componentRepo.getComponents({ componentType: 'DRAFT_GEAR' });
    assert.strictEqual(draftGears.components.length, 1);
    assert.strictEqual(draftGears.components[0].serialNumber, 'DGF-CW-2024-3301');

    // Search query
    const searched = componentRepo.getComponents({ search: 'Westinghouse' });
    assert.strictEqual(searched.components.length, 1);
    assert.strictEqual(searched.components[0].serialNumber, 'DGF-CW-2024-3301');
  });

  it('TC-COMP-REPO-07: Assigns component to wagon and verifies automated lifecycle trigger', () => {
    const assigned = componentRepo.assignComponent(
      'WHL-RWF-2024-1101',
      'SECR/BOXNHL/99101',
      'BOGIE_1',
      'REASSEMBLY',
      'Wheelset installed during bogie assembly',
      'usr_insp_001',
      'Ramesh Kumar'
    );

    assert.strictEqual(assigned.currentWagonNumber, 'SECR/BOXNHL/99101');
    assert.strictEqual(assigned.currentBogiePosition, 'BOGIE_1');
    assert.strictEqual(assigned.status, 'IN_SERVICE');

    // Check wagon components query
    const wagonComponents = componentRepo.getComponentsByWagon('SECR/BOXNHL/99101');
    assert.strictEqual(wagonComponents.length, 1);
    assert.strictEqual(wagonComponents[0].serialNumber, 'WHL-RWF-2024-1101');

    // Verify history contains ASSIGNED_TO_WAGON
    const historyDetail = componentRepo.getComponentBySerial('WHL-RWF-2024-1101', true);
    assert.ok(historyDetail?.history);
    const assignEvent = historyDetail.history.find(h => h.eventType === 'ASSIGNED_TO_WAGON');
    assert.ok(assignEvent);
    assert.strictEqual(assignEvent.wagonNumber, 'SECR/BOXNHL/99101');
  });

  it('TC-COMP-REPO-08: Inter-wagon component transfer records full audit trail', () => {
    // Reassign from Wagon 99101 to Wagon 99102
    const transferred = componentRepo.assignComponent(
      'WHL-RWF-2024-1101',
      'ECOR/BOXNHL/99102',
      'BOGIE_2',
      'REASSEMBLY',
      'Transferred to Wagon 99102 after Bogie 2 rebalancing',
      'usr_sup_001',
      'S. K. Verma'
    );

    assert.strictEqual(transferred.currentWagonNumber, 'ECOR/BOXNHL/99102');
    assert.strictEqual(transferred.currentBogiePosition, 'BOGIE_2');

    // Verify old wagon no longer has the component
    const oldWagonComps = componentRepo.getComponentsByWagon('SECR/BOXNHL/99101');
    assert.strictEqual(oldWagonComps.length, 0);

    // Verify new wagon has the component
    const newWagonComps = componentRepo.getComponentsByWagon('ECOR/BOXNHL/99102');
    assert.strictEqual(newWagonComps.length, 1);
  });

  it('TC-COMP-REPO-09: Unassigns component from wagon and returns it to stores', () => {
    const unassigned = componentRepo.unassignComponent(
      'WHL-RWF-2024-1101',
      'Removed for routine 100k km inspection',
      'AVAILABLE_IN_STORES',
      'Stored in Wheelset Bay W1',
      'usr_insp_001',
      'Ramesh Kumar'
    );

    assert.strictEqual(unassigned.currentWagonNumber, null);
    assert.strictEqual(unassigned.currentBogiePosition, 'NONE');
    assert.strictEqual(unassigned.status, 'AVAILABLE_IN_STORES');

    const historyDetail = componentRepo.getComponentBySerial('WHL-RWF-2024-1101', true);
    assert.ok(historyDetail?.history);
    const removeEvent = historyDetail.history.find(h => h.eventType === 'REMOVED_FROM_WAGON');
    assert.ok(removeEvent);
  });

  it('TC-COMP-REPO-10: Updates health score and automatically updates status and healthStatus', () => {
    const updated = componentRepo.updateHealthScore(
      'BRG-SKF-2024-2201',
      55.0,
      'Moderate roller surface wear observed during Stage 3 inspection',
      'usr_insp_002',
      'Praveen Singh'
    );

    assert.strictEqual(updated.healthScore, 55.0);
    assert.strictEqual(updated.healthStatus, 'ATTENTION_REQUIRED');

    // Condemn with 0 score
    const condemned = componentRepo.updateHealthScore(
      'BRG-SKF-2024-2201',
      0.0,
      'Severe spalling and cage fracture',
      'usr_insp_002',
      'Praveen Singh'
    );

    assert.strictEqual(condemned.healthScore, 0.0);
    assert.strictEqual(condemned.healthStatus, 'CRITICAL');
    assert.strictEqual(condemned.status, 'CONDEMNED');
  });

  it('TC-COMP-REPO-11: Records POH overhaul restoration and increments overhaulCount', () => {
    const overhauled = componentRepo.recordOverhaul(
      'DGF-CW-2024-3301',
      '2026-08-17',
      '2030-02-17',
      98.0,
      'Complete friction block renewal and spring pack recalibration',
      'usr_sup_001',
      'S. K. Verma'
    );

    assert.strictEqual(overhauled.overhaulCount, 1);
    assert.strictEqual(overhauled.status, 'RECONDITIONED');
    assert.strictEqual(overhauled.healthScore, 98.0);
    assert.strictEqual(overhauled.healthStatus, 'EXCELLENT');
    assert.strictEqual(overhauled.lastPohDate, '2026-08-17');
    assert.strictEqual(overhauled.nextPohDue, '2030-02-17');
  });

  it('TC-COMP-REPO-12: Calculates accurate workshop statistics aggregates', () => {
    const stats = componentRepo.getComponentStats();
    assert.ok(stats.totalComponents >= 4);
    assert.ok(stats.condemned >= 1);
    assert.ok(stats.reconditioned >= 1);
    assert.ok(stats.averageHealthScore > 0);
  });
});
