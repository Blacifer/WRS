/**
 * Single Wagon Test Specification Tests
 * Indian Railways WRS Raipur
 *
 * The air brake system had two checklist line items against which an inspector
 * could record only PASS or FAIL. WMM 2.0 devotes a chapter to it and §720-C
 * specifies a proforma of measured values, each with a published limit — a
 * test the manual requires after every POH.
 *
 * These pin the limits to the proforma, and pin the three ways a test must
 * refuse to report success: a row left blank, a row outside limit, and a row
 * for which no limit is published.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SWT_CHECKS,
  PISTON_STROKE_MM,
  checksFor,
  evaluateSwt
} from '../../shared/classification/swtSpec.ts';

/** A complete, in-limit single-pipe test on a BOXN in empty condition. */
const goodReadings = [
  { ref: '1', value: 5.0 },
  { ref: '2', value: 5.0 },
  { ref: '3', value: 0.05 },
  { ref: '4.1', value: 24 },
  { ref: '4.2', value: 3.8 },
  { ref: '4.3', value: 1.45 },
  { ref: '5.1', value: 52 },
  { ref: '6', value: 4 },
  { ref: '7', observed: true },
  { ref: '8.1', value: 25 },
  { ref: '8.2', value: 3.8 },
  { ref: '9', value: 85 },
  { ref: '10', value: 0.05 },
  { ref: '12', observed: true }
];

const run = (readings: any[], over: any = {}) =>
  evaluateSwt({ pipeType: 'SINGLE', loadCondition: 'EMPTY', wagonType: 'BOXN', readings, ...over });

describe('Single Wagon Test Specification', () => {
  it('TC-SWT-01: every check cites the manual', () => {
    for (const c of SWT_CHECKS) {
      assert.match(c.source, /WMM 2\.0 §(720-C|308B)/, `${c.ref} has no source`);
    }
  });

  it('TC-SWT-02: pipe configuration selects the right rows', () => {
    // AR pressure is 5 kg/cm2 on single pipe and 6 on twin. Applying the wrong
    // one would fail every twin-pipe wagon.
    const single = checksFor('SINGLE').map((c) => c.ref);
    const twin = checksFor('TWIN').map((c) => c.ref);

    assert.ok(single.includes('2') && !single.includes('2a'), 'single pipe uses row 2');
    assert.ok(twin.includes('2a') && !twin.includes('2'), 'twin pipe uses row 2a');
    assert.ok(twin.includes('1a'), 'twin pipe has a feed pipe');
    assert.ok(!single.includes('1a'), 'single pipe has no feed pipe');
  });

  it('TC-SWT-03: a complete, in-limit test passes', () => {
    const r = run(goodReadings);
    assert.strictEqual(r.passed, true, `failed: ${JSON.stringify(r.failedRefs)} missing: ${JSON.stringify(r.missingRefs)}`);
    assert.deepStrictEqual(r.failedRefs, []);
    assert.deepStrictEqual(r.missingRefs, []);
  });

  it('TC-SWT-04: a reading outside limit fails, and says why', () => {
    // Brake cylinder filling in 12 seconds is too fast — the proforma allows
    // 18 to 30.
    const r = run(goodReadings.map((x) => (x.ref === '4.1' ? { ref: '4.1', value: 12 } : x)));
    assert.strictEqual(r.passed, false);
    assert.deepStrictEqual(r.failedRefs, ['4.1']);
    const row = r.results.find((x) => x.ref === '4.1')!;
    assert.strictEqual(row.verdict, 'FAIL');
    assert.match(row.reason!, /outside 18–30 sec/);
  });

  it('TC-SWT-05: an unanswered row is not a pass', () => {
    // The point of a proforma is that every row is answered. Treating a blank
    // as satisfactory is how a test comes to mean nothing.
    const r = run(goodReadings.filter((x) => x.ref !== '6'));
    assert.strictEqual(r.passed, false);
    assert.deepStrictEqual(r.missingRefs, ['6']);
    assert.strictEqual(r.results.find((x) => x.ref === '6')!.verdict, null);
  });

  it('TC-SWT-06: insensitivity fails when the brakes DO apply', () => {
    // An inverted check: this row passes when nothing happens. Getting the
    // polarity wrong would pass a wagon whose brakes apply on their own.
    const r = run(goodReadings.map((x) => (x.ref === '7' ? { ref: '7', observed: false } : x)));
    assert.strictEqual(r.passed, false);
    assert.ok(r.failedRefs.includes('7'));
    assert.match(r.results.find((x) => x.ref === '7')!.reason!, /Brakes do not apply/);
  });

  it('TC-SWT-07: piston stroke follows the wagon type', () => {
    // §308B lists this per wagon. A BOXN loaded is 130±10; a BOXNHL is 120±10.
    // One figure for both would fail good wagons and pass bad ones.
    // 135 mm sits inside BOXN's loaded window (120–140) and outside BOXNHL's
    // (110–130). The same reading, the same test, two correct answers.
    const reading135 = goodReadings.map((x) => (x.ref === '9' ? { ref: '9', value: 135 } : x));

    const boxn = run(reading135, { loadCondition: 'LOADED', wagonType: 'BOXN' });
    assert.strictEqual(boxn.results.find((x) => x.ref === '9')!.verdict, 'PASS', 'BOXN allows 135');

    const hl = run(reading135, { loadCondition: 'LOADED', wagonType: 'BOXNHL' });
    assert.strictEqual(hl.results.find((x) => x.ref === '9')!.verdict, 'FAIL', 'BOXNHL does not');
    assert.match(hl.results.find((x) => x.ref === '9')!.reason!, /outside 110–130 mm/);
  });

  it('TC-SWT-08: empty and loaded strokes differ', () => {
    const empty = run(goodReadings, { loadCondition: 'EMPTY', wagonType: 'BOXN' });
    assert.strictEqual(empty.results.find((x) => x.ref === '9')!.specified, '75–95 mm');

    const loaded = run(
      goodReadings.map((x) => (x.ref === '9' ? { ref: '9', value: 130 } : x)),
      { loadCondition: 'LOADED', wagonType: 'BOXN' }
    );
    assert.strictEqual(loaded.results.find((x) => x.ref === '9')!.specified, '120–140 mm');
  });

  it('TC-SWT-09: a wagon with no published stroke is recorded, not judged', () => {
    // Same discipline as the CTRB end cap: measure it, do not invent a limit.
    const r = run(goodReadings, { wagonType: 'BRNAHS' });
    const row = r.results.find((x) => x.ref === '9')!;
    assert.strictEqual(row.verdict, null);
    assert.match(row.reason!, /No published limit/);
    assert.strictEqual(r.passed, false, 'an unjudged row cannot count as a pass');
    assert.ok(r.unjudgedRefs.includes('9'));
  });

  it('TC-SWT-10: every stroke range is a real window around the stated nominal', () => {
    for (const [wagon, spec] of Object.entries(PISTON_STROKE_MM)) {
      assert.strictEqual(spec.empty[1] - spec.empty[0], 20, `${wagon} empty is not ±10`);
      if (spec.loaded) {
        assert.strictEqual(spec.loaded[1] - spec.loaded[0], 20, `${wagon} loaded is not ±10`);
        assert.ok(spec.loaded[0] > spec.empty[0], `${wagon}: loaded stroke should exceed empty`);
      }
    }
  });

  it('TC-SWT-11: pressure tolerances match the proforma exactly', () => {
    const bp = SWT_CHECKS.find((c) => c.ref === '1')!;
    assert.strictEqual(bp.min, 4.9);
    assert.strictEqual(bp.max, 5.1);          // 5 ± 0.1

    const fp = SWT_CHECKS.find((c) => c.ref === '1a')!;
    assert.strictEqual(fp.min, 5.9);
    assert.strictEqual(fp.max, 6.1);          // 6 ± 0.1

    const bc = SWT_CHECKS.find((c) => c.ref === '4.2')!;
    assert.strictEqual(bc.min, 3.7);
    assert.strictEqual(bc.max, 3.9);          // 3.8 ± 0.1
  });

  it('TC-SWT-12: leakage limits are maxima with no floor', () => {
    // Zero leakage is the ideal, so these rows must never fail a tight system.
    for (const ref of ['3', '10']) {
      const c = SWT_CHECKS.find((x) => x.ref === ref)!;
      assert.strictEqual(c.min, undefined, `${ref} must not have a minimum`);
      assert.strictEqual(c.max, 0.1);
    }
    const r = run(goodReadings.map((x) => (x.ref === '3' ? { ref: '3', value: 0 } : x)));
    assert.strictEqual(r.results.find((x) => x.ref === '3')!.verdict, 'PASS');
  });
});
