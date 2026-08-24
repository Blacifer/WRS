/**
 * How Many Springs a CASNUB Bogie Actually Carries
 * Indian Railways WRS Raipur
 *
 * Source: RDSO Wagon Maintenance Manual 2.0, Chapter 6 §601 —
 * "The bogie is fitted with two groups of long helical spring nests. The
 *  spring groups per bogie for various axle load applications are as under."
 *
 * WHY THIS EXISTS
 * ---------------
 * The batch flow previously recorded ONE outer, ONE inner and ONE snubber
 * reading per bogie — six measurements for a whole wagon. A real 20.32t NLB
 * bogie carries twelve outer, eight inner and four snubber springs: twenty-four
 * per bogie, forty-eight per wagon. Recording one reading and treating it as
 * the whole nest is not a shortcut, it is a wrong answer — eleven of twelve
 * outer springs were never measured, and the exit gate cleared the wagon
 * anyway.
 *
 * It also explains the workshop's own figure of roughly 900 springs a day:
 * about nineteen wagons, not a hundred and fifty.
 *
 * Getting these counts right is what makes the 3 mm nest-grouping rule
 * meaningful. With one spring per position there is no group to compare.
 */

import type { BogieType } from '../types.ts';

/** Axle-load configurations the manual gives separate spring counts for. */
export type AxleLoad = '20.32t' | 'CC+8t+2t' | 'CC+6t+2t' | '22.32t' | '25t';

export interface SpringCount {
  outer: number;
  inner: number;
  /** Combined snubber count. RFT splits these into outer/inner snubbers. */
  snubber: number;
}

export interface SpringCountOption {
  axleLoad: AxleLoad;
  counts: SpringCount;
  /** Where the figure comes from, or why it is provisional. */
  source: string;
  /** False when the count is not sourced from RDSO documentation. */
  verified: boolean;
}

/**
 * Counts per bogie, keyed by the bogie types this system classifies.
 *
 * The manual's row "CASNUB 22 W(M), NL, NLB, NLM" covers the NLB variant, and
 * "CASNUB 22HS" covers HS. RFT does not appear in the WMM's table at all — it
 * is defined only in the G-95 pamphlet's band tables — so its counts are
 * marked unverified rather than guessed at silently.
 */
export const SPRING_COUNTS: Record<BogieType, SpringCountOption[]> = {
  CASNUB_22_NLB: [
    {
      axleLoad: '20.32t',
      counts: { outer: 12, inner: 8, snubber: 4 },
      source: 'WMM 2.0 §601 — CASNUB 22 W(M), NL, NLB, NLM @ 20.32t',
      verified: true
    },
    {
      axleLoad: 'CC+8t+2t',
      counts: { outer: 14, inner: 10, snubber: 4 },
      source: 'WMM 2.0 §601 — CASNUB 22 W(M), NL, NLB, NLM @ CC+8t+2t',
      verified: true
    }
  ],
  CASNUB_22_HS: [
    {
      axleLoad: '20.32t',
      counts: { outer: 14, inner: 12, snubber: 4 },
      source: 'WMM 2.0 §601 — CASNUB 22HS @ 20.32t',
      verified: true
    },
    {
      axleLoad: 'CC+8t+2t',
      counts: { outer: 14, inner: 14, snubber: 4 },
      source: 'WMM 2.0 §601 — CASNUB 22HS @ CC+6t+2t and CC+8t+2t',
      verified: true
    }
  ],
  // RFT is deliberately empty. Its count is not published in WMM 2.0 §601, is
  // absent from IRIMEE's identical training table, and could not be found in
  // any public RDSO source.
  //
  // An earlier version defaulted it to the NLB configuration. That was wrong
  // to ship: G-95 gives RFT physically different springs (272 mm outer against
  // NLB's 260, 237 inner against 262, 304 snubber against 294), and RFT is the
  // only type whose G-95 table splits the snubber into outer and inner
  // columns — which points to a different snubber arrangement, not the same
  // four. Copying NLB's numbers would have produced a confident, wrong
  // completeness check.
  //
  // With no source, the counts are asked for rather than guessed.
  CASNUB_22_RFT: []
};

export function getSpringCountOptions(bogieType: BogieType): SpringCountOption[] {
  return SPRING_COUNTS[bogieType] || [];
}

export function getSpringCount(bogieType: BogieType, axleLoad: AxleLoad): SpringCountOption | null {
  return getSpringCountOptions(bogieType).find((o) => o.axleLoad === axleLoad) || null;
}

/**
 * True when this system has no sourced spring count for the bogie type, and
 * the inspector must supply it from the bogie in front of them.
 */
export function requiresManualCounts(bogieType: BogieType): boolean {
  return getSpringCountOptions(bogieType).length === 0;
}

/** Sanity bounds for a hand-entered count — no CASNUB nest falls outside these. */
export const MANUAL_COUNT_LIMITS = { min: 1, max: 24 } as const;

export function isPlausibleCount(counts: SpringCount): boolean {
  const { min, max } = MANUAL_COUNT_LIMITS;
  return [counts.outer, counts.inner, counts.snubber].every(
    (n) => Number.isInteger(n) && n >= min && n <= max
  );
}

/** Total springs on one bogie for a given configuration. */
export function totalPerBogie(counts: SpringCount): number {
  return counts.outer + counts.inner + counts.snubber;
}

export interface QueuedSpring {
  bogiePosition: 'BOGIE_1' | 'BOGIE_2';
  position: 'OUTER' | 'INNER' | 'SNUBBER';
  /** 1-based index within this bogie's springs of that position. */
  indexInNest: number;
  /** How many springs of this position are on this bogie. */
  nestSize: number;
}

/**
 * Builds the full measurement queue for a wagon: every spring on both bogies,
 * grouped so an inspector works through one nest at a time rather than
 * jumping between positions.
 */
export function buildSpringQueue(counts: SpringCount): QueuedSpring[] {
  const queue: QueuedSpring[] = [];
  const bogies: QueuedSpring['bogiePosition'][] = ['BOGIE_1', 'BOGIE_2'];
  const positions: { position: QueuedSpring['position']; n: number }[] = [
    { position: 'OUTER', n: counts.outer },
    { position: 'INNER', n: counts.inner },
    { position: 'SNUBBER', n: counts.snubber }
  ];

  for (const bogiePosition of bogies) {
    for (const { position, n } of positions) {
      for (let i = 1; i <= n; i++) {
        queue.push({ bogiePosition, position, indexInNest: i, nestSize: n });
      }
    }
  }

  return queue;
}
