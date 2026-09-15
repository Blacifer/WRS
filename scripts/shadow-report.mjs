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
 *
 * SINCE THE SHADOW RUN MOVED INTO THE APP
 * ---------------------------------------
 * The figures here are the figures on the Shadow Run screen, computed by the
 * same code (server/src/db/shadowRepository.ts over shared/analysis/). This
 * script is the version for a terminal — a supervisor's PC with the database
 * file and no browser — and the paper side it cannot measure is now the two
 * forms on that screen, whose entries it prints when they exist.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { ShadowRepository } from '../server/src/db/shadowRepository.ts';

const DB_PATH = process.env.DB_PATH || path.resolve(import.meta.dirname, '../server/data/wrs_inspections.db');
const DAYS = Number(process.argv[2]) || 7;

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const r = new ShadowRepository(db).report(DAYS);

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const line = (label, value) => console.log('  ' + String(label).padEnd(46) + value);
const rate = (x) => (x.perHour === null ? '—' : x.plausible ? `${fmt(x.perHour)}/h` : `${fmt(x.perHour)}/h  ⚠ NOT PLAUSIBLE FOR A PERSON`);

console.log();
console.log(`  WRS Raipur — shadow run, last ${DAYS} day(s)`);
console.log('  ' + '-'.repeat(52));
console.log(`  Idle gaps over ${r.idleGapMinutes} min are excluded from worked time.`);
console.log();

const total = (k) => r.days.reduce((a, d) => a + d[k], 0);
console.log('  THE APP\'S HALF');
line('springs recorded (bench + wagons)', total('springsRecorded'));
line('condemned', total('springsCondemned'));
line('wagons swept', total('wagonsSwept'));
line('nests flagged', total('nestsFlagged'));
line('supervisor overrides recorded', total('overrides'));
line('readings withdrawn and re-taken', total('withdrawn'));
console.log();
console.log('  DAY BY DAY');
for (const d of r.days) {
  line(d.date, `${d.springsRecorded} springs, ${d.bench.workedMinutes} min at the bench (${rate(d.bench.springsPerHour)}), ${d.checklists.verdicts} verdicts on ${d.checklists.wagons} wagon(s)`);
}
console.log();

console.log('  THE AMBER BOX');
line('raised', r.verdict.amber.raised);
line('answered: re-measured, it was wrong', r.verdict.amber.reMeasured);
line('answered: the reading stands', r.verdict.amber.stands);
line('not answered at all', r.verdict.amber.unanswered);
console.log();

console.log('  THE PAPER SIDE — from the two forms on the Shadow Run screen');
line('discrepancies logged', r.verdict.discrepancies.total);
line('  the app was right', r.verdict.discrepancies.appRight);
line('  the register was right', r.verdict.discrepancies.registerRight);
line('  would have stopped a wagon', r.verdict.discrepancies.wouldHaveStoppedAWagon);
line('shift summaries', r.summaries.length);
line('one wagon, both ways (paired)', r.verdict.timing.pairs === 0 ? 'none yet' : `${r.verdict.timing.medianRegisterMinutes} min on paper → ${r.verdict.timing.medianAppMinutes} min in the app (${r.verdict.timing.pairs})`);
line('transcription errors the box missed', r.verdict.transcriptionErrorsBoxMissed);
console.log();

console.log('  READING THE LOG');
line('app passed what the register condemned', r.verdict.appPassedRegisterCondemned + (r.verdict.blocking ? '  ← BLOCKS GOING LIVE' : ''));
for (const f of r.verdict.findings) console.log('  • ' + f);
if (r.verdict.findings.length === 0) console.log('  nothing to raise from what has been written down so far');
console.log();

if (r.anyImplausible) {
  console.log('  ⚠ THESE FIGURES ARE NOT FROM REAL WORK');
  console.log('  At least one rate above is faster than a person can work, which');
  console.log('  means this database holds seeded or test records. Run this against');
  console.log('  the shop\'s own installation after a real shift. Do not put any of');
  console.log('  these numbers in front of the DRM.');
  console.log();
}
if (r.verdict.discrepancies.total === 0 && r.summaries.length === 0) {
  console.log('  The paper side is empty. A supervisor has to write it down during the');
  console.log('  parallel run — on the Shadow Run screen, or on the printed forms — or');
  console.log('  the comparison has only one side and proves nothing. The entry people');
  console.log('  forget is the one that matters most: anything the register caught');
  console.log('  that the app did not.');
  console.log();
}
