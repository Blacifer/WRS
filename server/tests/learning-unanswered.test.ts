/**
 * Learning Ledger — Unanswered Questions
 * Indian Railways WRS Raipur
 *
 * MEASUREMENT_ANOMALY is the only subsystem that asks the human a question and
 * may never get an answer: the flag is raised when a spring is recorded, and
 * the inspector answers separately, or walks away.
 *
 * Those unanswered rows must not be counted as the machine having been right.
 * Every other subsystem's "accepted" means the human took the machine's output
 * unchanged, which is evidence. Silence is not evidence, and counting it as
 * agreement would flatter exactly the subsystem whose usefulness is least
 * certain — the one whose whole value depends on inspectors bothering to
 * answer.
 *
 * The unanswered count is kept and reported, not discarded: it is the figure
 * shadow mode watches most closely, because a box nobody answers is a finding
 * about the app rather than about the inspectors.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { LearningService } from '../src/learning/learningService.ts';

function freshService(): LearningService {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  seedUsers(db);
  return new LearningService(db);
}

/** A flag raised at record time, which nobody has answered yet. */
function raiseUnanswered(svc: LearningService, height: number): void {
  svc.recordOutcome({
    subsystem: 'MEASUREMENT_ANOMALY',
    machineOutput: { measuredHeight: height, kinds: ['OUT_OF_POPULATION'] },
    wasCorrected: false,
    context: { answered: false },
    userId: 'usr_insp_001',
    userRole: 'INSPECTOR'
  });
}

/** An inspector's answer. `changed` true means the flag caught a real error. */
function answer(svc: LearningService, changed: boolean, magnitude?: number): void {
  svc.recordOutcome({
    subsystem: 'MEASUREMENT_ANOMALY',
    machineOutput: { flagged: true },
    humanOutput: { action: changed ? 'RE_MEASURED' : 'CONFIRMED' },
    wasCorrected: changed,
    correctionMagnitude: magnitude ?? null,
    context: { answered: true },
    userId: 'usr_insp_001',
    userRole: 'INSPECTOR'
  });
}

describe('Learning ledger — silence is not agreement', () => {
  it('TC-LRN-U01: an unanswered flag is excluded from accuracy and counted separately', () => {
    const svc = freshService();
    raiseUnanswered(svc, 206.5);
    raiseUnanswered(svc, 209.0);
    answer(svc, true, 54.0);

    const acc = svc.getAccuracy('MEASUREMENT_ANOMALY');

    assert.equal(acc.unansweredCount, 2, 'both unanswered flags must be counted');
    assert.equal(acc.totalEvents, 1, 'only the answered flag is evidence');
    assert.equal(acc.correctedCount, 1);
    assert.equal(acc.acceptedCount, 0, 'silence must never read as the machine being right');
  });

  it('TC-LRN-U02: the acceptance rate is computed over answers only', () => {
    const svc = freshService();
    // Nine unanswered would drag a naive rate to 90% "accepted".
    for (let i = 0; i < 9; i++) raiseUnanswered(svc, 206.5);
    answer(svc, true, 54.0);

    const acc = svc.getAccuracy('MEASUREMENT_ANOMALY');
    assert.equal(acc.acceptanceRate, 0, 'the one answer says the flag was right');
    assert.equal(acc.unansweredCount, 9);
  });

  it('TC-LRN-U03: a false alarm is an acceptance, and is counted as one', () => {
    const svc = freshService();
    answer(svc, false);
    answer(svc, false);
    answer(svc, true, 54.0);

    const acc = svc.getAccuracy('MEASUREMENT_ANOMALY');
    assert.equal(acc.totalEvents, 3);
    assert.equal(acc.acceptedCount, 2, 'two readings stood — the flag was wrong twice');
    assert.equal(acc.correctedCount, 1);
    assert.equal(acc.unansweredCount, 0);
  });

  it('TC-LRN-U04: subsystems that ask no questions are untouched by the filter', () => {
    const svc = freshService();
    /*
     * These carry no `answered` key at all, so json_extract yields NULL. If
     * the filter treated NULL as unanswered it would silently empty every
     * other subsystem's accuracy — which is the way this change could do real
     * damage without anyone noticing.
     */
    svc.recordOutcome({
      subsystem: 'OCR_CALIPER',
      machineOutput: { reading: 260.5 },
      machineConfidence: 0.9,
      wasCorrected: false,
      userId: 'usr_insp_001',
      userRole: 'INSPECTOR'
    });
    svc.recordOutcome({
      subsystem: 'OCR_CALIPER',
      machineOutput: { reading: 206.5 },
      machineConfidence: 0.4,
      humanOutput: { reading: 260.5 },
      wasCorrected: true,
      correctionMagnitude: 54.0,
      userId: 'usr_insp_001',
      userRole: 'INSPECTOR'
    });

    const acc = svc.getAccuracy('OCR_CALIPER');
    assert.equal(acc.totalEvents, 2, 'no OCR row may be filtered out');
    assert.equal(acc.acceptedCount, 1);
    assert.equal(acc.correctedCount, 1);
    assert.equal(acc.unansweredCount, 0);
  });

  it('TC-LRN-U05: with nothing recorded the figures are zero rather than absent', () => {
    const acc = freshService().getAccuracy('MEASUREMENT_ANOMALY');
    assert.equal(acc.totalEvents, 0);
    assert.equal(acc.unansweredCount, 0);
    assert.equal(acc.acceptanceRate, 0);
    assert.equal(acc.hasEnoughData, false);
  });

  it('TC-LRN-U06: unanswered flags do not push a subsystem over the learning threshold', () => {
    const svc = freshService();
    // Forty unanswered questions are not forty observations to learn from.
    for (let i = 0; i < 40; i++) raiseUnanswered(svc, 206.5);

    const acc = svc.getAccuracy('MEASUREMENT_ANOMALY');
    assert.equal(acc.hasEnoughData, false, 'silence must never authorise a tuning proposal');
    assert.equal(acc.unansweredCount, 40);
  });
});
