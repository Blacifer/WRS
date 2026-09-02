/**
 * Nest Allocation Tests
 * Indian Railways WRS Raipur
 *
 * nestCapacity() answers "how many groups can each band supply", one band at a
 * time. That is not the shop floor's question. A bogie needs its outer, inner
 * and snubber groups together and is finished when the scarcest runs out —
 * twenty complete outer groups are worth nothing beside two snubber groups.
 *
 * These tests pin that the scarcest position decides, that it is named so
 * somebody knows what to sort next, and that springs which cannot join a group
 * are counted rather than quietly included.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateNests,
  type BandHolding,
  type NestRequirement
} from '../../shared/sorting/nestAllocation.ts';

/** A 20.32t NLB bogie: WMM 2.0 §601. */
const NLB: NestRequirement = { outer: 12, inner: 8, snubber: 4 };

describe('Nest allocation — what the sorted stock can actually build', () => {
  describe('1. The scarcest position decides', () => {
    it('TC-NEST-01: plenty of outers and few snubbers builds few bogies', () => {
      const holdings: BandHolding[] = [
        { springPosition: 'OUTER', band: 'BLUE', count: 240 },   // 20 groups
        { springPosition: 'INNER', band: 'GREEN', count: 80 },   // 10 groups
        { springPosition: 'SNUBBER', band: 'YELLOW', count: 8 }  //  2 groups
      ];

      const a = allocateNests(holdings, NLB);
      assert.equal(a.bogiesBuildable, 2, 'the snubbers are the whole answer');
      assert.equal(a.limitingPosition, 'SNUBBER');
    });

    it('TC-NEST-02: the limiting position is named so somebody knows what to sort', () => {
      const a = allocateNests(
        [
          { springPosition: 'OUTER', band: 'BLUE', count: 240 },
          { springPosition: 'INNER', band: 'GREEN', count: 8 },
          { springPosition: 'SNUBBER', band: 'YELLOW', count: 40 }
        ],
        NLB
      );

      assert.equal(a.limitingPosition, 'INNER');
      assert.match(a.summary, /sorting more of those raises the figure/);
    });

    it('TC-NEST-03: a position the bogie needs but nothing is sorted for holds it at zero', () => {
      /*
       * The failure this guards against: reporting the outer count as the
       * number of bogies buildable because no snubber was ever sorted.
       */
      const a = allocateNests(
        [
          { springPosition: 'OUTER', band: 'BLUE', count: 240 },
          { springPosition: 'INNER', band: 'GREEN', count: 80 }
        ],
        NLB
      );

      assert.equal(a.bogiesBuildable, 0);
      assert.equal(a.limitingPosition, 'SNUBBER');
    });
  });

  describe('2. Bands do not have to match across positions', () => {
    it('TC-NEST-04: an outer group in one band and an inner group in another is a complete bogie', () => {
      /*
       * The 3 mm rule governs one assembly group. Outer and inner springs are
       * different components with different nominal heights and different G-95
       * tables; requiring one band across all three would reject correct
       * assemblies.
       */
      const a = allocateNests(
        [
          { springPosition: 'OUTER', band: 'BLUE', count: 12 },
          { springPosition: 'INNER', band: 'ORANGE', count: 8 },
          { springPosition: 'SNUBBER', band: 'WHITE', count: 4 }
        ],
        NLB
      );

      assert.equal(a.bogiesBuildable, 1);
      assert.equal(a.totalStranded, 0);
    });

    it('TC-NEST-05: groups from several bands add up within a position', () => {
      const a = allocateNests(
        [
          { springPosition: 'OUTER', band: 'BLUE', count: 12 },
          { springPosition: 'OUTER', band: 'GREEN', count: 12 },
          { springPosition: 'INNER', band: 'GREEN', count: 16 },
          { springPosition: 'SNUBBER', band: 'YELLOW', count: 8 }
        ],
        NLB
      );

      assert.equal(a.bogiesBuildable, 2, 'two outer bands supply one group each');
      const outer = a.perPosition.find((p) => p.springPosition === 'OUTER');
      assert.equal(outer.completeGroups, 2);
    });
  });

  describe('3. Stranded springs are counted, not hidden', () => {
    it('TC-NEST-06: a remainder inside a band cannot join a group', () => {
      // 20 outers in one band is one group of 12 with 8 left over.
      const a = allocateNests(
        [
          { springPosition: 'OUTER', band: 'BLUE', count: 20 },
          { springPosition: 'INNER', band: 'GREEN', count: 8 },
          { springPosition: 'SNUBBER', band: 'YELLOW', count: 4 }
        ],
        NLB
      );

      const outer = a.perPosition.find((p) => p.springPosition === 'OUTER');
      assert.equal(outer.completeGroups, 1);
      assert.equal(outer.stranded, 8);
      assert.equal(a.totalStranded, 8);
    });

    it('TC-NEST-07: springs spread thinly across bands strand almost all of them', () => {
      /*
       * The case worth showing a supervisor: 33 outer springs held, not one
       * complete group, because no single band has twelve.
       */
      const a = allocateNests(
        [
          { springPosition: 'OUTER', band: 'BLUE', count: 11 },
          { springPosition: 'OUTER', band: 'GREEN', count: 11 },
          { springPosition: 'OUTER', band: 'YELLOW', count: 11 },
          { springPosition: 'INNER', band: 'GREEN', count: 8 },
          { springPosition: 'SNUBBER', band: 'YELLOW', count: 4 }
        ],
        NLB
      );

      const outer = a.perPosition.find((p) => p.springPosition === 'OUTER');
      assert.equal(outer.held, 33);
      assert.equal(outer.completeGroups, 0);
      assert.equal(outer.stranded, 33);
      assert.equal(a.bogiesBuildable, 0);
      assert.match(a.summary, /No complete bogie yet/);
    });
  });

  describe('4. Reporting', () => {
    it('TC-NEST-08: nothing sorted says so plainly rather than reporting zero of nothing', () => {
      const a = allocateNests([], NLB);
      assert.equal(a.bogiesBuildable, 0);
      assert.equal(a.limitingPosition, null);
      assert.equal(a.totalHeld, 0);
      assert.match(a.summary, /Nothing sorted yet/);
    });

    it('TC-NEST-09: bands are listed richest first', () => {
      const a = allocateNests(
        [
          { springPosition: 'OUTER', band: 'BLUE', count: 12 },
          { springPosition: 'OUTER', band: 'GREEN', count: 36 },
          { springPosition: 'INNER', band: 'GREEN', count: 8 },
          { springPosition: 'SNUBBER', band: 'YELLOW', count: 4 }
        ],
        NLB
      );

      const outer = a.perPosition.find((p) => p.springPosition === 'OUTER');
      assert.equal(outer.byBand[0].band, 'GREEN');
      assert.equal(outer.byBand[0].completeGroups, 3);
    });

    it('TC-NEST-10: the same stock always names the same limiting position', () => {
      // Ties must not wander between refreshes, or the screen looks unreliable.
      const holdings: BandHolding[] = [
        { springPosition: 'OUTER', band: 'BLUE', count: 12 },
        { springPosition: 'INNER', band: 'GREEN', count: 8 },
        { springPosition: 'SNUBBER', band: 'YELLOW', count: 4 }
      ];

      const first = allocateNests(holdings, NLB).limitingPosition;
      for (let i = 0; i < 5; i++) {
        assert.equal(allocateNests(holdings, NLB).limitingPosition, first);
      }
    });
  });
});
