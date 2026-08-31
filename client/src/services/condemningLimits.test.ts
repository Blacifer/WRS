/**
 * Bogies judged by condemning limit rather than band
 * Indian Railways WRS Raipur
 *
 * BOXNS rides LWLH25 and is 369 wagons a year at Raipur. Until these limits
 * were found in WMM 2.0 §309C the app could count its springs but not judge
 * them, so a condemnation had nowhere to go.
 *
 * The tests below are about two things: the boundary, because inverting it
 * would condemn serviceable springs on the shop's fifth busiest wagon; and
 * the absence of a band, because inventing one would be indistinguishable on
 * screen from a real G-95 classification.
 */

import { describe, it, expect } from 'vitest';
import {
  judgeAgainstCondemningLimit,
  isNonBandedBogie,
  CONDEMNING_LIMITS
} from '../../../shared/classification/condemningLimits.ts';
import { getWagonSpringConfig } from '../../../shared/classification/wagonTypes.ts';
import { MAX_NEST_HEIGHT_VARIATION_MM } from '../../../shared/classification/nestGrouping.ts';

describe('The boundary', () => {
  it('passes a spring exactly at the condemning height', () => {
    // The manual gives a condemning height and a spring is condemned BELOW
    // it. At it, the spring is still serviceable.
    const v = judgeAgainstCondemningLimit('LWLH25', 'OUTER', 249);
    expect(v.status).toBe('PASS');
    expect(v.margin).toBe(0);
  });

  it('condemns one millimetre below', () => {
    expect(judgeAgainstCondemningLimit('LWLH25', 'OUTER', 248).status).toBe('CONDEMNED');
  });

  it('holds the boundary for every position of every bogie', () => {
    const positionsFor = (bogie: 'LWLH25' | 'LCCF20') =>
      // LWLH25 splits its snubber; LCCF20 does not.
      (bogie === 'LWLH25'
        ? (['OUTER', 'INNER', 'SNUBBER_OUTER', 'SNUBBER_INNER'] as const)
        : (['OUTER', 'INNER', 'SNUBBER'] as const));

    for (const bogie of ['LWLH25', 'LCCF20'] as const) {
      for (const position of positionsFor(bogie)) {
        const limit = CONDEMNING_LIMITS[bogie][position]!.condemning;
        expect(
          judgeAgainstCondemningLimit(bogie, position, limit).status,
          `${bogie} ${position} at ${limit}`
        ).toBe('PASS');
        expect(
          judgeAgainstCondemningLimit(bogie, position, limit - 0.1).status,
          `${bogie} ${position} just below ${limit}`
        ).toBe('CONDEMNED');
      }
    }
  });
});

describe('Never inventing a band', () => {
  it('returns no band, because none is published', () => {
    /*
     * WMM 2.0 §309C gives a nominal and a condemning height and nothing
     * between. Six bands could be manufactured by dividing that range, and
     * the result would look exactly like a real G-95 classification on screen
     * while being fabricated.
     */
    for (const bogie of ['LWLH25', 'LCCF20'] as const) {
      const positions = bogie === 'LWLH25'
        ? (['OUTER', 'INNER', 'SNUBBER_OUTER', 'SNUBBER_INNER'] as const)
        : (['OUTER', 'INNER', 'SNUBBER'] as const);
      for (const position of positions) {
        expect(judgeAgainstCondemningLimit(bogie, position, 260).band).toBeNull();
      }
    }
  });

  it('cites the clause on every verdict', () => {
    const v = judgeAgainstCondemningLimit('LCCF20', 'INNER', 240);
    expect(v.source).toContain('309C');
    expect(v.source).toContain('LCCF20');
  });

  it('keeps the nominal as printed, tolerance and all', () => {
    // "243+0/-3" rounded to 243 would silently discard the asymmetry.
    expect(CONDEMNING_LIMITS.LCCF20.INNER!.nominal).toBe('243+0/-3');
    expect(CONDEMNING_LIMITS.LWLH25.OUTER!.nominal).toBe('264±3');
  });

  it('knows the LWLH25 snubber is two springs with two limits', () => {
    /*
     * WMM 2.0 §309C prints "266(SO)" and never says what (SO) means, so this
     * file held one snubber limit of 266 and a note recording the mystery.
     * RDSO Technical Pamphlet G-112 (page 89) resolves it: SO is Snubber
     * Outer, SI is Snubber Inner, the LWLH25 group is "4 (2SO & 2SI)", and
     * the two condemn at different heights.
     *
     * This is the assertion that matters: a Snubber Inner at 270mm is
     * CONDEMNED. It was called serviceable, because it was being judged
     * against the outer spring's limit.
     */
    expect(judgeAgainstCondemningLimit('LWLH25', 'SNUBBER_INNER', 270).status).toBe('CONDEMNED');
    expect(judgeAgainstCondemningLimit('LWLH25', 'SNUBBER_OUTER', 270).status).toBe('PASS');

    expect(CONDEMNING_LIMITS.LWLH25.SNUBBER_OUTER!.condemning).toBe(266);
    expect(CONDEMNING_LIMITS.LWLH25.SNUBBER_INNER!.condemning).toBe(274);
    expect(CONDEMNING_LIMITS.LWLH25.SNUBBER_OUTER!.nominal).toBe('281±3');
    expect(CONDEMNING_LIMITS.LWLH25.SNUBBER_INNER!.nominal).toBe('289±3');
  });

  it('refuses to judge an unspecified LWLH25 snubber', () => {
    // On this bogie the question is incomplete. Answering it would mean
    // silently picking one of the two limits, which is how the eight
    // millimetre window opened in the first place.
    expect(() => judgeAgainstCondemningLimit('LWLH25', 'SNUBBER', 270)).toThrow();
    // LCCF20 has one undifferentiated snubber, so there it is a fair question.
    expect(judgeAgainstCondemningLimit('LCCF20', 'SNUBBER', 275).status).toBe('PASS');
  });

  it('condemns every height in the window that used to pass', () => {
    /*
     * The whole defect, stated as a range. Between the outer limit and the
     * inner one, a Snubber Inner spring was serviceable according to this
     * app and condemned according to RDSO.
     */
    for (let h = 266; h < 274; h++) {
      expect(
        judgeAgainstCondemningLimit('LWLH25', 'SNUBBER_INNER', h).status,
        `Snubber Inner at ${h}mm`
      ).toBe('CONDEMNED');
      expect(
        judgeAgainstCondemningLimit('LWLH25', 'SNUBBER_OUTER', h).status,
        `Snubber Outer at ${h}mm`
      ).toBe('PASS');
    }
  });
});

describe('Refusing what it cannot judge', () => {
  it('throws rather than guessing for a bogie it does not hold', () => {
    expect(() => judgeAgainstCondemningLimit('CASNUB_22_NLB' as any, 'OUTER', 260)).toThrow();
  });

  it('throws on a measurement that is not a number', () => {
    expect(() => judgeAgainstCondemningLimit('LWLH25', 'OUTER', NaN)).toThrow();
  });

  it('knows which bogies it speaks for', () => {
    expect(isNonBandedBogie('LWLH25')).toBe(true);
    expect(isNonBandedBogie('LCCF20')).toBe(true);
    // CASNUB has real band tables and must never be routed here.
    expect(isNonBandedBogie('CASNUB_22_NLB')).toBe(false);
    expect(isNonBandedBogie('CASNUB_22_HS')).toBe(false);
  });
});

/*
 * RDSO Technical Pamphlet G-112, page 89, as a second source.
 *
 * The spring counts and the grouping rule in this app came from elsewhere.
 * The pamphlet states them independently, so these pin our numbers to it —
 * a second document agreeing is worth more than either one alone, and a
 * silent drift away from both is worth catching.
 */
describe('Agreeing with RDSO G-112', () => {
  it('matches Table 26 on how many springs a group carries', () => {
    // Per GROUP in the pamphlet; the app stores per BOGIE, which is two groups.
    const perGroup = (d: string) => {
      const c = getWagonSpringConfig(d)!;
      return { outer: c.counts.outer / 2, inner: c.counts.inner / 2, snubber: c.counts.snubber / 2 };
    };

    // LWLH25 at 25t: Outer 6, Inner 6, Snubber 4 (2SO & 2SI)
    expect(perGroup('BOXNS')).toEqual({ outer: 6, inner: 6, snubber: 4 });
    // LCCF20(C) at 20.3t: Outer 7, Inner 6, Snubber 2
    expect(perGroup('BLCA')).toEqual({ outer: 7, inner: 6, snubber: 2 });
  });

  it('matches Table 27 on every condemning height', () => {
    expect(CONDEMNING_LIMITS.LWLH25.OUTER!.condemning).toBe(249);
    expect(CONDEMNING_LIMITS.LWLH25.INNER!.condemning).toBe(231);
    expect(CONDEMNING_LIMITS.LWLH25.SNUBBER_OUTER!.condemning).toBe(266);
    expect(CONDEMNING_LIMITS.LWLH25.SNUBBER_INNER!.condemning).toBe(274);
    expect(CONDEMNING_LIMITS.LCCF20.OUTER!.condemning).toBe(245);
    expect(CONDEMNING_LIMITS.LCCF20.INNER!.condemning).toBe(228);
    expect(CONDEMNING_LIMITS.LCCF20.SNUBBER!.condemning).toBe(273);
  });

  it('keeps §5.10.3’s three millimetres as the grouping rule', () => {
    // "springs having not more than 3 mm free height variation should be
    // assembled in the same group" — the same figure the G-95 bands step in.
    expect(MAX_NEST_HEIGHT_VARIATION_MM).toBe(3.0);
  });
});
