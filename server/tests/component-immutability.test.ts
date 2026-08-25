/**
 * SQLite Immutability Triggers & Forensic Audit Tests for Component Health Passports (Phase 3 - M1 / R4)
 * Indian Railways WRS Raipur
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { ComponentRepository } from '../src/db/componentRepository.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';

describe('Phase 3 M1: SQLite Triggers & Immutability Forensic Audit (R4)', () => {
  let db: DatabaseSync;
  let componentRepo: ComponentRepository;
  let wagonRepo: WagonRepository;

  before(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    componentRepo = new ComponentRepository(db);
    wagonRepo = new WagonRepository(db);

    wagonRepo.registerWagon({
      wagonNumber: 'SECR/BOXNHL/10001',
      wagonType: 'BOXNHL',
      owningRailway: 'SECR',
      createdBy: 'usr_insp_001'
    });

    wagonRepo.registerWagon({
      wagonNumber: 'SECR/BOXNHL/10002',
      wagonType: 'BOXNHL',
      owningRailway: 'SECR',
      createdBy: 'usr_insp_001'
    });
  });

  // -------------------------------------------------------------------------
  // 1. Immutability Triggers on component_history
  // -------------------------------------------------------------------------
  it('TC-COMP-IMM-01: trg_prevent_component_history_update blocks direct SQL UPDATE on component_history', () => {
    // 1. Register a component to create initial history
    componentRepo.registerComponent({
      serialNumber: 'WHL-IMM-2024-0001',
      componentType: 'WHEELSET'
    });

    const historyRows = db.prepare('SELECT * FROM component_history WHERE serial_number = ?').all('WHL-IMM-2024-0001') as any[];
    assert.strictEqual(historyRows.length, 1);
    const historyId = historyRows[0].id;

    // 2. Attempt malicious direct SQL UPDATE
    assert.throws(() => {
      db.prepare("UPDATE component_history SET action_details = 'Tampered log content' WHERE id = ?").run(historyId);
    }, /Component history is strictly append-only/);

    // Verify content remains pristine
    const pristine = db.prepare('SELECT action_details FROM component_history WHERE id = ?').get(historyId) as any;
    assert.notStrictEqual(pristine.action_details, 'Tampered log content');
  });

  it('TC-COMP-IMM-02: trg_prevent_component_history_delete blocks direct SQL DELETE on component_history', () => {
    const historyRows = db.prepare('SELECT * FROM component_history WHERE serial_number = ?').all('WHL-IMM-2024-0001') as any[];
    assert.strictEqual(historyRows.length, 1);
    const historyId = historyRows[0].id;

    // Attempt malicious direct SQL DELETE
    assert.throws(() => {
      db.prepare('DELETE FROM component_history WHERE id = ?').run(historyId);
    }, /Component history is strictly append-only/);

    // Verify row still exists
    const stillExists = db.prepare('SELECT id FROM component_history WHERE id = ?').get(historyId);
    assert.ok(stillExists);
  });

  // -------------------------------------------------------------------------
  // 2. Automated Lifecycle Event Triggers
  // -------------------------------------------------------------------------
  it('TC-COMP-IMM-03: trg_auto_log_component_commissioning auto-creates COMMISSIONED event on insert', () => {
    componentRepo.registerComponent({
      serialNumber: 'BRG-IMM-2024-0002',
      componentType: 'BEARING',
      manufacturer: 'SKF India'
    });

    const historyRows = db.prepare('SELECT * FROM component_history WHERE serial_number = ?').all('BRG-IMM-2024-0002') as any[];
    assert.strictEqual(historyRows.length, 1);
    assert.strictEqual(historyRows[0].event_type, 'COMMISSIONED');
    assert.strictEqual(historyRows[0].performed_by, 'SYSTEM');
    assert.ok(historyRows[0].action_details.includes('Component registered'));
  });

  it('TC-COMP-IMM-04: trg_auto_log_component_assignment_update logs ASSIGNED_TO_WAGON on wagon assignment', () => {
    // Direct SQL update to test SQLite trigger independent of repository logic
    db.prepare(`
      UPDATE components
      SET current_wagon_number = 'SECR/BOXNHL/10001',
          current_bogie_position = 'BOGIE_1',
          status = 'IN_SERVICE'
      WHERE serial_number = 'BRG-IMM-2024-0002'
    `).run();

    const historyRows = db.prepare(`
      SELECT * FROM component_history WHERE serial_number = ? ORDER BY created_at ASC
    `).all('BRG-IMM-2024-0002') as any[];

    const assignEvent = historyRows.find(h => h.event_type === 'ASSIGNED_TO_WAGON');
    assert.ok(assignEvent, 'Must record ASSIGNED_TO_WAGON history event');
    assert.strictEqual(assignEvent.wagon_number, 'SECR/BOXNHL/10001');
    assert.ok(assignEvent.action_details.includes('assigned to wagon SECR/BOXNHL/10001'));
  });

  it('TC-COMP-IMM-05: trg_auto_log_component_assignment_update logs REMOVED_FROM_WAGON on wagon unassignment', () => {
    // Direct SQL update unassigning component
    db.prepare(`
      UPDATE components
      SET current_wagon_number = NULL,
          current_bogie_position = 'NONE',
          status = 'AVAILABLE_IN_STORES'
      WHERE serial_number = 'BRG-IMM-2024-0002'
    `).run();

    const historyRows = db.prepare(`
      SELECT * FROM component_history WHERE serial_number = ? ORDER BY created_at ASC
    `).all('BRG-IMM-2024-0002') as any[];

    // COMMISSIONED, ASSIGNED_TO_WAGON, REMOVED_FROM_WAGON + status transition trigger
    const removeEvent = historyRows.find(h => h.event_type === 'REMOVED_FROM_WAGON');
    assert.ok(removeEvent);
    assert.ok(removeEvent.action_details.includes('unassigned from wagon SECR/BOXNHL/10001'));
  });

  it('TC-COMP-IMM-06: trg_auto_log_component_status_change logs CONDEMNED on condemnation', () => {
    db.prepare(`
      UPDATE components
      SET status = 'CONDEMNED', health_score = 0.0, health_status = 'CRITICAL'
      WHERE serial_number = 'BRG-IMM-2024-0002'
    `).run();

    const historyRows = db.prepare(`
      SELECT * FROM component_history WHERE serial_number = ? ORDER BY created_at ASC
    `).all('BRG-IMM-2024-0002') as any[];

    const condemnedEvent = historyRows.find(h => h.event_type === 'CONDEMNED');
    assert.ok(condemnedEvent);
    assert.ok(condemnedEvent.action_details.includes('Component status updated'));
  });

  it('TC-COMP-IMM-07: Provable end-to-end multi-cycle provenance reconstruction', () => {
    componentRepo.registerComponent({
      serialNumber: 'DGF-IMM-2024-0003',
      componentType: 'DRAFT_GEAR',
      manufacturer: 'Cardwell Westinghouse'
    });

    // 1. Assign to Wagon 10001
    componentRepo.assignComponent('DGF-IMM-2024-0003', 'SECR/BOXNHL/10001', 'BODY');

    // 2. Unassign to Stores
    componentRepo.unassignComponent('DGF-IMM-2024-0003', 'Overhaul inspection');

    // 3. Overhaul
    componentRepo.recordOverhaul('DGF-IMM-2024-0003', '2026-08-17', '2030-08-17', 100.0, 'Recalibrated');

    // 4. Reassign to Wagon 10002
    componentRepo.assignComponent('DGF-IMM-2024-0003', 'SECR/BOXNHL/10002', 'BODY');

    const componentWithHistory = componentRepo.getComponentBySerial('DGF-IMM-2024-0003', true);
    assert.ok(componentWithHistory?.history);
    assert.ok(componentWithHistory.history.length >= 4);

    // Verify chronological order
    for (let i = 0; i < componentWithHistory.history.length - 1; i++) {
      const cur = new Date(componentWithHistory.history[i].createdAt).getTime();
      const next = new Date(componentWithHistory.history[i + 1].createdAt).getTime();
      assert.ok(cur >= next, 'History entries must be returned in descending chronological order');
    }
  });
});
