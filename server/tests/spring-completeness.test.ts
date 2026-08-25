/**
 * Spring Completeness & Per-Spring Visibility Tests
 * Indian Railways WRS Raipur
 *
 * Two defects are pinned here, both of which let an unsafe wagon through:
 *
 *   1. Twelve outer springs collapsed into one row at the exit gate, so a
 *      single passing re-measurement hid every condemned spring behind it.
 *   2. A wagon could be released having measured a handful of its forty-eight
 *      springs, because nothing checked that the sweep was finished.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import { InspectionRepository } from '../src/db/repository.ts';
import { getSpringCount, buildSpringQueue } from '../../shared/classification/springCounts.ts';

describe('Spring Completeness at the Exit Gate', () => {
  let db: DatabaseSync;
  let wagonRepo: WagonRepository;
  let inspectionRepo: InspectionRepository;
  const wagon = 'TEST/COMPLETE/1';

  const measure = (
    position: string,
    bogiePosition: string,
    nestIndex: number | null,
    height: number,
    status: 'PASS' | 'CONDEMNED' = 'PASS'
  ) =>
    inspectionRepo.insertInspection({
      wagonNumber: wagon,
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      springPosition: position as any,
      bogiePosition: bogiePosition as any,
      nestIndex: nestIndex as any,
      measuredFreeHeight: height,
      classifiedBand: status === 'PASS' ? 'BLUE' : null,
      bandRoman: status === 'PASS' ? 'Band I' : null,
      status,
      tableReference: 'Table 28',
      valid_range_min: 245,
      valid_range_max: 263,
      inspectorId: 'usr_insp_001'
    });

  /** Measures the whole wagon for the documented 20.32t NLB configuration. */
  const measureEverySpring = (height = 260) => {
    const counts = getSpringCount('CASNUB_22_NLB', '20.32t')!.counts;
    for (const q of buildSpringQueue(counts)) {
      measure(q.position, q.bogiePosition, q.indexInNest, height);
    }
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    wagonRepo = new WagonRepository(db);
    inspectionRepo = new InspectionRepository(db);
    wagonRepo.registerWagon({ wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR',
      createdBy: 'usr_insp_001'
    });
  });

  // -------------------------------------------------------------------------
  // Per-spring visibility
  // -------------------------------------------------------------------------
  it('TC-CMP-01: a condemned spring cannot hide behind a later passing one in the same nest', () => {
    // Outer spring 3 is condemned; outer spring 4 passes and is recorded after
    // it. Before nest indexing, the later row replaced the earlier one entirely.
    measure('OUTER', 'BOGIE_1', 3, 240, 'CONDEMNED');
    measure('OUTER', 'BOGIE_1', 4, 260, 'PASS');

    const gate = wagonRepo.evaluateExitGate(wagon);
    assert.strictEqual(
      gate.summary.springCheck.condemnedSprings,
      1,
      'the condemned spring must remain visible to the gate'
    );
    assert.strictEqual(gate.canRelease, false);
  });

  it('TC-CMP-02: every spring in a nest is counted, not just the last', () => {
    for (let i = 1; i <= 12; i++) measure('OUTER', 'BOGIE_1', i, 260);

    const gate = wagonRepo.evaluateExitGate(wagon);
    assert.strictEqual(
      gate.summary.springCheck.totalSprings,
      12,
      'all twelve outer springs should be visible, not one'
    );
  });

  it('TC-CMP-03: re-measuring one spring replaces only that spring', () => {
    measure('OUTER', 'BOGIE_1', 1, 240, 'CONDEMNED');
    measure('OUTER', 'BOGIE_1', 2, 260, 'PASS');
    // Spring 1 is replaced and re-measured.
    measure('OUTER', 'BOGIE_1', 1, 261, 'PASS');

    const gate = wagonRepo.evaluateExitGate(wagon);
    assert.strictEqual(gate.summary.springCheck.totalSprings, 2, 'still two distinct springs');
    assert.strictEqual(
      gate.summary.springCheck.condemnedSprings,
      0,
      're-measuring spring 1 should clear its own earlier condemnation'
    );
  });

  // -------------------------------------------------------------------------
  // Completeness
  // -------------------------------------------------------------------------
  it('TC-CMP-04: a partial sweep blocks release', () => {
    // Six springs measured out of forty-eight — the old behaviour would have
    // treated this as a complete inspection.
    measure('OUTER', 'BOGIE_1', 1, 260);
    measure('INNER', 'BOGIE_1', 1, 262);
    measure('SNUBBER', 'BOGIE_1', 1, 294);
    measure('OUTER', 'BOGIE_2', 1, 260);
    measure('INNER', 'BOGIE_2', 1, 262);
    measure('SNUBBER', 'BOGIE_2', 1, 294);

    const gate = wagonRepo.evaluateExitGate(wagon);
    const blocker = gate.blockers.find((b: string) => b.includes('have not been measured'));

    assert.ok(blocker, 'an incomplete spring sweep must block release');
    assert.ok(/42 of 48/.test(blocker!), `expected 42 of 48 missing, got: ${blocker}`);
    assert.strictEqual(gate.canRelease, false);
  });

  it('TC-CMP-05: the blocker says which nests are short', () => {
    measure('OUTER', 'BOGIE_1', 1, 260);

    const gate = wagonRepo.evaluateExitGate(wagon);
    const blocker = gate.blockers.find((b: string) => b.includes('have not been measured'))!;

    assert.ok(/BOGIE 1 outer/i.test(blocker), 'should name the nest that is short');
    assert.ok(/BOGIE 2/i.test(blocker), 'should mention the untouched second bogie');
    assert.ok(/12 outer, 8 inner and 4 snubber/.test(blocker), 'should state the expected configuration');
  });

  it('TC-CMP-06: a complete sweep raises no completeness blocker', () => {
    measureEverySpring();

    const gate = wagonRepo.evaluateExitGate(wagon);
    assert.ok(
      !gate.blockers.some((b: string) => b.includes('have not been measured')),
      'a full sweep must not be reported as incomplete'
    );
    assert.strictEqual(gate.summary.springCheck.totalSprings, 48);
  });

  it('TC-CMP-07: legacy wagons without nest indexing are not retrospectively blocked', () => {
    // Rows predating per-spring indexing cannot be judged for completeness,
    // and must not be failed on data that was never captured.
    measure('OUTER', 'BOGIE_1', null, 260);
    measure('INNER', 'BOGIE_1', null, 262);

    const gate = wagonRepo.evaluateExitGate(wagon);
    assert.ok(
      !gate.blockers.some((b: string) => b.includes('have not been measured')),
      'unindexed historical data must not trigger the completeness check'
    );
  });

  it('TC-CMP-08: a full sweep with one condemned spring still blocks, for the right reason', () => {
    measureEverySpring();
    measure('OUTER', 'BOGIE_2', 7, 240, 'CONDEMNED');

    const gate = wagonRepo.evaluateExitGate(wagon);
    assert.strictEqual(gate.canRelease, false);
    assert.ok(
      !gate.blockers.some((b: string) => b.includes('have not been measured')),
      'the sweep is complete — it must not also claim springs are missing'
    );
    assert.strictEqual(gate.summary.springCheck.condemnedSprings, 1);
  });

  // -------------------------------------------------------------------------
  // Offline sync integrity
  // -------------------------------------------------------------------------
  it('TC-CMP-10: a spring synced from the offline queue keeps its bogie and nest', () => {
    // Offline work used to drop both, so springs recorded without a connection
    // were invisible to the completeness check — worse data than online work,
    // silently.
    inspectionRepo.insertInspection({
      wagonNumber: wagon,
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      springPosition: 'OUTER',
      bogiePosition: 'BOGIE_2',
      nestIndex: 7,
      measuredFreeHeight: 259,
      classifiedBand: 'GREEN',
      bandRoman: 'Band II',
      status: 'PASS',
      tableReference: 'Table 28',
      valid_range_min: 245,
      valid_range_max: 263,
      inspectorId: 'usr_insp_001',
      syncId: 'offline-1',
      syncStatus: 'SYNCED'
    } as any);

    const row = db.prepare(
      'SELECT bogie_position, nest_index, sync_id FROM inspections WHERE sync_id = ?'
    ).get('offline-1') as any;

    assert.ok(row, 'sync_id must be persisted or duplicate suppression cannot work');
    assert.strictEqual(row.bogie_position, 'BOGIE_2');
    assert.strictEqual(row.nest_index, 7);
  });

  it('TC-CMP-11: re-syncing the same offline batch does not duplicate springs', () => {
    // A precedence bug left sync_id always null, so the UNIQUE constraint the
    // sync endpoint relies on never fired. A retried batch inserted every
    // spring twice — which now also corrupts nest counting, since twelve outer
    // springs would present as twenty-four.
    const record = {
      wagonNumber: wagon,
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      springPosition: 'OUTER',
      bogiePosition: 'BOGIE_1',
      nestIndex: 1,
      measuredFreeHeight: 260,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      tableReference: 'Table 28',
      valid_range_min: 245,
      valid_range_max: 263,
      inspectorId: 'usr_insp_001',
      syncId: 'batch-1-spring-1'
    } as any;

    inspectionRepo.insertInspection(record);
    assert.throws(
      () => inspectionRepo.insertInspection(record),
      /UNIQUE constraint failed: inspections\.sync_id/,
      'a replayed offline batch must be rejected, not inserted again'
    );

    const count = db.prepare(
      'SELECT COUNT(*) c FROM inspections WHERE sync_id = ?'
    ).get('batch-1-spring-1') as any;
    assert.strictEqual(count.c, 1);
  });

  // -------------------------------------------------------------------------
  // Nest grouping, now that a nest genuinely has members
  // -------------------------------------------------------------------------
  it('TC-CMP-09: a nest spread beyond 3 mm is flagged even when every spring passes', () => {
    // Twelve outer springs, all individually within limits, but spread across
    // 251-260 mm. This is the set-level fault that per-spring measurement
    // finally makes detectable.
    for (let i = 1; i <= 12; i++) {
      measure('OUTER', 'BOGIE_1', i, i <= 6 ? 251 : 260);
    }

    const gate = wagonRepo.evaluateExitGate(wagon);
    assert.strictEqual(gate.summary.springCheck.condemnedSprings, 0, 'each spring passes on its own');
    assert.ok(
      gate.advisories.some((a: string) => /free-height variation/i.test(a)),
      'the nest spread must still be raised'
    );
  });
});
