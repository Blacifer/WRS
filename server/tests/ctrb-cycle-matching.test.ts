/**
 * CTRB Overhaul Cycle Matching
 * Indian Railways WRS Raipur
 *
 * WMM 2.0 Chapter 6 keeps a physical record of how far through its overhaul
 * cycle a bearing is, in paint: at POH the end cap screws are a must-change
 * item and go on unpainted; at each subsequent ROH one more screw head is
 * painted golden yellow.
 *
 * Clause (f): "While fitting CTRBs back into a wagon in ROH depots, it must be
 * ensured that only CTRB with cap screws having one particular type of
 * painting scheme are strictly placed under a wagon undergoing ROH."
 *
 * That is a matched-set rule of exactly the same shape as the spring nest
 * rule — and it is currently enforced by counting paint on a shed floor, with
 * compliance verified by sample check under clause (i). Clause (e) even admits
 * the identity gets lost while wheels move around without end caps.
 *
 * The passport already knows which bearings are under which wagon. It just had
 * to be asked.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import { ComponentRepository } from '../src/db/componentRepository.ts';

describe('CTRB Overhaul Cycle Matching', () => {
  let db: DatabaseSync;
  let wagons: WagonRepository;
  let components: ComponentRepository;
  const wagon = 'SECR/CTRB/1';

  /** Registers a bearing and fits it to the wagon at the given ROH cycle. */
  const fitBearing = (serial: string, cycles: number) => {
    components.registerComponent({
      serialNumber: serial,
      componentType: 'BEARING',
      category: 'BEARINGS',
      partName: 'CTRB Cartridge Bearing',
      manufacturingDate: '2020-01-01',
      manufacturer: 'NBC'
    } as any);
    for (let i = 0; i < cycles; i++) {
      components.recordRoh(serial, 'usr_insp_001', 'Ramesh Kumar');
    }
    db.prepare(`
      UPDATE components SET current_wagon_number = ?, status = 'IN_SERVICE', current_bogie_position = 'BOGIE_1'
      WHERE serial_number = ?
    `).run(wagon, serial);
  };

  const cycleBlockers = () =>
    wagons.evaluateExitGate(wagon).blockers.filter((b: string) => /overhaul cycle/i.test(b));

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    wagons = new WagonRepository(db);
    components = new ComponentRepository(db);
    wagons.registerWagon({ wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_001' });
  });

  it('TC-CTRB-01: bearings at the same cycle pass', () => {
    fitBearing('CTRB-A', 1);
    fitBearing('CTRB-B', 1);
    fitBearing('CTRB-C', 1);
    fitBearing('CTRB-D', 1);
    assert.deepStrictEqual(cycleBlockers(), []);
  });

  it('TC-CTRB-02: one bearing at a different cycle blocks the wagon', () => {
    // Three bearings one ROH from POH, one straight out of POH. Every bearing
    // is individually serviceable; the set is not permitted.
    fitBearing('CTRB-A', 1);
    fitBearing('CTRB-B', 1);
    fitBearing('CTRB-C', 1);
    fitBearing('CTRB-D', 0);

    const b = cycleBlockers();
    assert.strictEqual(b.length, 1);
    assert.match(b[0], /different points in their overhaul cycle/);
    assert.match(b[0], /WMM 2\.0 Chapter 6/);
  });

  it('TC-CTRB-03: the blocker describes the paint, not just a number', () => {
    // A fitter reads screws, not integers. "no screws painted" and "1 screw
    // painted" is checkable at the wagon; "cycle 0 and cycle 1" is not.
    fitBearing('CTRB-A', 0);
    fitBearing('CTRB-B', 2);

    const detail = wagons
      .evaluateExitGate(wagon)
      .blockerDetails.find((d: any) => d.issueType === 'CTRB_CYCLE_MISMATCH')!;

    assert.match(detail.description, /no screws painted/);
    assert.match(detail.description, /2 screws painted/);
    assert.match(detail.description, /CTRB-A/);
    assert.match(detail.description, /CTRB-B/);
  });

  it('TC-CTRB-04: a wagon with no bearing passports is not judged', () => {
    // Absence of data is not evidence of a mismatch. Blocking here would
    // detain every wagon whose bearings are not yet serialised.
    assert.deepStrictEqual(cycleBlockers(), []);
  });

  it('TC-CTRB-05: a single bearing cannot mismatch itself', () => {
    fitBearing('CTRB-A', 2);
    assert.deepStrictEqual(cycleBlockers(), []);
  });

  it('TC-CTRB-06: a condemned bearing does not drag the set into a mismatch', () => {
    // It is already blocked on its own and is coming off the wagon.
    fitBearing('CTRB-A', 1);
    fitBearing('CTRB-B', 1);
    fitBearing('CTRB-C', 3);
    db.prepare("UPDATE components SET status = 'CONDEMNED' WHERE serial_number = 'CTRB-C'").run();
    assert.deepStrictEqual(cycleBlockers(), []);
  });

  it('TC-CTRB-07: bearings on another wagon are irrelevant', () => {
    fitBearing('CTRB-A', 1);
    fitBearing('CTRB-B', 1);

    wagons.registerWagon({ wagonNumber: 'SECR/CTRB/2', wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_001' });
    components.registerComponent({
      serialNumber: 'CTRB-OTHER', componentType: 'BEARING', category: 'BEARINGS',
      partName: 'CTRB Cartridge Bearing', manufacturingDate: '2020-01-01', manufacturer: 'NBC'
    } as any);
    db.prepare("UPDATE components SET current_wagon_number = 'SECR/CTRB/2', status = 'IN_SERVICE' WHERE serial_number = 'CTRB-OTHER'").run();

    assert.deepStrictEqual(cycleBlockers(), [], 'another wagon must not affect this one');
  });

  // -------------------------------------------------------------------------
  // The cycle counter itself
  // -------------------------------------------------------------------------
  it('TC-CTRB-08: an ROH adds one painted screw', () => {
    components.registerComponent({
      serialNumber: 'CTRB-X', componentType: 'BEARING', category: 'BEARINGS',
      partName: 'CTRB Cartridge Bearing', manufacturingDate: '2020-01-01', manufacturer: 'NBC'
    } as any);

    let c: any = components.getComponentBySerial('CTRB-X', false);
    assert.strictEqual(c.rohCyclesSincePoh, 0, 'a new bearing starts unpainted');

    components.recordRoh('CTRB-X', 'usr_insp_001', 'Ramesh Kumar');
    c = components.getComponentBySerial('CTRB-X', false);
    assert.strictEqual(c.rohCyclesSincePoh, 1);
  });

  it('TC-CTRB-09: POH resets the count — the screws are replaced unpainted', () => {
    components.registerComponent({
      serialNumber: 'CTRB-Y', componentType: 'BEARING', category: 'BEARINGS',
      partName: 'CTRB Cartridge Bearing', manufacturingDate: '2020-01-01', manufacturer: 'NBC'
    } as any);
    components.recordRoh('CTRB-Y', 'usr_insp_001', 'R');
    components.recordRoh('CTRB-Y', 'usr_insp_001', 'R');
    assert.strictEqual((components.getComponentBySerial('CTRB-Y', false) as any).rohCyclesSincePoh, 2);

    components.recordOverhaul('CTRB-Y');
    const after: any = components.getComponentBySerial('CTRB-Y', false);
    assert.strictEqual(after.rohCyclesSincePoh, 0, 'end cap screws are a must-change item at POH');
    assert.strictEqual(after.overhaulCount, 1, 'the POH itself is still counted');
  });

  it('TC-CTRB-10: a fourth ROH is refused rather than silently recorded', () => {
    // The manual describes at most three ROH schedules within a POH cycle. A
    // bearing apparently on its fourth is a data fault worth surfacing.
    components.registerComponent({
      serialNumber: 'CTRB-Z', componentType: 'BEARING', category: 'BEARINGS',
      partName: 'CTRB Cartridge Bearing', manufacturingDate: '2020-01-01', manufacturer: 'NBC'
    } as any);
    for (let i = 0; i < 3; i++) components.recordRoh('CTRB-Z', 'usr_insp_001', 'R');

    assert.throws(
      () => components.recordRoh('CTRB-Z', 'usr_insp_001', 'R'),
      /already completed 3 ROH cycles/
    );
  });

  it('TC-CTRB-11: the database refuses an out-of-range cycle count', () => {
    components.registerComponent({
      serialNumber: 'CTRB-W', componentType: 'BEARING', category: 'BEARINGS',
      partName: 'CTRB Cartridge Bearing', manufacturingDate: '2020-01-01', manufacturer: 'NBC'
    } as any);
    assert.throws(
      () => db.prepare("UPDATE components SET roh_cycles_since_poh = 7 WHERE serial_number = 'CTRB-W'").run(),
      /CHECK constraint failed/
    );
  });
});
