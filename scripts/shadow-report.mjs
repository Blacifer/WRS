/**
 * What the shadow run actually measured
 * Indian Railways WRS Raipur
 *
 *   node --experimental-strip-types scripts/shadow-report.mjs [days]
 *
 * WHY THIS EXISTS
 * ---------------
 * Shadow mode is usually described as risk mitigation: run the app beside the
 * paper process so a mistake is caught on paper wagons rather than running
 * ones. It is that. It is also the only chance to measure what the app is
 * worth, because after it ends there is no paper process left to compare
 * against.
 *
 * Everything here comes from timestamps the app already writes. It asks
 * nobody to record anything extra, and it invents nothing.
 *
 * WHAT IT WILL NOT CLAIM
 * ----------------------
 * The gap between an inspector's first and last verdict on a wagon is ELAPSED
 * time, not effort. They may have walked to stores, waited for a crane, or
 * gone to lunch in the middle of it. Reporting that gap as "time taken" would
 * be the sort of number that collapses the first time somebody senior asks how
 * it was arrived at.
 *
 * So spans broken by a gap longer than IDLE_GAP_MINUTES are split, and only
 * the worked portions are added up. That is still an upper bound on effort and
 * it is described as one.
 *
 * The paper side cannot be measured from here at all. It needs a supervisor
 * with a tally sheet, and the report says so rather than leaving a blank that
 * looks like a zero.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.resolve(import.meta.dirname, '../server/data/wrs_inspections.db');
const DAYS = Number(process.argv[2]) || 7;

/** A pause longer than this ends a working run rather than counting toward it. */
const IDLE_GAP_MINUTES = 15;

/*
 * Rates above these are not people working.
 *
 * WMM records the sorting bench at roughly seven hundred springs a shift, which
 * is about ninety an hour. Seeded and test data is written in bursts of
 * milliseconds, so running this against a development database produces figures
 * like five hundred springs an hour and four thousand checklist items an hour.
 *
 * Those numbers are not merely wrong, they are the kind of wrong that destroys
 * a pilot's credibility the moment somebody senior does the arithmetic in their
 * head. So the report says plainly when a rate cannot have come from a person,
 * rather than printing it next to the honest ones and letting the reader assume
 * they are alike.
 */
const PLAUSIBLE_SPRINGS_PER_HOUR = 200;
const PLAUSIBLE_ITEMS_PER_HOUR = 400;

let implausible = false;
function rate(perHour, ceiling) {
  if (!Number.isFinite(perHour) || perHour <= 0) return '—';
  if (perHour > ceiling) {
    implausible = true;
    return `${perHour.toFixed(1)}  ← not human work; seeded or test data`;
  }
  return perHour.toFixed(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const since = new Date(Date.now() - DAYS * 86400_000).toISOString();

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const line = (label, value) => console.log('  ' + String(label).padEnd(46) + value);

/**
 * Total worked minutes across a sorted list of instants, splitting on idle gaps.
 * A single reading is worth no time at all — one instant has no duration.
 */
function workedMinutes(instants) {
  const t = instants.map((s) => new Date(s).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  if (t.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < t.length; i++) {
    const gap = (t[i] - t[i - 1]) / 60000;
    if (gap <= IDLE_GAP_MINUTES) total += gap;
  }
  return total;
}

console.log();
console.log(`  WRS Raipur — shadow run, last ${DAYS} day(s)`);
console.log('  ' + '-'.repeat(52));
console.log(`  Idle gaps over ${IDLE_GAP_MINUTES} min are excluded from worked time.`);
console.log();

// --- The sorting bench -----------------------------------------------------
const springs = db.prepare(`
  SELECT created_at, inspector_id, status
  FROM spring_sorting_records
  WHERE created_at >= ? AND (voided IS NULL OR voided = 0)
  ORDER BY created_at
`).all(since);

console.log('  SPRING SORTING');
if (springs.length === 0) {
  line('springs sorted', '0 — nothing to measure yet');
} else {
  const minutes = workedMinutes(springs.map((r) => r.created_at));
  const condemned = springs.filter((r) => r.status === 'CONDEMNED').length;
  line('springs sorted', springs.length);
  line('condemned', `${condemned} (${fmt((condemned / springs.length) * 100)}%)`);
  line('worked time at the bench', `${fmt(minutes)} min`);
  line('springs per hour', minutes > 0 ? rate((springs.length / minutes) * 60, PLAUSIBLE_SPRINGS_PER_HOUR) : '—');
  line('inspectors involved', new Set(springs.map((r) => r.inspector_id)).size);
}
console.log();

// --- Wagon checklists ------------------------------------------------------
const verdicts = db.prepare(`
  SELECT wagon_number, COALESCE(manual_verdict_at, updated_at) AS at, inspector_id
  FROM checklist_items
  WHERE status != 'PENDING' AND COALESCE(manual_verdict_at, updated_at) >= ?
  ORDER BY wagon_number, at
`).all(since);

console.log('  WAGON CHECKLISTS');
if (verdicts.length === 0) {
  line('verdicts recorded', '0 — nothing to measure yet');
} else {
  const byWagon = new Map();
  for (const v of verdicts) {
    if (!byWagon.has(v.wagon_number)) byWagon.set(v.wagon_number, []);
    byWagon.get(v.wagon_number).push(v.at);
  }
  const perWagon = [...byWagon.entries()]
    .map(([wagon, times]) => ({ wagon, items: times.length, minutes: workedMinutes(times) }))
    .filter((w) => w.items > 1);

  line('verdicts recorded', verdicts.length);
  line('wagons touched', byWagon.size);

  if (perWagon.length > 0) {
    const totals = perWagon.reduce((a, w) => a + w.minutes, 0);
    const median = perWagon.map((w) => w.minutes).sort((a, b) => a - b)[Math.floor(perWagon.length / 2)];
    line('worked time on checklists', `${fmt(totals)} min across ${perWagon.length} wagon(s)`);
    line('median per wagon (upper bound on effort)', `${fmt(median)} min`);
    line('items per hour', totals > 0 ? rate((verdicts.length / totals) * 60, PLAUSIBLE_ITEMS_PER_HOUR) : '—');
  } else {
    line('per-wagon timing', 'needs a wagon with more than one verdict');
  }
}
console.log();

// --- Corrections, which are the quality argument ---------------------------
const overrides = db.prepare(
  `SELECT COUNT(*) AS c FROM inspections WHERE supervisor_override = 1 AND created_at >= ?`
).get(since);
const anomalies = db.prepare(
  `SELECT COUNT(*) AS c FROM spring_sorting_records WHERE supersedes IS NOT NULL AND created_at >= ?`
).get(since);

console.log('  WHAT THE APP CAUGHT');
line('supervisor overrides recorded', overrides.c);
line('readings withdrawn and re-taken', anomalies.c);
console.log();

// --- The half that cannot be measured from here ----------------------------
if (implausible) {
  console.log('  ⚠ THESE FIGURES ARE NOT FROM REAL WORK');
  console.log('  At least one rate above is faster than a person can work, which');
  console.log('  means this database holds seeded or test records. Run this against');
  console.log('  the shop\'s own installation after a real shift. Do not put any of');
  console.log('  these numbers in front of the DRM.');
  console.log();
}

console.log('  THE PAPER SIDE — NOT MEASURABLE FROM THIS DATABASE');
console.log('  A supervisor has to record these by hand during the parallel run,');
console.log('  or the comparison has only one side and proves nothing:');
console.log('    1. Minutes to complete one wagon on paper, start to finish.');
console.log('    2. Springs measured and written up per hour, on paper.');
console.log('    3. Discrepancies found between the two records — what, and why.');
console.log('    4. Anything the paper process caught that the app did not.');
console.log();
console.log('  Item 4 matters most and is the one people forget to record.');
console.log('  A pilot that only counts the app\'s wins is a pilot nobody senior');
console.log('  will believe.');
console.log();
