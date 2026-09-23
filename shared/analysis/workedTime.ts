/**
 * Worked time from timestamps, and rates a person could actually have produced
 * Indian Railways WRS Raipur
 *
 * Lifted out of scripts/shadow-report.mjs so the shadow-mode screen and the
 * script compute the same figures from the same rule. The rule:
 *
 * The gap between an inspector's first and last verdict is ELAPSED time, not
 * effort — they may have walked to stores, waited for a crane, gone to lunch.
 * Reporting it as "time taken" is the number that collapses the first time
 * somebody senior asks how it was arrived at. So a run of instants is split
 * wherever two are more than IDLE_GAP_MINUTES apart, and only the worked
 * portions are added. That is still an upper bound on effort, and it is
 * described as one everywhere it is shown.
 */

/** A pause longer than this ends a working run rather than counting toward it. */
export const IDLE_GAP_MINUTES = 15;

/*
 * Rates above these are not people working. WMM puts the sorting bench at
 * roughly seven hundred springs a shift, about ninety an hour. Seeded and
 * test data is written in bursts of milliseconds and produces figures like
 * five hundred springs an hour — not merely wrong, but the kind of wrong that
 * destroys a pilot's credibility when somebody does the arithmetic in their
 * head. So a rate is returned with a flag saying whether a person could have
 * produced it, and callers show the flag rather than the number.
 */
export const PLAUSIBLE_SPRINGS_PER_HOUR = 200;
export const PLAUSIBLE_ITEMS_PER_HOUR = 400;

/*
 * A timed trial or a staffed line is not one pair of hands at a bench. The
 * CWM's target is 250 springs an hour (1000 in four hours, 14.4 s each), which
 * the bench ceiling above would call fake on the day the evidence is taken.
 * The line has its own ceiling instead of the bench's being raised: 400 an
 * hour still catches seeded data, which is written at hundreds a SECOND, and
 * the bench check keeps meaning what it meant.
 */
export const PLAUSIBLE_LINE_SPRINGS_PER_HOUR = 400;
export type WorkMode = 'BENCH' | 'LINE';
export const plausibleSpringCeiling = (mode: WorkMode): number =>
  mode === 'LINE' ? PLAUSIBLE_LINE_SPRINGS_PER_HOUR : PLAUSIBLE_SPRINGS_PER_HOUR;

/** A sorting batch opened as a timed trial or a line run, by the id the bench mints for it. */
export const isLineBatch = (batchId: string | null | undefined): boolean => /^(trial|line)_/.test(String(batchId || ''));

/** Total worked minutes across instants, splitting on idle gaps. One instant has no duration. */
export function workedMinutes(instants: Array<string | number>): number {
  const t = instants.map((s) => (typeof s === 'number' ? s : Date.parse(s))).filter(Number.isFinite).sort((a, b) => a - b);
  if (t.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < t.length; i++) {
    const gap = (t[i] - t[i - 1]) / 60000;
    if (gap <= IDLE_GAP_MINUTES) total += gap;
  }
  return total;
}

export interface Rate {
  perHour: number | null;
  /** False when faster than a person can work — seeded or test data, not a shift. */
  plausible: boolean;
}

export function ratePerHour(count: number, minutes: number, ceiling: number): Rate {
  if (minutes <= 0) return { perHour: null, plausible: true };
  const perHour = (count / minutes) * 60;
  return { perHour: Math.round(perHour * 10) / 10, plausible: perHour <= ceiling };
}
