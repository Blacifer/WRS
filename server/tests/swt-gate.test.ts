/**
 * Single Wagon Test — persistence and exit gate integration
 * Indian Railways WRS Raipur
 *
 * WMM 2.0 §720 requires a Single Wagon Test after POH. The exit gate did not
 * know the test existed, so a wagon could be released having had its air brake
 * system covered by two PASS/FAIL checklist ticks.
 *
 * The brake system is the one component whose failure is not caught by the
 * next inspection down the line, so this blocks rather than advises.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';

const PASSING = [
  { ref: '1', value: 5.0 }, { ref: '2', value: 5.0 }, { ref: '3', value: 0.05 },
  { ref: '4.1', value: 24 }, { ref: '4.2', value: 3.8 }, { ref: '4.3', value: 1.45 },
  { ref: '5.1', value: 52 }, { ref: '6', value: 4 }, { ref: '7', observed: true },
  { ref: '8.1', value: 25 }, { ref: '8.2', value: 3.8 }, { ref: '9', value: 85 },
  { ref: '10', value: 0.05 }, { ref: '12', observed: true }
];

describe('Single Wagon Test — records and gate', () => {
  let db: DatabaseSync;
  let repo: WagonRepository;
  const wagon = 'SECR/SWT/1';

  const record = (readings: any[], over: any = {}) =>
    repo.recordSwt({
      wagonNumber: wagon,
      wagonType: 'BOXN',
      pipeType: 'SINGLE',
      loadCondition: 'EMPTY',
      readings,
      testedBy: 'usr_insp_001',
      testerName: 'Ramesh Kumar',
      ...over
    });

  const swtBlockers = () =>
    repo.evaluateExitGate(wagon).blockers.filter((b: string) => /Single Wagon Test/i.test(b));

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    repo = new WagonRepository(db);
    repo.registerWagon({ wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_001' });
  });

  it('TC-SWTG-01: a wagon with no test on record is blocked', () => {
    const b = swtBlockers();
    assert.strictEqual(b.length, 1);
    assert.match(b[0], /has not been carried out/);
    assert.match(b[0], /§720/);
  });

  it('TC-SWTG-02: a passing test clears the blocker', () => {
    const r = record(PASSING);
    assert.strictEqual(r.passed, true);
    assert.deepStrictEqual(swtBlockers(), []);
  });

  it('TC-SWTG-03: a failing test blocks, naming the rows that failed', () => {
    // A supervisor needs to know which readings to chase, not just "failed".
    record(PASSING.map((x) => (x.ref === '4.1' ? { ref: '4.1', value: 12 } : x)));
    const b = swtBlockers();
    assert.strictEqual(b.length, 1);
    assert.match(b[0], /did not pass/);
    assert.match(b[0], /rows 4\.1/);
  });

  it('TC-SWTG-04: an incomplete proforma blocks, and says so distinctly', () => {
    // "Not recorded" and "outside limit" need different things done about
    // them, so they must not read the same at the gate.
    record(PASSING.filter((x) => x.ref !== '6'));
    const b = swtBlockers();
    assert.match(b[0], /not recorded/i);
    assert.match(b[0], /rows 6/);
  });

  it('TC-SWTG-05: the verdict is computed, never taken from the caller', () => {
    // A test whose result the tester can assert is not a test.
    const r = record(PASSING.map((x) => (x.ref === '6' ? { ref: '6', value: 20 } : x)), {
      // deliberately trying to claim a pass
      passed: true
    } as any);
    assert.strictEqual(r.passed, false, 'sensitivity of 20 sec exceeds the 6 sec limit');
  });

  it('TC-SWTG-06: the most recent test governs', () => {
    record(PASSING.map((x) => (x.ref === '4.1' ? { ref: '4.1', value: 12 } : x)));
    assert.strictEqual(swtBlockers().length, 1, 'the failing test blocks');

    record(PASSING);
    assert.deepStrictEqual(swtBlockers(), [], 'a later passing test clears it');
    assert.strictEqual(repo.getSwtHistory(wagon).length, 2, 'both remain on record');
  });

  it('TC-SWTG-07: a repeat test never erases the earlier one', () => {
    record(PASSING.map((x) => (x.ref === '4.2' ? { ref: '4.2', value: 2.0 } : x)));
    record(PASSING);
    const history = repo.getSwtHistory(wagon);
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history.filter((h: any) => !h.passed).length, 1, 'the failure stays visible');
  });

  it('TC-SWTG-08: test records are append-only', () => {
    const r = record(PASSING);
    assert.throws(() => db.prepare('UPDATE swt_tests SET passed = 0 WHERE id = ?').run(r.id), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM swt_tests WHERE id = ?').run(r.id), /append-only/);
  });

  it('TC-SWTG-09: an unknown tester cannot record a test', () => {
    assert.throws(() => record(PASSING, { testedBy: 'usr_nobody' }), /not registered/);
  });

  it('TC-SWTG-10: twin pipe is judged against twin pipe limits', () => {
    // AR is 5 kg/cm2 on single pipe and 6 on twin. Judging a twin-pipe wagon
    // by the single-pipe row would fail every one of them.
    const twin = record(
      [...PASSING.filter((x) => x.ref !== '2'), { ref: '1a', value: 6.0 }, { ref: '2a', value: 6.0 }],
      { pipeType: 'TWIN' }
    );
    assert.strictEqual(twin.passed, true, JSON.stringify(twin.failedRefs));
  });

  it('TC-SWTG-11: the test is written into the audit chain as its own event', () => {
    record(PASSING);
    const row = db.prepare(`
      SELECT payload_json FROM inspection_audit_log ORDER BY rowid DESC LIMIT 1
    `).get() as any;
    const payload = JSON.parse(row.payload_json);
    assert.strictEqual(payload.action, 'SINGLE_WAGON_TEST');
    assert.strictEqual(payload.passed, true);
  });
});
