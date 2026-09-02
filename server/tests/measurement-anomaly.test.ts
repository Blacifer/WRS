/**
 * Measurement Anomaly Tests
 * Indian Railways WRS Raipur
 *
 * Every free height in this system is typed in by a person reading a caliper.
 * There is no instrument path, so transcription error is permanent and the
 * only defence is noticing it.
 *
 * These tests pin the two properties that make the check safe to deploy: it
 * stays quiet until it has grounds to speak, and it never produces anything
 * but an advisory. A flag that fired on ordinary readings would be switched
 * off within a week, and a flag that blocked would be a safety limit written
 * by a statistician rather than by RDSO.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMeasurementAnomaly,
  MIN_POPULATION,
  REPEAT_RUN_LENGTH,
  type AnomalyPopulation
} from '../../shared/analysis/measurementAnomaly.ts';

/** A realistic NLB outer population: tight, inside a band, slightly varied. */
function nlbOuterPopulation(overrides: Partial<AnomalyPopulation> = {}): AnomalyPopulation {
  return {
    bogieType: 'CASNUB_22_NLB',
    springPosition: 'OUTER',
    condition: 'USED',
    heights: [
      260.5, 261.0, 260.0, 259.5, 261.5, 260.5, 262.0, 259.0,
      260.5, 261.0, 260.0, 260.5, 261.5, 259.5, 260.0, 261.0
    ],
    ...overrides
  };
}

describe('Measurement anomaly — an advisory second pair of eyes', () => {
  describe('1. Refusing to speak without grounds', () => {
    it('TC-ANOM-01: says nothing at all below the minimum population', () => {
      const res = findMeasurementAnomaly(206.5, {
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        heights: [260.5, 261.0, 260.0, 259.5]
      });

      assert.equal(res.flagged, false);
      assert.equal(res.findings.length, 0);
      assert.match(res.reason ?? '', /Not enough history/);
      assert.ok(res.reason?.includes(String(MIN_POPULATION)));
    });

    it('TC-ANOM-02: the threshold is a floor, not a suggestion', () => {
      const heights = Array.from({ length: MIN_POPULATION - 1 }, () => 260.5);
      const res = findMeasurementAnomaly(206.5, {
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        heights
      });
      // One short is still short, however obvious the outlier looks.
      assert.equal(res.flagged, false);
    });
  });

  describe('2. Staying quiet on ordinary readings', () => {
    it('TC-ANOM-03: a reading at the centre of the population is not flagged', () => {
      const res = findMeasurementAnomaly(260.5, nlbOuterPopulation());
      assert.equal(res.flagged, false, 'a typical reading must never be questioned');
    });

    it('TC-ANOM-04: ordinary spread within the band passes unremarked', () => {
      for (const h of [259.0, 259.5, 260.0, 261.0, 262.0]) {
        const res = findMeasurementAnomaly(h, nlbOuterPopulation());
        assert.equal(res.flagged, false, `${h} mm is ordinary and must not be flagged`);
      }
    });

    it('TC-ANOM-05: a genuinely condemned spring near the population is not called a typo', () => {
      /*
       * This is the case that matters most. A worn spring reading a little low
       * is exactly what the system exists to catch, and the anomaly check must
       * not cast doubt on it — RDSO condemns it, and this module has no
       * opinion.
       */
      const res = findMeasurementAnomaly(258.0, nlbOuterPopulation());
      assert.equal(res.flagged, false);
    });
  });

  describe('3. Catching what hand entry actually gets wrong', () => {
    it('TC-ANOM-06: a digit transposition is flagged and named', () => {
      // 260.50 typed as 206.50 — adjacent digits swapped.
      const res = findMeasurementAnomaly(206.5, nlbOuterPopulation());

      assert.equal(res.flagged, true);
      const outlier = res.findings.find((f) => f.kind === 'OUT_OF_POPULATION');
      assert.ok(outlier, 'should be recognised as outside the population');

      const transposed = res.findings.find((f) => f.kind === 'DIGIT_TRANSPOSITION');
      assert.ok(transposed, 'should recognise the swap that explains it');
      assert.equal(transposed.suggested, 260.5);
      assert.match(transposed.message, /Did you mean 260\.5 mm\?/);
    });

    it('TC-ANOM-07: an outlier with no transposition explanation is still flagged, without a guess', () => {
      const res = findMeasurementAnomaly(180.0, nlbOuterPopulation());
      assert.equal(res.flagged, true);
      assert.ok(res.findings.some((f) => f.kind === 'OUT_OF_POPULATION'));
      assert.equal(
        res.findings.some((f) => f.kind === 'DIGIT_TRANSPOSITION'),
        false,
        'no swap explains 180.0, so none must be offered'
      );
    });

    it('TC-ANOM-08: a run of identical readings asks whether each was gauged', () => {
      const res = findMeasurementAnomaly(260.5, nlbOuterPopulation({
        recentInOrder: Array.from({ length: REPEAT_RUN_LENGTH - 1 }, () => 260.5)
      }));

      const repeat = res.findings.find((f) => f.kind === 'REPEATED_VALUE');
      assert.ok(repeat, `${REPEAT_RUN_LENGTH} identical readings should be questioned`);
      assert.match(repeat.message, /in a row/);
      assert.match(repeat.message, /please confirm/i);
    });

    it('TC-ANOM-09: a shorter run of identical readings is left alone', () => {
      const res = findMeasurementAnomaly(260.5, nlbOuterPopulation({
        recentInOrder: Array.from({ length: REPEAT_RUN_LENGTH - 3 }, () => 260.5)
      }));
      assert.equal(
        res.findings.some((f) => f.kind === 'REPEATED_VALUE'),
        false,
        'springs from one batch genuinely do repeat'
      );
    });

    it('TC-ANOM-10: the repeat check is skipped rather than guessed when order is unknown', () => {
      const res = findMeasurementAnomaly(260.5, nlbOuterPopulation());
      assert.equal(res.findings.some((f) => f.kind === 'REPEATED_VALUE'), false);
    });
  });

  describe('4. Robustness — the reason for median and MAD', () => {
    it('TC-ANOM-11: one bad reading already in the population does not blind the check', () => {
      /*
       * The mean-and-sigma version of this test fails: a single 206.5 among
       * these readings inflates the spread enough to swallow the next one.
       */
      const withTypo = nlbOuterPopulation();
      withTypo.heights = [...withTypo.heights, 206.5];

      const res = findMeasurementAnomaly(206.5, withTypo);
      assert.equal(res.flagged, true, 'a second typo must still be caught after a first got through');
    });

    it('TC-ANOM-12: an identical population falls back to the 3 mm band rule', () => {
      const res = findMeasurementAnomaly(206.5, {
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        heights: Array.from({ length: MIN_POPULATION + 4 }, () => 260.5)
      });
      // MAD is zero here; the check must degrade rather than divide by it.
      assert.equal(res.flagged, true);
      const f = res.findings[0];
      assert.ok(Number.isFinite(f.median));
      assert.equal(f.median, 260.5);
    });

    it('TC-ANOM-13: a small drift against an identical population stays quiet', () => {
      const res = findMeasurementAnomaly(262.0, {
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        heights: Array.from({ length: MIN_POPULATION + 4 }, () => 260.5)
      });
      assert.equal(res.flagged, false, '1.5 mm is inside one band and unremarkable');
    });
  });

  describe('5. It is an advisory and nothing more', () => {
    it('TC-ANOM-14: every finding carries both languages and no verdict', () => {
      const res = findMeasurementAnomaly(206.5, nlbOuterPopulation());
      assert.ok(res.findings.length > 0);

      for (const f of res.findings) {
        assert.ok(f.message.length > 0, 'must say something to the inspector');
        assert.ok(f.messageHi.length > 0, 'the shop floor reads Hindi too');
        assert.doesNotMatch(
          f.message,
          /\b(CONDEMNED|PASS|FAIL|REJECT)\b/,
          'an advisory must never appear to deliver a verdict'
        );
      }
    });

    it('TC-ANOM-15: the population size is always reported, flagged or not', () => {
      const quiet = findMeasurementAnomaly(260.5, nlbOuterPopulation());
      const loud = findMeasurementAnomaly(206.5, nlbOuterPopulation());
      assert.equal(quiet.populationSize, 16);
      assert.equal(loud.populationSize, 16);
    });
  });
});
