/**
 * Bogies with a condemning limit but no band table
 * Indian Railways WRS Raipur
 *
 * WHY THESE ARE SEPARATE FROM RDSO_TABLES
 * ---------------------------------------
 * RDSO G-95 Rev-II gives CASNUB springs a six-band colour classification —
 * Blue through Red — and the sorting screen is built around it, because
 * grouping a nest by band is the job.
 *
 * LWLH25 and LCCF20 have no such table. WMM 2.0 §309C gives them a nominal
 * free height and a condemning height, and nothing between. So they get a
 * PASS or CONDEMNED and no colour, which is the whole of what the published
 * data supports.
 *
 * That distinction is worth keeping visible rather than smoothing over. It
 * would be easy to invent six bands by dividing the range, and the result
 * would look identical on screen to a real G-95 classification while being
 * something I made up.
 *
 * WHY IT MATTERS
 * --------------
 * BOXNS rides LWLH25 and is 369 wagons a year at Raipur — the fifth busiest
 * type. Until now the app could count its springs but not judge them, so an
 * inspector had no way to record a condemnation through the system. The
 * condemning limit is the safety-critical half, and it was published all
 * along.
 */

import type { SpringPosition } from '../types.ts';

/** Bogies covered here rather than by the G-95 band tables. */
export type NonBandedBogie = 'LWLH25' | 'LCCF20';

export interface CondemningLimit {
  /** Free height when new, as printed — including the tolerance notation. */
  nominal: string;
  /** Below this the spring is condemned, in mm. */
  condemning: number;
  /** Anything the manual says that a bare number would lose. */
  note?: string;
}

/**
 * WMM 2.0 §309C — "LOAD/SNUBBER SPRINGS OF CASNUB, LWLH25 & LCCF20 (c)".
 *
 * Transcribed as printed. The nominal heights carry their tolerances as text
 * because that is what the manual gives and rounding them to a single number
 * would quietly discard information an inspector may need.
 */
/*
 * Partial by design. §309C tabulates Outer, Inner and Snubber for these
 * bogies and says nothing about SNUBBER_OUTER or SNUBBER_INNER, which the
 * spring-position type carries for the CASNUB split-snubber arrangements.
 *
 * Typed as partial rather than filled in, so a lookup for a position the
 * manual does not cover fails loudly in judgeAgainstCondemningLimit instead
 * of quietly inheriting a limit meant for something else.
 */
export const CONDEMNING_LIMITS: Record<NonBandedBogie, Partial<Record<SpringPosition, CondemningLimit>>> = {
  LWLH25: {
    OUTER: { nominal: '264±3', condemning: 249 },
    INNER: { nominal: '246±3', condemning: 231 },
    SNUBBER: {
      nominal: '281±3',
      condemning: 266,
      // The manual prints "266(SO)". The parenthetical is not expanded
      // anywhere we can find, so it is carried rather than interpreted.
      note: 'Printed as 266(SO) in §309C; the (SO) is not explained in the manual.'
    }
  },
  LCCF20: {
    OUTER: { nominal: '260±2', condemning: 245 },
    INNER: { nominal: '243+0/-3', condemning: 228 },
    SNUBBER: { nominal: '288±3', condemning: 273 }
  }
};

export interface CondemningVerdict {
  status: 'PASS' | 'CONDEMNED';
  /** Always null: these bogies have no band table, and inventing one would lie. */
  band: null;
  condemningHeight: number;
  nominal: string;
  measuredHeight: number;
  /** Millimetres above the condemning height. Negative means condemned. */
  margin: number;
  source: string;
  note?: string;
}

/**
 * Judges a spring on a bogie that has no band table.
 *
 * A spring exactly at the condemning height passes: the manual gives a
 * condemning height, and a spring is condemned below it. Getting that boundary
 * inverted would condemn serviceable springs at the busiest wagon type in the
 * shop.
 */
export function judgeAgainstCondemningLimit(
  bogie: NonBandedBogie,
  position: SpringPosition,
  measuredHeight: number
): CondemningVerdict {
  const limit = CONDEMNING_LIMITS[bogie]?.[position];
  if (!limit) {
    throw new Error(`No §309C limit held for ${bogie} ${position}.`);
  }
  if (!Number.isFinite(measuredHeight)) {
    throw new Error('A measured height is required to judge a spring.');
  }

  return {
    status: measuredHeight >= limit.condemning ? 'PASS' : 'CONDEMNED',
    band: null,
    condemningHeight: limit.condemning,
    nominal: limit.nominal,
    measuredHeight,
    margin: Number((measuredHeight - limit.condemning).toFixed(1)),
    source: `WMM 2.0 §309C (${bogie})`,
    note: limit.note
  };
}

/** Whether this system judges the bogie by condemning limit rather than band. */
export function isNonBandedBogie(bogie: string): bogie is NonBandedBogie {
  return bogie === 'LWLH25' || bogie === 'LCCF20';
}
