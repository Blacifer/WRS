/**
 * Analytics queries for the DRM dashboards
 * Indian Railways WRS Raipur
 *
 * Lifted out of WagonRepository, which had grown past 2,400 lines while being
 * the most-edited file in the system — the worst combination for a file where
 * a mistake is easy to miss.
 *
 * These six were the cleanest thing to move: read-only aggregations that touch
 * no repository state beyond the database handle, so they become plain
 * functions. WagonRepository still exposes the same six methods and delegates
 * here, so no call site changes and the split is behaviour-neutral by
 * construction rather than by hope.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { LifecycleStage, CASNUBCategory } from '../../../shared/types.ts';
import type { ObservedRate } from '../../../shared/knowledge/consumptionForecast.ts';

// -------------------------------------------------------------------------
// Analytics & DRM Dashboards
// -------------------------------------------------------------------------

export function getAnalyticsPipeline(db: DatabaseSync): any {
  const stages: LifecycleStage[] = [
    'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION',
    'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE', 'RELEASE'
  ];

  const counts: Record<LifecycleStage, number> = {
    ENTRY_REGISTRATION: 0,
    DISMANTLING: 0,
    COMPONENT_INSPECTION: 0,
    REPAIR_REPLACEMENT: 0,
    REASSEMBLY: 0,
    FINAL_QC_GATE: 0,
    RELEASE: 0
  };

  const rows = db.prepare(`
    SELECT current_stage, COUNT(*) as count
    FROM wagons
    GROUP BY current_stage
  `).all() as Array<{ current_stage: LifecycleStage; count: number }>;

  for (const r of rows) {
    if (r.current_stage in counts) {
      counts[r.current_stage] = r.count;
    }
  }

  let totalActive = 0;
  for (const stage of stages) {
    if (stage !== 'RELEASE') {
      totalActive += counts[stage];
    }
  }

  const totalReleased = counts.RELEASE;

  return {
    counts,
    totalActive,
    totalReleased,
    timestamp: new Date().toISOString()
  };
}

export function getAnalyticsTAT(db: DatabaseSync): any {
  const rows = db.prepare(`
    SELECT entry_date, actual_release_date
    FROM wagons
    WHERE current_stage = 'RELEASE' AND actual_release_date IS NOT NULL
  `).all() as Array<{ entry_date: string; actual_release_date: string }>;

  if (rows.length === 0) {
    return {
      averageHours: 0,
      medianHours: 0,
      minHours: 0,
      maxHours: 0,
      p90Hours: 0,
      completedWagonsCount: 0,
      trends: []
    };
  }

  const durations: number[] = [];
  const trendMap: Record<string, { totalHours: number; count: number }> = {};

  for (const r of rows) {
    const entryTime = new Date(r.entry_date).getTime();
    const releaseTime = new Date(r.actual_release_date).getTime();
    const hours = Math.max(0, (releaseTime - entryTime) / (1000 * 60 * 60));
    durations.push(hours);

    const period = r.actual_release_date.slice(0, 10);
    if (!trendMap[period]) {
      trendMap[period] = { totalHours: 0, count: 0 };
    }
    trendMap[period].totalHours += hours;
    trendMap[period].count += 1;
  }

  durations.sort((a, b) => a - b);
  const sum = durations.reduce((acc, v) => acc + v, 0);
  const averageHours = Math.round((sum / durations.length) * 10) / 10;
  const medianHours = Math.round(durations[Math.floor(durations.length / 2)] * 10) / 10;
  const minHours = Math.round(durations[0] * 10) / 10;
  const maxHours = Math.round(durations[durations.length - 1] * 10) / 10;
  const p90Index = Math.min(durations.length - 1, Math.floor(durations.length * 0.9));
  const p90Hours = Math.round(durations[p90Index] * 10) / 10;

  const trends = Object.entries(trendMap).map(([period, data]) => ({
    period,
    avgHours: Math.round((data.totalHours / data.count) * 10) / 10,
    count: data.count
  })).sort((a, b) => a.period.localeCompare(b.period));

  return {
    averageHours,
    medianHours,
    minHours,
    maxHours,
    p90Hours,
    completedWagonsCount: durations.length,
    trends
  };
}

export function getAnalyticsThroughput(db: DatabaseSync): any {
  const entryRows = db.prepare(`
    SELECT substr(entry_date, 1, 10) as dt, COUNT(*) as cnt
    FROM wagons
    GROUP BY dt
    ORDER BY dt DESC
    LIMIT 30
  `).all() as Array<{ dt: string; cnt: number }>;

  const releaseRows = db.prepare(`
    SELECT substr(actual_release_date, 1, 10) as dt, COUNT(*) as cnt
    FROM wagons
    WHERE current_stage = 'RELEASE' AND actual_release_date IS NOT NULL
    GROUP BY dt
    ORDER BY dt DESC
    LIMIT 30
  `).all() as Array<{ dt: string; cnt: number }>;

  const entryMap: Record<string, number> = {};
  for (const r of entryRows) entryMap[r.dt] = r.cnt;

  const releaseMap: Record<string, number> = {};
  for (const r of releaseRows) releaseMap[r.dt] = r.cnt;

  const allDates = Array.from(new Set([...Object.keys(entryMap), ...Object.keys(releaseMap)])).sort();

  const daily = allDates.map(date => ({
    date,
    entered: entryMap[date] || 0,
    released: releaseMap[date] || 0
  }));

  return {
    daily,
    weekly: daily.slice(-7),
    monthly: daily
  };
}

export function getAnalyticsParts(db: DatabaseSync): any {
  const validCategories: CASNUBCategory[] = [
    'SPRINGS', 'WHEELS_AXLES', 'BEARINGS', 'BRAKE_SYSTEM',
    'COUPLERS_DRAFT_GEAR', 'BOGIE_FRAME_BOLSTER', 'FRICTION_WEDGES', 'BODY_UNDERFRAME'
  ];

  const categoryBreakdown: Record<string, any> = {};
  for (const cat of validCategories) {
    categoryBreakdown[cat] = {
      total: 0,
      pass: 0,
      fail: 0,
      condemned: 0,
      repaired: 0,
      replaced: 0
    };
  }

  const rows = db.prepare(`
    SELECT category, status, COUNT(*) as count
    FROM checklist_items
    GROUP BY category, status
  `).all() as Array<{ category: string; status: string; count: number }>;

  let totalInspected = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalCondemned = 0;
  let totalRepaired = 0;
  let totalReplaced = 0;

  for (const r of rows) {
    if (categoryBreakdown[r.category]) {
      categoryBreakdown[r.category].total += r.count;
      totalInspected += r.count;

      if (r.status === 'PASS') {
        categoryBreakdown[r.category].pass += r.count;
        totalPassed += r.count;
      } else if (r.status === 'FAIL') {
        categoryBreakdown[r.category].fail += r.count;
        totalFailed += r.count;
      } else if (r.status === 'CONDEMNED') {
        categoryBreakdown[r.category].condemned += r.count;
        totalCondemned += r.count;
      } else if (r.status === 'REPAIRED') {
        categoryBreakdown[r.category].repaired += r.count;
        totalRepaired += r.count;
      } else if (r.status === 'REPLACED') {
        categoryBreakdown[r.category].replaced += r.count;
        totalReplaced += r.count;
      }
    }
  }

  return {
    totalInspected,
    totalPassed,
    totalFailed,
    totalCondemned,
    totalRepaired,
    totalReplaced,
    categoryBreakdown
  };
}

export function getAnalyticsInspectors(db: DatabaseSync): any {
  const rows = db.prepare(`
    SELECT 
      inspector_id,
      inspector_name,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) as condemned
    FROM checklist_items
    GROUP BY inspector_id, inspector_name
    ORDER BY total DESC
  `).all() as Array<{
    inspector_id: string;
    inspector_name: string;
    total: number;
    passed: number;
    failed: number;
    condemned: number;
  }>;

  return {
    inspectors: rows.map(r => ({
      inspectorId: r.inspector_id,
      inspectorName: r.inspector_name,
      inspectionsCompleted: r.total,
      partsPassed: r.passed,
      partsFailed: r.failed,
      partsCondemned: r.condemned
    }))
  };
}

/**
 * Blocker counts across the pipeline.
 *
 * The odd one out. The other five are pure queries against the database, but
 * this one needs the gate evaluated per wagon, which is repository logic
 * rather than SQL. So it takes the repository instead of a bare handle — the
 * dependency is real, and hiding it behind a duplicated gate query here would
 * be the worse outcome: two implementations of "is this wagon blocked" that
 * could disagree.
 */
export function getAnalyticsBlockers(repo: {
  db: DatabaseSync;
  evaluateExitGate(wagonNumber: string): any;
}): any {
  const db = repo.db;
  const wagons = db.prepare(`
    SELECT wagon_number, wagon_type, current_stage, entry_date
    FROM wagons
    WHERE current_stage != 'RELEASE'
  `).all() as Array<{
    wagon_number: string;
    wagon_type: string;
    current_stage: LifecycleStage;
    entry_date: string;
  }>;

  const blockedWagons: any[] = [];
  for (const w of wagons) {
    const evaluation = repo.evaluateExitGate(w.wagon_number);
    if (!evaluation.canRelease && evaluation.blockers.length > 0) {
      blockedWagons.push({
        wagonNumber: w.wagon_number,
        wagonType: w.wagon_type,
        currentStage: w.current_stage,
        blockers: evaluation.blockers,
        blockerDetails: evaluation.blockerDetails,
        entryDate: w.entry_date
      });
    }
  }

  return { blockedWagons };
}

/**
 * How often each kind of spring is actually condemned, from this shop's own
 * inspection record.
 *
 * This is the only learned input to the consumption forecast — the wagon mix
 * comes from the out-turn return and the spring counts from RDSO WMM 2.0
 * §601, both of which are fixed. Everything the forecast claims about the
 * future rests on this rate, so it is computed from real recorded outcomes
 * rather than an assumed failure percentage.
 *
 * The window is deliberately a parameter with no default beyond a year:
 * spring condemnation is seasonal in a way a fortnight cannot see, and a rate
 * taken from too short a window would swing with one bad batch.
 */
export function getObservedCondemnationRates(
  db: DatabaseSync,
  sinceIso?: string
): ObservedRate[] {
  const since = sinceIso || new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();

  const rows = db
    .prepare(
      `SELECT bogie_type   AS bogieType,
              spring_position AS springPosition,
              COUNT(*)     AS inspected,
              SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) AS condemned
         FROM inspections
        WHERE created_at >= ?
        GROUP BY bogie_type, spring_position
        ORDER BY inspected DESC`
    )
    .all(since) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    bogieType: r.bogieType as ObservedRate['bogieType'],
    springPosition: r.springPosition as ObservedRate['springPosition'],
    inspected: Number(r.inspected ?? 0),
    condemned: Number(r.condemned ?? 0)
  }));
}
