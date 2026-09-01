/**
 * Which instrument took the reading, and was anyone checking it
 * Indian Railways WRS Raipur
 *
 * A spring record said what was measured, by whom, and against which RDSO
 * table — and never what it was measured with. That is the first question an
 * auditor asks of a measurement, and the system had no answer.
 *
 * The gauge on the bench makes the case better than the principle does:
 * SSG-02, the snubber gauge in daily use, carries a calibration label with
 * "Calibrated on" and "Calibration valid upto" both blank.
 *
 * The rule this file defends: an unverified gauge never blocks the work — a
 * spring still gets sorted — but it can never quietly look verified either.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { GaugeRepository, calibrationStateOf } from '../src/db/gaugeRepository.ts';
import { SortingRepository } from '../src/db/sortingRepository.ts';

let db: DatabaseSync;
let gauges: GaugeRepository;
let sorting: SortingRepository;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  runMigrations(db);
  seedUsers(db);
  gauges = new GaugeRepository(db);
  sorting = new SortingRepository(db);
});

const NOW = new Date('2026-09-01T00:00:00Z');

describe('Calibration state', () => {
  it('reports an unrecorded calibration as unrecorded, not as valid', () => {
    assert.equal(calibrationStateOf({ calibratedOn: null, validUpto: null }, NOW), 'UNRECORDED');
  });

  it('separates a lapsed gauge from one that was never recorded', () => {
    /*
     * Two different problems needing two different actions — one is a missing
     * record, the other an overdue instrument — so they are not collapsed
     * into a single "not valid".
     */
    assert.equal(
      calibrationStateOf({ calibratedOn: '2025-01-01', validUpto: '2025-12-31' }, NOW),
      'EXPIRED'
    );
    assert.equal(
      calibrationStateOf({ calibratedOn: '2026-01-01', validUpto: '2027-01-01' }, NOW),
      'VALID'
    );
  });

  it('treats a calibration date with no expiry as unrecorded', () => {
    // "Calibrated once, valid forever" is not a calibration record.
    assert.equal(calibrationStateOf({ calibratedOn: '2026-01-01', validUpto: null }, NOW), 'UNRECORDED');
  });

  it('does not accept a malformed date as a valid calibration', () => {
    assert.equal(calibrationStateOf({ calibratedOn: '2026-01-01', validUpto: 'soon' }, NOW), 'UNRECORDED');
  });
});

describe('The gauge register', () => {
  it('carries the real gauge from the shop floor with its dates genuinely blank', () => {
    const ssg = gauges.byCode('SSG-02');
    assert.ok(ssg, 'the shop floor gauge is not in the register');
    assert.equal(ssg.certificateNumber, '1251122-04-125');
    assert.equal(ssg.calibratedOn, null, 'a calibration date was invented for it');
    assert.equal(ssg.validUpto, null, 'an expiry date was invented for it');
    assert.equal(ssg.calibrationState, 'UNRECORDED');
  });

  it('offers a snubber gauge for snubbers and not for outers', () => {
    // Reading an outer spring against a snubber gauge is one of the ways a
    // condemned spring passes.
    assert.ok(gauges.list({ appliesTo: 'SNUBBER' }).some(g => g.gaugeCode === 'SSG-02'));
    assert.ok(!gauges.list({ appliesTo: 'OUTER' }).some(g => g.gaugeCode === 'SSG-02'));
  });
});

describe('A reading remembers its instrument', () => {
  const spring = {
    batchId: 'batch_test',
    bogieType: 'CASNUB_22_NLB' as any,
    condition: 'USED' as any,
    springPosition: 'OUTER' as any,
    measuredFreeHeight: 261.5,
    status: 'PASS' as const,
    inspectorId: 'usr_insp_001'
  };

  it('stamps the gauge and its calibration onto the record', () => {
    sorting.record({ ...spring, gaugeCode: 'SSG-02' } as any);
    const row = db.prepare(
      'SELECT gauge_code, gauge_calibration_state FROM spring_sorting_records ORDER BY rowid DESC LIMIT 1'
    ).get() as any;
    assert.equal(row.gauge_code, 'SSG-02');
    assert.equal(row.gauge_calibration_state, 'UNRECORDED');
  });

  it('records the absence of a gauge as an absence, not as nothing', () => {
    sorting.record({ ...spring } as any);
    const row = db.prepare(
      'SELECT gauge_code, gauge_calibration_state FROM spring_sorting_records ORDER BY rowid DESC LIMIT 1'
    ).get() as any;
    assert.equal(row.gauge_code, null);
    assert.equal(row.gauge_calibration_state, 'NO_GAUGE_NAMED');
  });

  it('never blocks the sorting for want of a calibrated gauge', () => {
    // Nine hundred springs a day do not stop because a label is blank. The
    // record notes the fact; the work continues.
    const before = (db.prepare('SELECT COUNT(*) AS n FROM spring_sorting_records').get() as any).n;
    sorting.record({ ...spring, gaugeCode: 'SSG-02' } as any);
    const after = (db.prepare('SELECT COUNT(*) AS n FROM spring_sorting_records').get() as any).n;
    assert.equal(after, before + 1, 'an unverified gauge stopped a spring being recorded');
  });

  it('does not let a later recalibration make an earlier reading look sound', () => {
    /*
     * The point of stamping the state onto the record rather than looking it
     * up later. Calibrating the gauge tomorrow must not retrospectively
     * clean up work done today on an unverified instrument.
     */
    sorting.record({ ...spring, gaugeCode: 'SSG-02' } as any);

    gauges.upsert({
      gaugeCode: 'SSG-02',
      description: 'Snubber spring gauge (HS)',
      calibratedOn: '2026-09-01',
      validUpto: '2027-09-01'
    });

    assert.equal(gauges.byCode('SSG-02')!.calibrationState, 'VALID', 'the gauge did not recalibrate');
    const row = db.prepare(
      'SELECT gauge_calibration_state FROM spring_sorting_records ORDER BY rowid DESC LIMIT 1'
    ).get() as any;
    assert.equal(
      row.gauge_calibration_state,
      'UNRECORDED',
      'recalibrating the gauge rewrote history for readings already taken'
    );
  });

  it('counts how much recorded work rests on an unverified instrument', () => {
    sorting.record({ ...spring, gaugeCode: 'SSG-02' } as any);
    sorting.record({ ...spring } as any);

    const exposure = gauges.readingsOnUnverifiedGauges();
    assert.equal(exposure.unrecorded, 1);
    assert.equal(exposure.noGauge, 1);
  });
});
