/**
 * Learning memory — what the system has seen, and what it changed as a result
 * Indian Railways WRS Raipur
 *
 * The loop did not close. Outcomes were recorded, accuracy was computed,
 * proposals were raised, a supervisor approved them — and the approved value
 * was written to a table nothing read. Approving a change altered no behaviour
 * at all.
 *
 * And learned_parameters held only current state, so approving a second
 * proposal overwrote any trace of the first, which made the one question worth
 * asking of a self-improving system unanswerable after the second change.
 *
 * These pin both: that a change is recorded permanently with its evidence, and
 * that the honest answer to "what has it learned" on day one is "nothing yet".
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { LearningService } from '../src/learning/learningService.ts';

describe('Learning memory', () => {
  let db: DatabaseSync;
  let svc: LearningService;

  /**
   * Records n observations at a single confidence level.
   *
   * Confidence matters: the OCR insight works by comparing acceptance rates
   * across confidence bands, so observations all recorded at one confidence
   * produce a single bucket and no conclusion. Which is correct — you cannot
   * infer where the reliable floor lies from readings that were all equally
   * confident.
   */
  const observeAt = (confidence: number, n: number, corrected: number, subsystem = 'OCR_CALIPER') => {
    for (let i = 0; i < n; i++) {
      svc.recordOutcome({
        subsystem: subsystem as any,
        machineOutput: { height: 258.5 },
        machineConfidence: confidence,
        humanOutput: { height: i < corrected ? 260 : 258.5 },
        wasCorrected: i < corrected,
        userId: 'usr_insp_001',
        userRole: 'INSPECTOR'
      });
    }
  };

  const observe = (n: number, corrected: number, subsystem = 'OCR_CALIPER') =>
    observeAt(0.8, n, corrected, subsystem);

  /**
   * The pattern the OCR insight exists to find: high-confidence reads are
   * accepted, low-confidence reads get corrected by hand. That is real —
   * it is what a well-calibrated OCR looks like when the threshold is set
   * too low, so inspectors are being interrupted for readings they would
   * have accepted and not interrupted for ones they reject.
   */
  const observeCalibrated = () => {
    observeAt(0.95, 60, 1);   // very confident, almost always right
    observeAt(0.92, 60, 2);
    observeAt(0.55, 40, 30);  // barely confident, usually wrong
    observeAt(0.45, 40, 32);
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    svc = new LearningService(db);
    svc.ensureParameters();
  });

  // -------------------------------------------------------------------------
  // The honest empty state
  // -------------------------------------------------------------------------
  it('TC-MEM-01: with nothing recorded, it says it has learned nothing', () => {
    // The most important case. A system that dresses up an empty ledger as
    // insight is one nobody should trust with a safety decision — and this is
    // exactly the state a DRM would see on the first day.
    const m = svc.getMemory();
    assert.strictEqual(m.totalObservations, 0);
    assert.strictEqual(m.changesApplied.length, 0);
    assert.match(m.summary, /has learned nothing/i);
  });

  it('TC-MEM-02: a subsystem with no observations reports no accuracy, not 100%', () => {
    // Reporting 100% for zero samples would be the single most misleading
    // number on the screen.
    const m = svc.getMemory();
    for (const o of m.observations) {
      assert.strictEqual(o.total, 0);
      assert.strictEqual(o.accuracyPct, null, `${o.subsystem} claims an accuracy`);
      assert.strictEqual(o.enoughToLearnFrom, false);
    }
  });

  it('TC-MEM-03: observations are counted, and corrections separated', () => {
    observe(50, 8);
    const m = svc.getMemory();
    const ocr = m.observations.find((o) => o.subsystem === 'OCR_CALIPER')!;

    assert.strictEqual(ocr.total, 50);
    assert.strictEqual(ocr.corrected, 8);
    assert.strictEqual(ocr.accuracyPct, 84);
    assert.strictEqual(m.totalObservations, 50);
    assert.ok(ocr.firstSeen && ocr.lastSeen, 'the window observed must be visible');
  });

  it('TC-MEM-04: observations alone are not presented as learning', () => {
    // Having watched a lot and changed nothing is a real and common state, and
    // must not read as though something was learned.
    observe(200, 30);
    const m = svc.getMemory();
    assert.strictEqual(m.changesApplied.length, 0);
    assert.match(m.summary, /No settings have been changed yet/i);
  });

  // -------------------------------------------------------------------------
  // What it actually learned
  // -------------------------------------------------------------------------
  it('TC-MEM-05: an approved change is recorded permanently, with its evidence', () => {
    observeCalibrated();
    svc.generateProposals();

    const pending = svc.listParameters().filter((p: any) => p.approval_status === 'PENDING');
    assert.ok(pending.length > 0, 'the ledger should have produced a proposal');

    const key = pending[0].param_key;
    const before = svc.getParameter(key);
    svc.decideProposal(key, 'APPROVE', 'usr_sup_001');

    const m = svc.getMemory();
    assert.strictEqual(m.changesApplied.length, 1);

    const change = m.changesApplied[0];
    assert.strictEqual(change.param_key, key);
    assert.strictEqual(change.previous_value, before, 'the value before must be preserved');
    assert.strictEqual(change.decision, 'APPROVED');
    assert.strictEqual(change.decided_by, 'usr_sup_001');
    assert.ok(change.decided_by_name, 'a name, not just an id');
    assert.ok(change.rationale, 'why it was proposed');
    assert.ok(change.sample_size > 0, 'how many observations it rested on');
    assert.match(m.summary, /approved by a named supervisor/i);
  });

  it('TC-MEM-06: an approved change actually alters the value the system uses', () => {
    // The whole point. This value was previously written and never read.
    observeCalibrated();
    svc.generateProposals();
    const pending = svc.listParameters().filter((p: any) => p.approval_status === 'PENDING');
    const key = pending[0].param_key;
    const before = svc.getParameter(key);

    svc.decideProposal(key, 'APPROVE', 'usr_sup_001');
    assert.notStrictEqual(svc.getParameter(key), before, 'the effective value must change');
  });

  it('TC-MEM-07: a rejected proposal is recorded too, and changes nothing', () => {
    // Which suggestions a supervisor turned down says as much about the
    // system's judgement as the ones they took.
    observeCalibrated();
    svc.generateProposals();
    const key = svc.listParameters().filter((p: any) => p.approval_status === 'PENDING')[0].param_key;
    const before = svc.getParameter(key);

    svc.decideProposal(key, 'REJECT', 'usr_sup_001');

    const m = svc.getMemory();
    assert.strictEqual(m.changesApplied.length, 0);
    assert.strictEqual(m.changesRejected.length, 1);
    assert.strictEqual(m.changesRejected[0].applied_value, null);
    assert.strictEqual(svc.getParameter(key), before, 'a rejection must not move the value');
  });

  it('TC-MEM-08: a second change does not erase the first', () => {
    // The regression that made the history necessary.
    observeCalibrated();
    svc.generateProposals();
    const key = svc.listParameters().filter((p: any) => p.approval_status === 'PENDING')[0].param_key;

    svc.decideProposal(key, 'APPROVE', 'usr_sup_001');
    const firstValue = svc.getParameter(key);

    observeAt(0.75, 200, 10);
    svc.generateProposals();
    const stillPending = svc.listParameters().filter((p: any) => p.approval_status === 'PENDING');
    if (stillPending.length > 0) {
      svc.decideProposal(stillPending[0].param_key, 'APPROVE', 'usr_sup_001');
    }

    const history = svc.getParameterHistory(key);
    assert.ok(history.length >= 1, 'the first decision must survive');
    assert.strictEqual(history[0].applied_value, firstValue);
  });

  it('TC-MEM-09: the history cannot be rewritten', () => {
    observeCalibrated();
    svc.generateProposals();
    const key = svc.listParameters().filter((p: any) => p.approval_status === 'PENDING')[0].param_key;
    svc.decideProposal(key, 'APPROVE', 'usr_sup_001');

    assert.throws(
      () => db.prepare("UPDATE learned_parameter_history SET applied_value = 0.99").run(),
      /append-only/
    );
    assert.throws(
      () => db.prepare('DELETE FROM learned_parameter_history').run(),
      /append-only/
    );
  });

  it('TC-MEM-10: a proposal needs enough evidence before it is offered', () => {
    // Tuning a safety threshold on a handful of readings is how a system
    // learns the wrong thing confidently.
    observe(5, 4);
    svc.generateProposals();
    const pending = svc.listParameters().filter((p: any) => p.approval_status === 'PENDING');
    assert.strictEqual(pending.length, 0, 'five observations must not move anything');
  });
});
