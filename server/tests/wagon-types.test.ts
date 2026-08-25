/**
 * Wagon Type Registry Tests
 * Indian Railways WRS Raipur
 *
 * The shop names a wagon, not a bogie. Asking for "bogie type and axle load"
 * made the inspector do a lookup, in vocabulary they do not lead with, before
 * the app could do anything useful.
 *
 * These pin the registry against WMM 2.0 Tables 1.1–1.3, and pin the two
 * things it must refuse to do: guess an unknown designation, and classify
 * springs on a bogie whose band table this system does not hold.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WAGON_SPRING_CONFIGS,
  getWagonSpringConfig,
  listWagonDesignations,
  springsPerBogie,
  springsPerWagon,
  canClassifySprings
} from '../../shared/classification/wagonTypes.ts';
import { getSpringCount } from '../../shared/classification/springCounts.ts';

describe('Wagon Type Registry', () => {
  it('TC-WGN-01: the types WRS Raipur named are all present', () => {
    // From the shop directly: NLB and HS bogies, "LWL", BOSTHS M1 and M2.
    for (const d of ['BOXN', 'BOXNHS', 'BOXNLW', 'BOSTHS', 'BOSTHS M1', 'BOSTHS M2']) {
      assert.ok(getWagonSpringConfig(d), `${d} is not in the registry`);
    }
  });

  it('TC-WGN-02: BOSTHS M1 and M2 differ, and differ the way the manual says', () => {
    // Easy to assume the two modification marks are cosmetic. They are not:
    // M1 carries four more springs per bogie than M2.
    const m1 = getWagonSpringConfig('BOSTHS M1')!;
    const m2 = getWagonSpringConfig('BOSTHS M2')!;

    assert.deepStrictEqual(m1.counts, { outer: 14, inner: 14, snubber: 4 });
    assert.deepStrictEqual(m2.counts, { outer: 12, inner: 12, snubber: 4 });
    assert.strictEqual(springsPerBogie(m1), 32);
    assert.strictEqual(springsPerBogie(m2), 28);
    assert.strictEqual(springsPerWagon(m1), 64);
    assert.strictEqual(springsPerWagon(m2), 56);
  });

  it('TC-WGN-03: agrees with the counts already sourced from WMM §601', () => {
    // Two independent parts of the manual, reached separately. A number that
    // decides whether a wagon is released should be corroborated, not trusted
    // because it was found first.
    const boxn = getWagonSpringConfig('BOXN')!;
    assert.deepStrictEqual(boxn.counts, getSpringCount('CASNUB_22_NLB', '20.32t')!.counts);

    const boxnhs = getWagonSpringConfig('BOXNHS')!;
    assert.deepStrictEqual(boxnhs.counts, getSpringCount('CASNUB_22_HS', '20.32t')!.counts);
  });

  it('TC-WGN-04: matching is forgiving about how it is typed', () => {
    const canonical = getWagonSpringConfig('BOSTHS M2');
    for (const variant of ['bosths m2', 'BOSTHS-M2', 'BOSTHS  M2', ' bosths_m2 ']) {
      assert.deepStrictEqual(getWagonSpringConfig(variant), canonical, `failed on "${variant}"`);
    }
  });

  it('TC-WGN-05: an unknown designation returns null rather than a near miss', () => {
    // The failure that would matter: quietly resolving BOSTHS M3 to BOSTHS M2
    // and sweeping the wrong number of springs.
    for (const unknown of ['BOSTHS M3', 'BOXN99', 'WAGON', '', 'BOX']) {
      assert.strictEqual(getWagonSpringConfig(unknown), null, `guessed at "${unknown}"`);
    }
  });

  it('TC-WGN-06: every entry cites the table it came from', () => {
    for (const w of WAGON_SPRING_CONFIGS) {
      assert.match(w.tableRef, /WMM 2\.0 Table 1\.[123]/, `${w.designation} has no source`);
    }
  });

  it('TC-WGN-07: counts are plausible whole springs', () => {
    for (const w of WAGON_SPRING_CONFIGS) {
      for (const [k, v] of Object.entries(w.counts)) {
        assert.ok(Number.isInteger(v) && v > 0 && v <= 20, `${w.designation}.${k} = ${v}`);
      }
      // Every CASNUB variant in these tables carries four snubbers.
      assert.strictEqual(w.counts.snubber, 4, `${w.designation} snubber count`);
    }
  });

  it('TC-WGN-08: a bogie with no band table is counted but not classified', () => {
    // NLC and IRF 108 wagons are real and in the tables. Their spring counts
    // are published; their band tables are not held here. Counting is not
    // classifying, and pretending otherwise would produce a confident band for
    // a spring nobody has a table for.
    for (const d of ['BOXNEL', 'BOYEL', 'BOXNHA', 'BOXNHAM']) {
      const w = getWagonSpringConfig(d)!;
      assert.strictEqual(w.bogieType, null, `${d} must not claim a band table`);
      assert.strictEqual(canClassifySprings(w), false);
      assert.ok(w.counts.outer > 0, `${d} should still have a usable spring count`);
      assert.match(w.notes || '', /no G-95 band table/i, `${d} must say why`);
    }
  });

  it('TC-WGN-09: CASNUB wagons can be classified', () => {
    for (const d of ['BOXN', 'BOSTHS M2', 'BRNA', 'BCNAHS']) {
      const w = getWagonSpringConfig(d)!;
      assert.ok(canClassifySprings(w), `${d} should be classifiable`);
      assert.ok(w.bogieType === 'CASNUB_22_NLB' || w.bogieType === 'CASNUB_22_HS');
    }
  });

  it('TC-WGN-10: the box and flat wagons WRS Raipur runs are both covered', () => {
    const open = listWagonDesignations('OPEN');
    const flat = listWagonDesignations('FLAT');
    assert.ok(open.length >= 15, 'open wagons');
    assert.ok(flat.length >= 8, 'flat wagons');
    assert.ok(open.every((w) => w.category === 'OPEN'));
    assert.ok(flat.every((w) => w.category === 'FLAT'));
  });

  it('TC-WGN-11: designations are unique', () => {
    const seen = WAGON_SPRING_CONFIGS.map((w) => w.designation);
    assert.strictEqual(new Set(seen).size, seen.length, 'duplicate designation in the registry');
  });
});
