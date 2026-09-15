/**
 * Where wagons wait, and which one will miss its date
 * Indian Railways WRS Raipur
 *
 * WHAT WAS THERE, AND WHAT WAS NOT
 * --------------------------------
 * Every stage move is in wagon_transitions with its timestamp, so the shop
 * has always held how long each wagon spent in each of the seven stages.
 * What it computed from that was one number: entry to release. A DRM who
 * sees "median 190 hours" cannot act on it; a DRM who sees "REPAIR holds a
 * wagon for a median 96 hours, and DISMANTLING 9" knows where the people
 * are. That is the first half of this file.
 *
 * The second half answers "which wagon will not make its target date". It
 * is COMPUTED, not predicted, and the word matters: a wagon at REASSEMBLY
 * with three stages left, each of which has taken the shop a median of so
 * many hours on wagons of this type, will — if it goes as the others went —
 * be released on a date that arithmetic gives. Nothing is modelled. The
 * arithmetic is shown per stage so a supervisor can check it against the
 * board, and a stage the shop has not completed often enough to have a
 * median for is said to be missing rather than filled in.
 *
 * THE BASIS IS PART OF THE ANSWER
 * -------------------------------
 * A median from four wagons is not the same as one from four hundred, and a
 * median for BOXNHL is not the same as one across every type. Each figure
 * carries how many intervals it rests on and whether it fell back from the
 * wagon's own type to the shop as a whole. Below MIN_INTERVALS it is not
 * given at all.
 */

import { LIFECYCLE_STAGES, type LifecycleStage } from '../types.ts';

/** Completed intervals a stage needs before its median is quoted. */
export const MIN_INTERVALS = 5;

export interface TransitionRow {
  wagonNumber: string;
  wagonType: string;
  fromStage: LifecycleStage;
  toStage: LifecycleStage;
  createdAt: string;
}

export interface WagonNow {
  wagonNumber: string;
  wagonType: string;
  currentStage: LifecycleStage;
  targetReleaseDate: string | null;
}

export interface StageDwell {
  stage: LifecycleStage;
  /** Completed intervals — a wagon entered and then left this stage. */
  n: number;
  medianHours: number | null;
  p90Hours: number | null;
  /** Wagons in this stage right now, and the longest any has been there. */
  inStageNow: number;
  longestNowHours: number | null;
}

export interface ReleaseProjection {
  wagonNumber: string;
  wagonType: string;
  currentStage: LifecycleStage;
  targetReleaseDate: string | null;
  /** When arithmetic says it will be released, or null with the reason. */
  projectedReleaseDate: string | null;
  hoursRemaining: number | null;
  /** Positive: late by this many hours. Negative: early. Null when either date is missing. */
  hoursLate: number | null;
  willMiss: boolean | null;
  /** The sum, shown: each remaining stage and the median used for it. */
  steps: Array<{
    stage: LifecycleStage;
    medianHours: number | null;
    /** Hours already spent, for the current stage only. */
    elapsedHours?: number;
    basis: { n: number; scope: 'TYPE' | 'SHOP' } | null;
  }>;
  reason: string | null;
}

export interface DwellReport {
  /** Per stage, across every wagon type. */
  byStage: StageDwell[];
  /** The stage with the longest median, if any has one. */
  bottleneck: { stage: LifecycleStage; medianHours: number; n: number } | null;
  /** Every wagon not yet released, with the arithmetic. */
  projections: ReleaseProjection[];
  /** How many of those will miss, how many cannot be computed, how many have no date. */
  summary: { active: number; willMiss: number; onTime: number; noTargetDate: number; notComputable: number };
}

interface Interval { wagonType: string; stage: LifecycleStage; hours: number }

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const round1 = (n: number) => Math.round(n * 10) / 10;
const hoursBetween = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 3_600_000);

/**
 * The intervals: for each wagon, the moment it entered a stage is the
 * transition INTO it (or its registration row, which the repository writes
 * as ENTRY_REGISTRATION -> ENTRY_REGISTRATION), and it left at the next
 * transition out. A wagon still in a stage has an open interval, kept apart.
 */
export function stageIntervals(transitions: TransitionRow[], now: string): {
  completed: Interval[];
  open: Array<{ wagonNumber: string; wagonType: string; stage: LifecycleStage; enteredAt: string; hours: number }>;
} {
  const byWagon = new Map<string, TransitionRow[]>();
  for (const t of transitions) {
    const list = byWagon.get(t.wagonNumber) || [];
    list.push(t);
    byWagon.set(t.wagonNumber, list);
  }
  const completed: Interval[] = [];
  const open: ReturnType<typeof stageIntervals>['open'] = [];
  for (const [wagonNumber, list] of byWagon) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const stage = t.toStage;
      const next = list[i + 1];
      if (next) {
        // Only a real move ends the interval; a self-transition is a note.
        if (next.toStage === stage) continue;
        completed.push({ wagonType: t.wagonType, stage, hours: hoursBetween(t.createdAt, next.createdAt) });
      } else if (stage !== 'RELEASE') {
        open.push({ wagonNumber, wagonType: t.wagonType, stage, enteredAt: t.createdAt, hours: hoursBetween(t.createdAt, now) });
      }
    }
  }
  return { completed, open };
}

function medianFor(intervals: Interval[], stage: LifecycleStage, wagonType: string | null): { n: number; median: number; p90: number; scope: 'TYPE' | 'SHOP' } | null {
  const pick = (scope: 'TYPE' | 'SHOP') => {
    const hs = intervals.filter((i) => i.stage === stage && (scope === 'SHOP' || i.wagonType === wagonType)).map((i) => i.hours).sort((a, b) => a - b);
    return hs.length >= MIN_INTERVALS ? { n: hs.length, median: quantile(hs, 0.5), p90: quantile(hs, 0.9), scope } : null;
  };
  return (wagonType ? pick('TYPE') : null) ?? pick('SHOP');
}

export function dwellReport(transitions: TransitionRow[], wagons: WagonNow[], now = new Date().toISOString()): DwellReport {
  const { completed, open } = stageIntervals(transitions, now);

  const byStage: StageDwell[] = LIFECYCLE_STAGES.filter((s) => s !== 'RELEASE').map((stage) => {
    const m = medianFor(completed, stage, null);
    const here = open.filter((o) => o.stage === stage);
    return {
      stage,
      n: completed.filter((i) => i.stage === stage).length,
      medianHours: m ? round1(m.median) : null,
      p90Hours: m ? round1(m.p90) : null,
      inStageNow: here.length,
      longestNowHours: here.length ? round1(Math.max(...here.map((h) => h.hours))) : null
    };
  });

  const withMedian = byStage.filter((s) => s.medianHours !== null);
  const bottleneck = withMedian.length
    ? withMedian.reduce((a, b) => (b.medianHours! > a.medianHours! ? b : a))
    : null;

  const projections: ReleaseProjection[] = [];
  for (const w of wagons) {
    if (w.currentStage === 'RELEASE') continue;
    const here = open.find((o) => o.wagonNumber === w.wagonNumber);
    const idx = LIFECYCLE_STAGES.indexOf(w.currentStage);
    const remaining = LIFECYCLE_STAGES.slice(idx).filter((s) => s !== 'RELEASE');
    const steps: ReleaseProjection['steps'] = [];
    let hours = 0;
    let missing: LifecycleStage | null = null;
    for (const stage of remaining) {
      const m = medianFor(completed, stage, w.wagonType);
      const elapsed = stage === w.currentStage ? (here?.hours ?? 0) : undefined;
      steps.push({ stage, medianHours: m ? round1(m.median) : null, elapsedHours: elapsed === undefined ? undefined : round1(elapsed), basis: m ? { n: m.n, scope: m.scope } : null });
      if (!m) { if (!missing) missing = stage; continue; }
      // The current stage counts only for what is left of its median. A wagon
      // already past the median is not given negative time; it is given none.
      hours += stage === w.currentStage ? Math.max(0, m.median - (elapsed ?? 0)) : m.median;
    }
    const computable = missing === null;
    const projected = computable ? new Date(Date.parse(now) + hours * 3_600_000).toISOString() : null;
    const hoursLate = computable && w.targetReleaseDate ? round1((Date.parse(projected!) - Date.parse(w.targetReleaseDate)) / 3_600_000) : null;
    projections.push({
      wagonNumber: w.wagonNumber,
      wagonType: w.wagonType,
      currentStage: w.currentStage,
      targetReleaseDate: w.targetReleaseDate,
      projectedReleaseDate: projected,
      hoursRemaining: computable ? round1(hours) : null,
      hoursLate,
      willMiss: hoursLate === null ? null : hoursLate > 0,
      steps,
      reason: !computable
        ? `No median yet for ${missing!.replace(/_/g, ' ').toLowerCase()} — fewer than ${MIN_INTERVALS} wagons have completed it.`
        : !w.targetReleaseDate
          ? 'No target release date was recorded for this wagon.'
          : null
    });
  }
  projections.sort((a, b) => (b.hoursLate ?? -Infinity) - (a.hoursLate ?? -Infinity));

  return {
    byStage,
    bottleneck: bottleneck ? { stage: bottleneck.stage, medianHours: bottleneck.medianHours!, n: bottleneck.n } : null,
    projections,
    summary: {
      active: projections.length,
      willMiss: projections.filter((p) => p.willMiss === true).length,
      onTime: projections.filter((p) => p.willMiss === false).length,
      noTargetDate: projections.filter((p) => p.projectedReleaseDate && !p.targetReleaseDate).length,
      notComputable: projections.filter((p) => !p.projectedReleaseDate).length
    }
  };
}
