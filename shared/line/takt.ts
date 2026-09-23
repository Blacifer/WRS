/**
 * Takt — seconds per spring, against the CWM's target
 * Indian Railways WRS Raipur
 *
 * The CWM asked for 900–1000 springs in under four hours: 250 an hour, one
 * every 14.4 seconds. Whether a station can hold that is the number every
 * later decision about the spring line rests on — what to buy, how many
 * people, whether a machine is needed at all — so it is measured on real
 * springs before anything is procured, not assumed.
 *
 * This takes the instants the springs were recorded and says what the
 * station is actually doing. It follows readThroughput's discipline: below a
 * minimum sample it refuses to quote a figure rather than show one that a
 * lucky ten seconds would make look good.
 *
 * A gap longer than PAUSE_SECONDS is a stoppage, not a slow spring: somebody
 * went for the next trolley, or the gauge was re-zeroed. Those are counted
 * and reported, and kept out of the per-spring figure, because a line's
 * speed and its stoppages are two different problems with two different
 * fixes.
 */

export const TARGET_SPRINGS = 1000;
export const TARGET_HOURS = 4;
/** 14.4 s — 1000 springs in four hours. */
export const TARGET_TAKT_SECONDS = (TARGET_HOURS * 3600) / TARGET_SPRINGS;
/** No per-spring figure is quoted from fewer intervals than this. */
export const MIN_INTERVALS = 10;
/** A gap longer than this is a stoppage, not a spring. */
export const PAUSE_SECONDS = 120;

export interface TaktReading {
  /** Springs recorded in the trial. */
  springs: number;
  /** Seconds since the previous spring, or null for the first. */
  lastSeconds: number | null;
  /** Whether enough intervals exist to quote a per-spring figure. */
  canQuote: boolean;
  /** Why not, when not; written for the person at the bench. */
  reason?: string;
  reasonHi?: string;
  /** Intervals the figures below rest on (stoppages excluded). */
  intervals: number;
  medianSeconds: number | null;
  /** The slow end: 90 % of springs took no longer than this. */
  p90Seconds: number | null;
  /** 3600 / median — what the station would do in an hour at its typical pace. */
  springsPerHour: number | null;
  /** How long 1000 springs would take at the median pace, in hours. */
  hoursFor1000: number | null;
  /** Median against the 14.4 s target. */
  verdict: 'WITHIN' | 'CLOSE' | 'OVER' | null;
  /** Gaps longer than PAUSE_SECONDS, and the minutes lost to them. */
  stoppages: number;
  stoppageMinutes: number;
}

const quantile = (sorted: number[], q: number): number => {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
};
const r1 = (n: number) => Math.round(n * 10) / 10;

export function taktReading(instants: Array<string | number>, taktSeconds: number = TARGET_TAKT_SECONDS): TaktReading {
  const t = instants
    .map((x) => (typeof x === 'number' ? x : Date.parse(x)))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let i = 1; i < t.length; i++) gaps.push((t[i] - t[i - 1]) / 1000);
  const working = gaps.filter((g) => g <= PAUSE_SECONDS);
  const paused = gaps.filter((g) => g > PAUSE_SECONDS);

  const base = {
    springs: t.length,
    lastSeconds: gaps.length ? r1(gaps[gaps.length - 1]) : null,
    intervals: working.length,
    stoppages: paused.length,
    stoppageMinutes: r1(paused.reduce((a, b) => a + b, 0) / 60)
  };

  if (working.length < MIN_INTERVALS) {
    const more = MIN_INTERVALS - working.length;
    return {
      ...base,
      canQuote: false,
      reason: `Timing — a figure is shown after ${MIN_INTERVALS + 1} springs (${more} more).`,
      reasonHi: `समय माप जारी — ${MIN_INTERVALS + 1} स्प्रिंग के बाद आँकड़ा दिखेगा (${more} और)।`,
      medianSeconds: null, p90Seconds: null, springsPerHour: null, hoursFor1000: null, verdict: null
    };
  }

  const sorted = [...working].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const p90 = quantile(sorted, 0.9);
  return {
    ...base,
    canQuote: true,
    medianSeconds: r1(median),
    p90Seconds: r1(p90),
    springsPerHour: median > 0 ? Math.round(3600 / median) : null,
    hoursFor1000: median > 0 ? r1((median * TARGET_SPRINGS) / 3600) : null,
    // Within the target; within a fifth of it; or over.
    verdict: median <= taktSeconds ? 'WITHIN' : median <= taktSeconds * 1.2 ? 'CLOSE' : 'OVER'
  };
}
