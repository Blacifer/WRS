/**
 * How many springs Stores should expect to issue
 * Indian Railways WRS Raipur
 *
 * THE QUESTION THIS ANSWERS
 * -------------------------
 * Not "how many springs will be handled" — that is already known and it is
 * large: the shop turns out 5,747 wagons a year and gauges roughly 700 springs
 * a shift. The useful question is narrower and much smaller:
 *
 *     how many springs will have to be REPLACED, and of which kind?
 *
 * Most springs gauged are refitted. Only the condemned ones draw on stock, so
 * only the condemned ones cost money and only they can leave a wagon waiting.
 *
 * HOW THE FIGURE IS BUILT
 * -----------------------
 * Three inputs, and it matters that they are of different kinds:
 *
 *   wagons of each type    the shop's own 2025-26 out-turn return — history
 *   springs per wagon      RDSO WMM 2.0 §601 — regulation, exact
 *   condemnation rate      this shop's own inspection record — observed
 *
 * The first two are known constants. Only the third is learned, and it is
 * learned from the shop's own readings rather than assumed from anywhere else.
 * That is the whole of the "prediction" here: multiply a known wagon mix by a
 * known spring count by an observed failure rate.
 *
 * WHY THERE IS NO MODEL
 * ---------------------
 * Because the arithmetic is the answer, and a supervisor can check it on
 * paper. A learned model over three inputs would forecast no better, could not
 * be recomputed by hand when it looked wrong, and would need a story about its
 * training data every time Stores questioned a number. The honest description
 * of this file is a rate table and a multiplication.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It refuses to forecast a spring type the shop has not condemned enough of to
 * have a rate for. An order quantity invented from four observations is worse
 * than no figure, because somebody will act on it.
 */

import type { BogieType, SpringPosition } from '../types.ts';
import { RAIPUR_WORKLOAD_2025_26, RAIPUR_WORKING_DAYS } from './raipurWorkload.ts';
import { getWagonSpringConfig } from '../classification/wagonTypes.ts';

/**
 * Condemnations needed before a rate is quoted for a spring type.
 *
 * Thirty is not a statistical ceremony — it is roughly the point at which one
 * unusual batch stops moving the rate by more than a few percent. Below it the
 * figure swings with each new condemnation, and a swinging order quantity is
 * how a store ends up with a year of one spring and none of another.
 */
export const MIN_CONDEMNATIONS_FOR_RATE = 30;

/** Observed outcome for one spring type, from this shop's own inspections. */
export interface ObservedRate {
  bogieType: BogieType;
  springPosition: SpringPosition;
  /** Springs of this type inspected in the observation window. */
  inspected: number;
  /** Of those, how many were condemned. */
  condemned: number;
}

export interface SpringDemandLine {
  bogieType: BogieType;
  springPosition: SpringPosition;
  /** Springs of this type passing through in the period. */
  springsHandled: number;
  /** Condemned per hundred handled, from observation. */
  condemnationRatePct: number;
  /** Expected replacements in the period, rounded up — you cannot order 4.2. */
  expectedReplacements: number;
  /** How many observations the rate rests on. */
  basis: number;
}

export interface UnforecastableLine {
  bogieType: BogieType;
  springPosition: SpringPosition;
  condemned: number;
  reason: string;
}

export interface ConsumptionForecast {
  /** Days the forecast covers. */
  periodDays: number;
  /** Wagons expected in the period, from the annual out-turn. */
  wagonsExpected: number;
  lines: SpringDemandLine[];
  /** Types deliberately left out, and why. */
  notForecast: UnforecastableLine[];
  /** Total springs expected to be replaced across every forecastable type. */
  totalReplacements: number;
  summary: string;
}

/**
 * Springs the shop will handle in `periodDays`, by bogie type and position.
 *
 * Derived from the out-turn return: each designation's annual count, scaled to
 * the period, multiplied by that wagon's published spring counts. Designations
 * whose bogie carries no G-95 table are skipped — the shop overhauls them, but
 * this system holds no spring configuration for them and will not invent one.
 */
export function springsHandledIn(periodDays: number): Map<string, number> {
  const share = periodDays / RAIPUR_WORKING_DAYS;
  const handled = new Map<string, number>();

  const add = (bogieType: BogieType, position: SpringPosition, n: number) => {
    const key = `${bogieType}|${position}`;
    handled.set(key, (handled.get(key) || 0) + n);
  };

  for (const row of RAIPUR_WORKLOAD_2025_26) {
    /*
     * A combined out-turn line such as "BRN/BFKN/BFNS" carries one total for
     * several designations and the shop's return does not split it. Rather
     * than apportion it by guess, use the members that ARE configured and
     * divide the line evenly between them — stated here so the assumption is
     * visible rather than buried, since it is the one estimate in this file.
     */
    const designations = row.members
      ? row.members.filter((m) => m.configured).map((m) => m.designation)
      : [row.designation];

    if (designations.length === 0) continue;
    const perDesignation = row.total / designations.length;

    for (const designation of designations) {
      const config = getWagonSpringConfig(designation);
      if (!config || !config.bogieType) continue;

      // Two bogies per wagon; §601 counts are per bogie.
      const wagons = perDesignation * share;
      add(config.bogieType, 'OUTER', wagons * config.counts.outer * 2);
      add(config.bogieType, 'INNER', wagons * config.counts.inner * 2);
      add(config.bogieType, 'SNUBBER', wagons * config.counts.snubber * 2);
    }
  }

  return handled;
}

/**
 * Expected spring replacements over the coming period.
 *
 * `observed` is this shop's own inspection outcomes. A type with too few
 * condemnations to rest a rate on is reported in `notForecast` rather than
 * given a number, because the point of the exercise is an order quantity
 * somebody will act on.
 */
export function forecastConsumption(
  periodDays: number,
  observed: ObservedRate[]
): ConsumptionForecast {
  const handled = springsHandledIn(periodDays);
  const share = periodDays / RAIPUR_WORKING_DAYS;
  const wagonsExpected = Math.round(
    RAIPUR_WORKLOAD_2025_26.reduce((s, r) => s + r.total, 0) * share
  );

  const lines: SpringDemandLine[] = [];
  const notForecast: UnforecastableLine[] = [];

  for (const rate of observed) {
    const key = `${rate.bogieType}|${rate.springPosition}`;
    const springsHandled = Math.round(handled.get(key) || 0);

    if (rate.condemned < MIN_CONDEMNATIONS_FOR_RATE) {
      notForecast.push({
        bogieType: rate.bogieType,
        springPosition: rate.springPosition,
        condemned: rate.condemned,
        reason: `Only ${rate.condemned} condemned so far; ${MIN_CONDEMNATIONS_FOR_RATE} needed before a rate is steady enough to order against.`
      });
      continue;
    }

    if (rate.inspected <= 0) continue;

    const ratePct = (rate.condemned / rate.inspected) * 100;

    lines.push({
      bogieType: rate.bogieType,
      springPosition: rate.springPosition,
      springsHandled,
      condemnationRatePct: Math.round(ratePct * 100) / 100,
      // Round up: a shortfall stops a wagon, a surplus sits on a shelf.
      expectedReplacements: Math.ceil(springsHandled * (rate.condemned / rate.inspected)),
      basis: rate.inspected
    });
  }

  lines.sort((a, b) => b.expectedReplacements - a.expectedReplacements);
  const totalReplacements = lines.reduce((s, l) => s + l.expectedReplacements, 0);

  const summary =
    lines.length === 0
      ? `No spring type yet has ${MIN_CONDEMNATIONS_FOR_RATE} condemnations behind it, so no order quantity is offered. The figure will appear as the record builds.`
      : `Over the next ${periodDays} working days, about ${wagonsExpected} wagons and an expected ${totalReplacements} spring replacements across ${lines.length} spring ${lines.length === 1 ? 'type' : 'types'}.`;

  return {
    periodDays,
    wagonsExpected,
    lines,
    notForecast,
    totalReplacements,
    summary
  };
}
