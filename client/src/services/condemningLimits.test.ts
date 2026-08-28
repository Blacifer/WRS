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
    for (const bogie of ['LWLH25', 'LCCF20'] as const) {
      for (const position of ['OUTER', 'INNER', 'SNUBBER'] as const) {
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
      for (const position of ['OUTER', 'INNER', 'SNUBBER'] as const) {
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

  it('carries the unexplained notation rather than interpreting it', () => {
    // The manual prints the LWLH25 snubber limit as "266(SO)" and does not
    // say what (SO) means. Guessing would be worse than passing it along.
    expect(CONDEMNING_LIMITS.LWLH25.SNUBBER!.note).toMatch(/SO/);
    expect(judgeAgainstCondemningLimit('LWLH25', 'SNUBBER', 270).note).toBeDefined();
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
