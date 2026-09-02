/**
 * Which springs actually make up a bogie, and which are stranded
 * Indian Railways WRS Raipur
 *
 * WHAT THIS ADDS TO nestCapacity()
 * --------------------------------
 * `nestCapacity` answers "how many complete groups can each band supply?",
 * one band at a time. That is the right first question and it is already
 * answered.
 *
 * It is not the question the shop floor has. A bogie is not assembled from
 * outer springs alone — it needs its outer group, its inner group and its
 * snubber group together, and it is finished when the scarcest of the three
 * runs out. Twenty complete outer groups are worth nothing if there are two
 * complete snubber groups, and reading a per-band table does not make that
 * obvious.
 *
 * So this module answers two things the table cannot:
 *
 *   1. How many bogies can actually be built from what is sorted, and which
 *      position is the one holding it up.
 *   2. How many springs are sitting in bins unable to join a group — the
 *      remainder after every complete group is taken out.
 *
 * WHY THE BANDS DO NOT HAVE TO MATCH ACROSS POSITIONS
 * ---------------------------------------------------
 * The 3 mm rule governs an assembly group: the springs within one group must
 * be within 3 mm of each other. Outer and inner springs are different
 * components with different nominal free heights and different G-95 tables —
 * an outer group in Band II and an inner group in Band IV is entirely normal
 * and is not a mixing violation. Requiring one band across all three positions
 * would reject correct assemblies and is not what the manual says.
 *
 * WHY THIS IS ARITHMETIC AND NOT MACHINE LEARNING
 * -----------------------------------------------
 * Every input is counted and every rule is published. There is nothing here to
 * learn, and a model that produced these numbers would be a slower, less
 * explicable way of doing a division a supervisor can check by hand.
 */

import type { SpringPosition } from '../types.ts';

/**
 * The band as the sorting record holds it.
 *
 * Deliberately a string rather than BandColor: this arrives straight off a
 * database column, and the allocation only ever groups by it and reports it
 * back. Narrowing here would force a cast at the one call site that has a real
 * value, which converts a typed boundary into a fiction.
 */
export type HeldBand = string;

/** One band's holding for one spring position, as the sorting screen counts it. */
export interface BandHolding {
  springPosition: SpringPosition;
  band: HeldBand;
  count: number;
}

/** Springs a single bogie needs, from RDSO WMM 2.0 §601. */
export interface NestRequirement {
  outer: number;
  inner: number;
  snubber: number;
}

export interface PositionAllocation {
  springPosition: SpringPosition;
  /** Springs held across every band for this position. */
  held: number;
  /** Complete groups this position can supply, summed over its bands. */
  completeGroups: number;
  /** Springs that cannot complete a group in their own band. */
  stranded: number;
  /** Springs this position needs per bogie. */
  requiredPerBogie: number;
  /** Per-band detail, richest band first. */
  byBand: Array<{
    band: HeldBand;
    count: number;
    completeGroups: number;
    stranded: number;
  }>;
}

export interface NestAllocation {
  /** Bogies buildable from stock — the scarcest position decides. */
  bogiesBuildable: number;
  /**
   * The position that ran out first, or null when nothing is held at all.
   * This is the one to sort next, and it is the actionable half of the result.
   */
  limitingPosition: SpringPosition | null;
  /** Springs held in total. */
  totalHeld: number;
  /** Springs that cannot join any complete group as things stand. */
  totalStranded: number;
  perPosition: PositionAllocation[];
  /** Plain sentence for the sorting screen. */
  summary: string;
}

const POSITION_ORDER: SpringPosition[] = [
  'OUTER',
  'INNER',
  'SNUBBER',
  'SNUBBER_OUTER',
  'SNUBBER_INNER'
];

function requiredFor(position: SpringPosition, required: NestRequirement): number {
  if (position === 'OUTER') return required.outer;
  if (position === 'INNER') return required.inner;
  // RFT splits the snubber into outer and inner; both draw on the same
  // published combined count, because the manual gives no separate figure.
  return required.snubber;
}

/**
 * Work out what the sorted stock can actually build.
 *
 * `holdings` is the sorting screen's own per-band tally. `required` is the
 * bogie's published spring count. Positions the bogie does not use are ignored
 * rather than counted as a shortage.
 */
export function allocateNests(
  holdings: BandHolding[],
  required: NestRequirement
): NestAllocation {
  /*
   * The snubber is counted two different ways depending on the bogie. NLB and
   * HS carry one combined snubber figure; RFT splits it into outer and inner
   * snubbers, and WMM 2.0 gives no separate count for the halves.
   *
   * Which convention is in force cannot be read from the requirement — it is
   * one number either way — so it is taken from what has actually been sorted.
   * Treating all three snubber positions as required regardless held every
   * answer at zero: a bogie sorted under the combined convention was reported
   * as short of two snubber positions that do not exist for it.
   */
  const snubberPositionsHeld = POSITION_ORDER.filter(
    (p) => p !== 'OUTER' && p !== 'INNER' && holdings.some((h) => h.springPosition === p)
  );
  const snubberPositions =
    required.snubber > 0
      ? snubberPositionsHeld.length > 0
        ? snubberPositionsHeld
        : (['SNUBBER'] as SpringPosition[])
      : [];

  /*
   * A position the bogie needs but of which nothing has been sorted is a real
   * shortage, not an absence — it must still hold the answer down to zero,
   * otherwise a bin with no snubbers reports the outer count as the number of
   * bogies buildable.
   */
  const positionsToReport: SpringPosition[] = [
    ...(required.outer > 0 ? (['OUTER'] as SpringPosition[]) : []),
    ...(required.inner > 0 ? (['INNER'] as SpringPosition[]) : []),
    ...snubberPositions
  ];

  const perPosition: PositionAllocation[] = positionsToReport.map((position) => {
    const perBogie = requiredFor(position, required);
    const bands = holdings.filter((h) => h.springPosition === position && h.count > 0);

    const byBand = bands
      .map((h) => {
        const completeGroups = perBogie > 0 ? Math.floor(h.count / perBogie) : 0;
        const stranded = perBogie > 0 ? h.count % perBogie : h.count;
        return { band: h.band, count: h.count, completeGroups, stranded };
      })
      .sort((a, b) => b.completeGroups - a.completeGroups || b.count - a.count);

    return {
      springPosition: position,
      held: byBand.reduce((s, b) => s + b.count, 0),
      completeGroups: byBand.reduce((s, b) => s + b.completeGroups, 0),
      stranded: byBand.reduce((s, b) => s + b.stranded, 0),
      requiredPerBogie: perBogie,
      byBand
    };
  });

  const totalHeld = perPosition.reduce((s, p) => s + p.held, 0);
  const totalStranded = perPosition.reduce((s, p) => s + p.stranded, 0);

  if (perPosition.length === 0 || totalHeld === 0) {
    return {
      bogiesBuildable: 0,
      limitingPosition: null,
      totalHeld: 0,
      totalStranded: 0,
      perPosition,
      summary: 'Nothing sorted yet for this bogie type.'
    };
  }

  /*
   * The scarcest position sets the answer. Ties are broken by declaration
   * order rather than arbitrarily, so the same stock always names the same
   * limiting position and the screen does not appear to change its mind
   * between two refreshes.
   */
  let limiting = perPosition[0]!;
  for (const p of perPosition) {
    if (p.completeGroups < limiting.completeGroups) limiting = p;
  }

  const bogiesBuildable = limiting.completeGroups;
  const label = limiting.springPosition.toLowerCase().replace(/_/g, ' ');

  const summary =
    bogiesBuildable === 0
      ? `No complete bogie yet — not enough ${label} springs in any one band to fill a group of ${limiting.requiredPerBogie}.`
      : `${bogiesBuildable} complete ${bogiesBuildable === 1 ? 'bogie' : 'bogies'} from stock. ${
          limiting.springPosition.charAt(0) + label.slice(1)
        } springs are the limit — sorting more of those raises the figure, sorting anything else does not.`;

  return {
    bogiesBuildable,
    limitingPosition: limiting.springPosition,
    totalHeld,
    totalStranded,
    perPosition,
    summary
  };
}
