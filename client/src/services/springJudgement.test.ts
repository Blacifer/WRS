/**
 * Judging a spring, whichever bogie it came off
 * Indian Railways WRS Raipur
 *
 * The §309C condemning limits for LWLH25 and LCCF20 were transcribed, tested
 * and documented as closing "the safety-critical half" — and then nothing
 * imported them. `BogieType` listed only the three CASNUB variants and the
 * sorting screen offered only those three, so an inspector holding a BOXNS
 * spring could not select its bogie, let alone condemn it. BOXNS is 369
 * wagons a year at Raipur, the fifth busiest type in the shop.
 *
 * These tests are about the routing: that the right published rule is applied
 * to the right bogie, and that a bogie covered by neither is refused rather
 * than guessed at.
 */

import { describe, it, expect } from 'vitest';
import {
  judgeSortedSpring,
  isBandedBogie,
  isSortingBogie,
  SORTING_BOGIES
} from '../../../shared/classification/springJudgement.ts';

describe('Applying the rule the bogie is published under', () => {
  it('gives a CASNUB spring its G-95 band', () => {
    const v = judgeSortedSpring({
      bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'OUTER', measuredHeight: 258.5
    });
    expect(v.status).toBe('PASS');
    expect(v.band).toBe('GREEN');
    expect(v.bandingAvailable).toBe(true);
  });

  it('gives an LWLH25 spring a verdict and no band', () => {
    // §309C publishes a nominal and a condemning height and nothing between.
    // Six bands could be manufactured by dividing that range and would look
    // identical on screen to a real classification while being invented.
    const v = judgeSortedSpring({
      bogieType: 'LWLH25', condition: 'USED', position: 'OUTER', measuredHeight: 260
    });
    expect(v.status).toBe('PASS');
    expect(v.band).toBeNull();
    expect(v.bandRoman).toBeNull();
    expect(v.bandingAvailable).toBe(false);
    expect(v.tableReference).toContain('309C');
  });

  it('condemns below the published condemning height, and says by how much', () => {
    const v = judgeSortedSpring({
      bogieType: 'LWLH25', condition: 'USED', position: 'OUTER', measuredHeight: 240
    });
    expect(v.status).toBe('CONDEMNED');
    expect(v.condemnationReason).toMatch(/240/);
    expect(v.condemnationReason).toMatch(/249/);
  });

  it('holds the boundary for both non-banded bogies, every position', () => {
    for (const bogie of ['LWLH25', 'LCCF20'] as const) {
      for (const position of ['OUTER', 'INNER', 'SNUBBER'] as const) {
        const at = judgeSortedSpring({ bogieType: bogie, condition: 'USED', position, measuredHeight: 999 });
        expect(at.status, `${bogie} ${position} well above`).toBe('PASS');
        const below = judgeSortedSpring({ bogieType: bogie, condition: 'USED', position, measuredHeight: 1 });
        expect(below.status, `${bogie} ${position} well below`).toBe('CONDEMNED');
      }
    }
  });

  it('condemns a damaged non-banded spring whatever it measures', () => {
    /*
     * A cracked spring measures perfectly. Leaving damage out of this path
     * would have made it recordable on a CASNUB spring and invisible on an
     * LWLH25 one — the same defect, judged differently by accident of bogie.
     */
    const v = judgeSortedSpring({
      bogieType: 'LWLH25', condition: 'USED', position: 'OUTER',
      measuredHeight: 264, damageType: 'CRACK', damageNotes: 'second coil'
    });
    expect(v.status).toBe('CONDEMNED');
    expect(v.condemnationReason).toMatch(/CRACK/);
    expect(v.condemnationReason).toMatch(/second coil/);
    expect(v.band).toBeNull();
  });

  it('carries the manual’s own unexplained notation rather than dropping it', () => {
    const v = judgeSortedSpring({
      bogieType: 'LWLH25', condition: 'USED', position: 'SNUBBER', measuredHeight: 270
    });
    expect(v.note).toMatch(/SO/);
  });
});

describe('Refusing what it cannot judge', () => {
  it('throws for a bogie neither rule covers', () => {
    // Quietly returning PASS would be the worst outcome available.
    expect(() =>
      judgeSortedSpring({ bogieType: 'IRF_108_HS' as any, condition: 'USED', position: 'OUTER', measuredHeight: 260 })
    ).toThrow();
  });

  it('knows which family each bogie belongs to', () => {
    expect(isBandedBogie('CASNUB_22_NLB')).toBe(true);
    expect(isBandedBogie('LWLH25')).toBe(false);
    expect(isSortingBogie('LWLH25')).toBe(true);
    expect(isSortingBogie('LCCF20')).toBe(true);
    expect(isSortingBogie('IRF_108_HS')).toBe(false);
  });
});

describe('What the sorting screen offers', () => {
  it('offers every bogie the app can actually judge', () => {
    const offered = SORTING_BOGIES.map((b) => b.value);
    for (const b of ['CASNUB_22_NLB', 'CASNUB_22_HS', 'CASNUB_22_RFT', 'LWLH25', 'LCCF20']) {
      expect(offered, `${b} must be selectable`).toContain(b);
    }
  });

  it('every offered bogie can be judged without throwing', () => {
    // The gap this closes: a bogie in the dropdown that the engine refuses is
    // worse than one that is absent, because the inspector has already
    // measured the spring by the time it fails.
    for (const b of SORTING_BOGIES) {
      expect(() =>
        judgeSortedSpring({ bogieType: b.value, condition: 'USED', position: 'OUTER', measuredHeight: 258 })
      , `${b.value} is offered but cannot be judged`).not.toThrow();
    }
  });

  it('marks which offered bogies produce a colour and which do not', () => {
    for (const b of SORTING_BOGIES) {
      const v = judgeSortedSpring({
        bogieType: b.value, condition: 'USED', position: 'OUTER', measuredHeight: 258
      });
      expect(v.bandingAvailable, `${b.value} banding flag`).toBe(b.banded);
      if (!b.banded) expect(v.band).toBeNull();
    }
  });
});
