/**
 * Machine Learning Feedback Loop Tests
 * Indian Railways WRS Raipur
 *
 * Covers the loop that lets the system improve from its own mistakes:
 * capture -> measure -> derive -> propose -> human approval.
 *
 * The safety-critical assertions here are the negative ones: proposals must
 * never self-apply, the ledger must never be rewritable, and nothing in this
 * subsystem may touch an RDSO limit.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { LearningService, MIN_SAMPLE_FOR_INSIGHT } from '../src/learning/learningService.ts';

describe('Machine Learning Feedback Loop', () => {
  let db: DatabaseSync;
  let svc: LearningService;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    svc = new LearningService(db);
    svc.ensureParameters();
  });

  // -------------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------------
  it('TC-ML-01: records an accepted machine output as a non-correction', () => {
    svc.recordOutcome({
      subsystem: 'OCR_CALIPER',
      machineOutput: { measuredFreeHeight: 260.0 },
      machineConfidence: 0.94,
      humanOutput: { measuredFreeHeight: 260.0 },
      wasCorrected: false,
      correctionMagnitude: 0,
      userId: 'usr_insp_001'
    });

    const acc = svc.getAccuracy('OCR_CALIPER');
    assert.strictEqual(acc.totalEvents, 1);
    assert.strictEqual(acc.acceptedCount, 1);
    assert.strictEqual(acc.correctedCount, 0);
    assert.strictEqual(acc.acceptanceRate, 1);
  });

  it('TC-ML-02: records a human correction with its magnitude', () => {
    svc.recordOutcome({
      subsystem: 'OCR_CALIPER',
      machineOutput: { measuredFreeHeight: 253.0 },
      machineConfidence: 0.41,
      humanOutput: { measuredFreeHeight: 258.0 },
      wasCorrected: true,
      correctionMagnitude: 5.0,
      userId: 'usr_insp_001'
    });

    const acc = svc.getAccuracy('OCR_CALIPER');
    assert.strictEqual(acc.correctedCount, 1);
    assert.strictEqual(acc.acceptanceRate, 0);
    assert.strictEqual(acc.meanCorrectionMagnitude, 5);
  });

  // -------------------------------------------------------------------------
  // Measure
  // -------------------------------------------------------------------------
  it('TC-ML-03: will not draw conclusions from a small sample', () => {
    for (let i = 0; i < 5; i++) {
      svc.recordOutcome({
        subsystem: 'OCR_CALIPER',
        machineOutput: { v: i },
        machineConfidence: 0.4,
        wasCorrected: true,
        correctionMagnitude: 4,
        userId: 'usr_insp_001'
      });
    }

    const acc = svc.getAccuracy('OCR_CALIPER');
    assert.strictEqual(acc.hasEnoughData, false);
    assert.strictEqual(acc.trend, null, 'trend must not be computed on a tiny sample');
    assert.deepStrictEqual(svc.deriveInsights(), [], 'must not emit insights below the sample floor');
  });

  it('TC-ML-04: confidence calibration separates reliable from unreliable bands', () => {
    // High confidence -> mostly accepted.
    for (let i = 0; i < 40; i++) {
      svc.recordOutcome({
        subsystem: 'OCR_CALIPER',
        machineOutput: { v: i },
        machineConfidence: 0.92,
        wasCorrected: i % 20 === 0,
        userId: 'usr_insp_001'
      });
    }
    // Low confidence -> mostly corrected.
    for (let i = 0; i < 40; i++) {
      svc.recordOutcome({
        subsystem: 'OCR_CALIPER',
        machineOutput: { v: i },
        machineConfidence: 0.42,
        wasCorrected: i % 5 !== 0,
        userId: 'usr_insp_001'
      });
    }

    const buckets = svc.getConfidenceCalibration('OCR_CALIPER');
    const high = buckets.find((b) => b.lowerBound === 0.9)!;
    const low = buckets.find((b) => b.lowerBound === 0.0)!;

    assert.ok(high.acceptanceRate > 0.9, 'high-confidence band should be largely accepted');
    assert.ok(low.acceptanceRate < 0.3, 'low-confidence band should be largely corrected');
    assert.ok(high.acceptanceRate > low.acceptanceRate);
  });

  // -------------------------------------------------------------------------
  // Learn
  // -------------------------------------------------------------------------
  it('TC-ML-05: derives a threshold recommendation from real correction data', () => {
    for (let i = 0; i < 60; i++) {
      svc.recordOutcome({
        subsystem: 'OCR_CALIPER',
        machineOutput: { v: i },
        machineConfidence: 0.88,
        wasCorrected: false,
        userId: 'usr_insp_001'
      });
    }
    for (let i = 0; i < 60; i++) {
      svc.recordOutcome({
        subsystem: 'OCR_CALIPER',
        machineOutput: { v: i },
        machineConfidence: 0.55,
        wasCorrected: true,
        correctionMagnitude: 4,
        userId: 'usr_insp_001'
      });
    }

    const insights = svc.deriveInsights();
    const actionable = insights.find((i) => i.suggestedParamKey === 'ocr.manual_confirm_threshold');

    assert.ok(actionable, 'should recommend a confidence threshold');
    assert.ok(actionable!.suggestedValue! > 0.5, 'should raise the threshold above the unreliable band');
    assert.ok(actionable!.sampleSize >= MIN_SAMPLE_FOR_INSIGHT);
  });

  it('TC-ML-06: identifies a systematic weakness from context', () => {
    for (let i = 0; i < 60; i++) {
      const badDevice = i % 3 === 0;
      svc.recordOutcome({
        subsystem: 'OCR_CALIPER',
        machineOutput: { v: i },
        machineConfidence: 0.7,
        wasCorrected: badDevice,
        correctionMagnitude: badDevice ? 4 : 0,
        context: { device: badDevice ? 'TABLET_B' : 'TABLET_A' },
        userId: 'usr_insp_001'
      });
    }

    const insights = svc.deriveInsights();
    assert.ok(
      insights.some((i) => i.title.includes('TABLET_B')),
      'should flag the underperforming device'
    );
  });

  // -------------------------------------------------------------------------
  // Human approval gate — the safety-critical behaviour
  // -------------------------------------------------------------------------
  it('TC-ML-07: a proposal NEVER self-applies', () => {
    const before = svc.getParameter('ocr.manual_confirm_threshold');

    for (let i = 0; i < 60; i++) {
      svc.recordOutcome({ subsystem: 'OCR_CALIPER', machineOutput: { v: i }, machineConfidence: 0.88, wasCorrected: false, userId: 'usr_insp_001' });
    }
    for (let i = 0; i < 60; i++) {
      svc.recordOutcome({ subsystem: 'OCR_CALIPER', machineOutput: { v: i }, machineConfidence: 0.55, wasCorrected: true, correctionMagnitude: 4, userId: 'usr_insp_001' });
    }

    const { proposed } = svc.generateProposals();
    assert.ok(proposed > 0, 'a proposal should have been raised');

    const after = svc.getParameter('ocr.manual_confirm_threshold');
    assert.strictEqual(after, before, 'the live value must be unchanged until a human approves');

    const param = svc.listParameters().find((p: any) => p.param_key === 'ocr.manual_confirm_threshold');
    assert.strictEqual(param.approval_status, 'PENDING');
    assert.ok(param.proposed_value !== null);
  });

  it('TC-ML-08: approval applies the value and attributes it to a named user', () => {
    for (let i = 0; i < 60; i++) {
      svc.recordOutcome({ subsystem: 'OCR_CALIPER', machineOutput: { v: i }, machineConfidence: 0.88, wasCorrected: false, userId: 'usr_insp_001' });
    }
    for (let i = 0; i < 60; i++) {
      svc.recordOutcome({ subsystem: 'OCR_CALIPER', machineOutput: { v: i }, machineConfidence: 0.55, wasCorrected: true, correctionMagnitude: 4, userId: 'usr_insp_001' });
    }
    svc.generateProposals();

    const updated: any = svc.decideProposal('ocr.manual_confirm_threshold', 'APPROVE', 'usr_adm_001');

    assert.strictEqual(updated.approval_status, 'APPROVED');
    assert.strictEqual(updated.approved_by, 'usr_adm_001');
    assert.ok(updated.approved_at);
    assert.strictEqual(updated.proposed_value, null, 'proposal is consumed on approval');
    assert.ok(svc.getParameter('ocr.manual_confirm_threshold')! > 0.5);
  });

  it('TC-ML-09: rejection discards the proposal and leaves the value alone', () => {
    for (let i = 0; i < 60; i++) {
      svc.recordOutcome({ subsystem: 'OCR_CALIPER', machineOutput: { v: i }, machineConfidence: 0.88, wasCorrected: false, userId: 'usr_insp_001' });
    }
    for (let i = 0; i < 60; i++) {
      svc.recordOutcome({ subsystem: 'OCR_CALIPER', machineOutput: { v: i }, machineConfidence: 0.55, wasCorrected: true, correctionMagnitude: 4, userId: 'usr_insp_001' });
    }
    const before = svc.getParameter('ocr.manual_confirm_threshold');
    svc.generateProposals();

    const updated: any = svc.decideProposal('ocr.manual_confirm_threshold', 'REJECT', 'usr_adm_001');

    assert.strictEqual(updated.approval_status, 'REJECTED');
    assert.strictEqual(svc.getParameter('ocr.manual_confirm_threshold'), before);
  });

  it('TC-ML-10: an approved value is clamped to its safe range', () => {
    db.prepare(`
      UPDATE learned_parameters
      SET proposed_value = 99.0, approval_status = 'PENDING'
      WHERE param_key = 'ocr.manual_confirm_threshold'
    `).run();

    svc.decideProposal('ocr.manual_confirm_threshold', 'APPROVE', 'usr_adm_001');
    const value = svc.getParameter('ocr.manual_confirm_threshold')!;

    assert.ok(value <= 0.95, `value ${value} must be clamped to the declared maximum`);
  });

  it('TC-ML-11: deciding a parameter with no pending proposal is rejected', () => {
    assert.throws(
      () => svc.decideProposal('ocr.manual_confirm_threshold', 'APPROVE', 'usr_adm_001'),
      (err: any) => err.name === 'ValidationError'
    );
  });

  // -------------------------------------------------------------------------
  // Ledger integrity
  // -------------------------------------------------------------------------
  it('TC-ML-12: the correction ledger is append-only', () => {
    svc.recordOutcome({
      subsystem: 'OCR_CALIPER',
      machineOutput: { v: 1 },
      machineConfidence: 0.5,
      wasCorrected: true,
      correctionMagnitude: 2,
      userId: 'usr_insp_001'
    });

    assert.throws(
      () => db.prepare('UPDATE machine_learning_events SET was_corrected = 0').run(),
      /append-only/
    );
    assert.throws(
      () => db.prepare('DELETE FROM machine_learning_events').run(),
      /append-only/
    );
  });

  it('TC-ML-13: no tunable parameter is an RDSO safety limit', () => {
    // Regression guard: the loop must never gain the ability to move a
    // condemning height, band boundary, or wear limit. Those are regulation.
    const forbidden = ['condemn', 'band', 'height', 'wear', 'tolerance', 'rdso', 'limit'];
    for (const p of svc.listParameters()) {
      const key = String(p.param_key).toLowerCase();
      for (const word of forbidden) {
        assert.ok(
          !key.includes(word),
          `Tunable parameter "${p.param_key}" looks like a safety limit — these must never be self-tuned.`
        );
      }
    }
  });
});
