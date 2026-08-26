/**
 * Sorting throughput — turning a count into a rate, carefully
 * Indian Railways WRS Raipur
 *
 * WHY THIS IS ITS OWN FILE
 * ------------------------
 * The app records ~900 springs a day being sorted and never says how fast.
 * That is the DRM's own number and the whole reason the sorting screen
 * exists, so it is worth showing — but a throughput figure is a claim about
 * the shop's performance, and a wrong one is worse than none.
 *
 * The dangerous case is a rate computed from a handful of taps over a few
 * seconds. Five springs in twenty seconds is 900 an hour, which would put an
 * absurd number on screen in front of the person who knows what the real
 * figure is. So the rules for refusing to quote a rate matter more than the
 * arithmetic, and they live here where they can be tested rather than inside
 * a component where they cannot.
 *
 * The rate is measured across the span actually spent sorting — first spring
 * to last — not the clock since midnight. Someone who sorts for two hours
 * after lunch has not been working at a quarter of their real speed.
 */

/**
 * The pile the shop gets through in a day, as the DRM described it.
 *
 * Used only to express a measured rate in the shop's own terms — "at this
 * rate the day's pile takes N hours". It is not a target the app holds
 * anyone to, and nothing fails if it is not met.
 */
export const DAILY_PILE = 900;

/**
 * Below these, no rate is quoted.
 *
 * Both are needed. Enough springs alone is not enough: eight taps in ten
 * seconds is someone testing the screen, not working. Enough time alone is
 * not enough either: two springs across an hour says nothing about pace.
 */
export const MIN_SPRINGS_FOR_RATE = 8;
export const MIN_SPAN_MINUTES = 3;

export interface ThroughputInput {
  total: number;
  /** ISO timestamp of the first spring recorded that day, or null. */
  firstAt: string | null;
  /** ISO timestamp of the most recent one, or null. */
  lastAt: string | null;
}

export interface ThroughputReading {
  /** Whether there is enough evidence to put a rate on screen. */
  canQuoteRate: boolean;
  /** Why not, when there is not. Written to be shown to the inspector. */
  reason?: string;
  /** Minutes between the first and last spring of the day. */
  activeMinutes: number;
  /** Springs per hour across that span. */
  springsPerHour?: number;
  /** Hours the day's pile would take at this rate. */
  hoursForDailyPile?: number;
}

/**
 * Works out whether a rate can honestly be quoted, and what it is.
 *
 * Returns activeMinutes either way, since "you have been going 40 minutes" is
 * useful even before there is enough to compute a rate from.
 */
export function readThroughput(input: ThroughputInput): ThroughputReading {
  const { total, firstAt, lastAt } = input;

  if (!firstAt || !lastAt || total === 0) {
    return { canQuoteRate: false, activeMinutes: 0, reason: 'No springs recorded yet today.' };
  }

  const start = Date.parse(firstAt);
  const end = Date.parse(lastAt);

  // A clock that disagrees with itself, or timestamps that will not parse.
  // Refuse rather than produce a negative or NaN rate.
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { canQuoteRate: false, activeMinutes: 0, reason: 'The recorded times do not make sense, so no rate is shown.' };
  }

  const activeMinutes = Math.round((end - start) / 60000);

  if (total < MIN_SPRINGS_FOR_RATE) {
    return {
      canQuoteRate: false,
      activeMinutes,
      reason: `Measuring — a rate is shown after ${MIN_SPRINGS_FOR_RATE} springs.`
    };
  }

  if (activeMinutes < MIN_SPAN_MINUTES) {
    return {
      canQuoteRate: false,
      activeMinutes,
      reason: 'Measuring — too short a stretch so far to judge a pace from.'
    };
  }

  const springsPerHour = Math.round(total / (activeMinutes / 60));

  return {
    canQuoteRate: true,
    activeMinutes,
    springsPerHour,
    // Guard the division: a rate can only be zero if total is zero, which is
    // already handled above, but the screen must never render Infinity.
    hoursForDailyPile: springsPerHour > 0
      ? Math.round((DAILY_PILE / springsPerHour) * 10) / 10
      : undefined
  };
}
