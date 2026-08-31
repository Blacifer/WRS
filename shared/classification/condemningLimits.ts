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
 * Partial by design: a lookup for a position no published table covers fails
 * loudly in judgeAgainstCondemningLimit rather than quietly inheriting a
 * limit meant for something else.
 *
 * THE LWLH25 SNUBBER IS TWO SPRINGS, NOT ONE
 * ------------------------------------------
 * WMM 2.0 §309C prints the LWLH25 snubber condemning height as "266(SO)" and
 * never expands the parenthetical, so this file carried a single snubber
 * limit of 266 and a note saying the (SO) was unexplained.
 *
 * RDSO Technical Pamphlet G-112 (Wagon Directorate, page 89) explains it.
 * Table 26 gives the LWLH25 group as "4 (2SO & 2SI)" and Table 27 splits the
 * snubber row in two:
 *
 *     Snubber Outer (SO)   281±3 nominal   condemn below 266
 *     Snubber Inner (SI)   289±3 nominal   condemn below 274
 *
 * SO is Snubber Outer and SI is Snubber Inner. Half the snubbers on every
 * LWLH25 bogie are the inner type, and this file was judging them against the
 * outer figure — so a Snubber Inner measuring anywhere from 266 to 273mm was
 * called serviceable when the pamphlet condemns it. An eight millimetre
 * window in which a condemned spring passed.
 *
 * Plain SNUBBER is therefore no longer held for LWLH25. Asking for it now
 * throws, because on this bogie the question is incomplete — the caller has
 * to say which snubber they are holding. LCCF20 keeps a single SNUBBER
 * because Table 26 gives it two undifferentiated snubbers per group.
 */
export const CONDEMNING_LIMITS: Record<NonBandedBogie, Partial<Record<SpringPosition, CondemningLimit>>> = {
  LWLH25: {
    OUTER: { nominal: '264±3', condemning: 249 },
    INNER: { nominal: '246±3', condemning: 231 },
    // No plain SNUBBER. See the note above: this bogie carries two different
    // snubbers and answering for "a snubber" would mean picking one of them.
    SNUBBER_OUTER: {
      nominal: '281±3',
      condemning: 266,
      note: 'Snubber Outer. WMM 2.0 §309C prints this as "266(SO)"; RDSO G-112 Table 27 confirms SO is the outer snubber.'
    },
    SNUBBER_INNER: {
      nominal: '289±3',
      condemning: 274,
      note: 'Snubber Inner. Absent from §309C, which is why this spring was previously judged against the outer limit of 266mm.'
    }
  },
  LCCF20: {
    OUTER: { nominal: '260±2', condemning: 245 },
    INNER: { nominal: '243+0/-3', condemning: 228 },
    // One snubber type on this bogie: G-112 Table 26 gives 2 per group,
    // undifferentiated, and Table 27 gives them a single row.
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
    source: `WMM 2.0 §309C / RDSO G-112 Table 27 (${bogie} ${position})`,
    note: limit.note
  };
}

/** Whether this system judges the bogie by condemning limit rather than band. */
export function isNonBandedBogie(bogie: string): bogie is NonBandedBogie {
  return bogie === 'LWLH25' || bogie === 'LCCF20';
}
