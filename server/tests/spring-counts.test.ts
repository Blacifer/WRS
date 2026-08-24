/**
 * Spring Count & Queue Tests
 * Indian Railways WRS Raipur
 *
 * The batch flow used to record one outer, one inner and one snubber reading
 * per bogie — six measurements for a whole wagon. A 20.32t NLB bogie carries
 * twenty-four springs, forty-eight per wagon, so eleven of twelve outer
 * springs were never measured and the exit gate cleared the wagon regardless.
 *
 * These tests pin the counts to the manual and prove the queue covers every
 * spring exactly once.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPRING_COUNTS,
  getSpringCount,
  getSpringCountOptions,
  buildSpringQueue,
  totalPerBogie,
  requiresManualCounts,
  isPlausibleCount
} from '../../shared/classification/springCounts.ts';

describe('CASNUB Spring Counts', () => {
  it('TC-CNT-01: NLB at 20.32t matches WMM 2.0 §601 exactly', () => {
    const o = getSpringCount('CASNUB_22_NLB', '20.32t')!;
    assert.ok(o, 'the documented configuration must exist');
    assert.deepStrictEqual(o.counts, { outer: 12, inner: 8, snubber: 4 });
    assert.strictEqual(o.verified, true);
    assert.strictEqual(totalPerBogie(o.counts), 24);
  });

  it('TC-CNT-02: NLB at CC+8t+2t carries more load springs', () => {
    const o = getSpringCount('CASNUB_22_NLB', 'CC+8t+2t')!;
    assert.deepStrictEqual(o.counts, { outer: 14, inner: 10, snubber: 4 });
    assert.strictEqual(o.verified, true);
  });

  it('TC-CNT-03: HS at 20.32t matches WMM 2.0 §601 exactly', () => {
    const o = getSpringCount('CASNUB_22_HS', '20.32t')!;
    assert.deepStrictEqual(o.counts, { outer: 14, inner: 12, snubber: 4 });
    assert.strictEqual(o.verified, true);
  });

  it('TC-CNT-04: RFT ships NO count, because none is published', () => {
    // RFT appears in the G-95 band tables but in no spring-count table — not
    // WMM 2.0 §601, not IRIMEE's identical training table, nor any public RDSO
    // source found. It must be asked for, never assumed.
    assert.deepStrictEqual(
      getSpringCountOptions('CASNUB_22_RFT'),
      [],
      'shipping a guessed RFT count would produce a confident, wrong gate check'
    );
    assert.strictEqual(requiresManualCounts('CASNUB_22_RFT'), true);
  });

  it('TC-CNT-04b: RFT must not silently inherit another type’s configuration', () => {
    // Guards the specific mistake that was shipped and reverted: defaulting RFT
    // to NLB. G-95 gives RFT different springs entirely (272 mm outer against
    // NLB's 260), so the suspension is not the same and the counts cannot be
    // assumed to be either.
    const rft = getSpringCount('CASNUB_22_RFT', '20.32t');
    assert.strictEqual(rft, null, 'RFT must resolve to no configuration at all');
  });

  it('TC-CNT-04c: documented types never ask for a hand count', () => {
    assert.strictEqual(requiresManualCounts('CASNUB_22_NLB'), false);
    assert.strictEqual(requiresManualCounts('CASNUB_22_HS'), false);
  });

  it('TC-CNT-04d: hand-entered counts are bounds-checked', () => {
    assert.strictEqual(isPlausibleCount({ outer: 12, inner: 8, snubber: 4 }), true);
    assert.strictEqual(isPlausibleCount({ outer: 0, inner: 8, snubber: 4 }), false, 'zero is not a nest');
    assert.strictEqual(isPlausibleCount({ outer: 99, inner: 8, snubber: 4 }), false, 'implausibly large');
    assert.strictEqual(isPlausibleCount({ outer: 12.5, inner: 8, snubber: 4 }), false, 'springs are whole');
  });

  it('TC-CNT-05: every verified entry cites the manual section it came from', () => {
    for (const options of Object.values(SPRING_COUNTS)) {
      for (const o of options) {
        if (!o.verified) continue;
        assert.ok(
          o.source.includes('WMM 2.0 §601'),
          `verified count "${o.axleLoad}" must cite its source, got: ${o.source}`
        );
      }
    }
  });

  it('TC-CNT-06: the queue covers both bogies and every spring exactly once', () => {
    const counts = getSpringCount('CASNUB_22_NLB', '20.32t')!.counts;
    const queue = buildSpringQueue(counts);

    assert.strictEqual(queue.length, 48, 'a 24-spring bogie means 48 per wagon');

    for (const bogie of ['BOGIE_1', 'BOGIE_2'] as const) {
      const onBogie = queue.filter((q) => q.bogiePosition === bogie);
      assert.strictEqual(onBogie.filter((q) => q.position === 'OUTER').length, 12);
      assert.strictEqual(onBogie.filter((q) => q.position === 'INNER').length, 8);
      assert.strictEqual(onBogie.filter((q) => q.position === 'SNUBBER').length, 4);
    }
  });

  it('TC-CNT-07: each spring is numbered within its own nest, without gaps', () => {
    const counts = getSpringCount('CASNUB_22_HS', '20.32t')!.counts;
    const queue = buildSpringQueue(counts);

    for (const bogie of ['BOGIE_1', 'BOGIE_2'] as const) {
      for (const position of ['OUTER', 'INNER', 'SNUBBER'] as const) {
        const nest = queue.filter((q) => q.bogiePosition === bogie && q.position === position);
        const indices = nest.map((q) => q.indexInNest).sort((a, b) => a - b);
        const expected = Array.from({ length: nest.length }, (_, i) => i + 1);
        assert.deepStrictEqual(indices, expected, `${bogie} ${position} numbering is not 1..n`);
        for (const q of nest) {
          assert.strictEqual(q.nestSize, nest.length, 'nestSize must match the real nest size');
        }
      }
    }
  });

  it('TC-CNT-08: heavier axle loads never reduce the spring count', () => {
    // A sanity property: uprating a bogie adds load springs, never removes them.
    for (const options of Object.values(SPRING_COUNTS)) {
      const base = options.find((o) => o.axleLoad === '20.32t');
      const heavier = options.find((o) => o.axleLoad === 'CC+8t+2t');
      if (!base || !heavier) continue;
      assert.ok(heavier.counts.outer >= base.counts.outer, 'outer count must not drop');
      assert.ok(heavier.counts.inner >= base.counts.inner, 'inner count must not drop');
    }
  });

  it('TC-CNT-09: the queue works through one nest at a time', () => {
    // An inspector empties one nest before moving on; the queue must not
    // interleave positions or bogies.
    const queue = buildSpringQueue(getSpringCount('CASNUB_22_NLB', '20.32t')!.counts);
    const seen: string[] = [];
    for (const q of queue) {
      const key = `${q.bogiePosition}/${q.position}`;
      if (seen[seen.length - 1] !== key) {
        assert.ok(!seen.includes(key), `returned to ${key} after leaving it — nests must be contiguous`);
        seen.push(key);
      }
    }
    assert.strictEqual(seen.length, 6, 'two bogies x three positions = six contiguous nests');
  });
});
