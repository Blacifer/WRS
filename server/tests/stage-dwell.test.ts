/**
 * Where wagons wait, and which one will miss its date — computed, not predicted
 * Indian Railways WRS Raipur
 *
 * wagon_transitions has held every stage move with its timestamp since the
 * first schema. From it the shop computed one figure: entry to release.
 * These tests pin the per-stage figures, the bottleneck, and the release
 * arithmetic — including what it refuses to say.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { dwellReport, stageIntervals, MIN_INTERVALS, type TransitionRow } from '../../shared/analysis/stageDwell.ts';
import { createApp } from '../src/app.ts';
import { getAnalyticsDwell } from '../src/db/wagonAnalytics.ts';
import { getDatabase } from '../src/db/connection.ts';

const T0 = Date.parse('2026-09-01T00:00:00Z');
const at = (h: number) => new Date(T0 + h * 3_600_000).toISOString();

/** A wagon that walked every stage, spending `hours[i]` in stage i. */
function walk(wagonNumber: string, wagonType: string, hours: number[], startH = 0): TransitionRow[] {
  const stages = ['ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE', 'RELEASE'] as const;
  const rows: TransitionRow[] = [{ wagonNumber, wagonType, fromStage: 'ENTRY_REGISTRATION', toStage: 'ENTRY_REGISTRATION', createdAt: at(startH) }];
  let h = startH;
  for (let i = 0; i < hours.length; i++) {
    h += hours[i];
    rows.push({ wagonNumber, wagonType, fromStage: stages[i], toStage: stages[i + 1], createdAt: at(h) });
  }
  return rows;
}

describe('stage intervals', () => {
  it('TC-DW-01: a completed stage is entry-to-exit; the stage a wagon is in now is open', () => {
    const rows = walk('W1', 'BOXNHL', [2, 10, 5]); // now at REPAIR_REPLACEMENT
    const { completed, open } = stageIntervals(rows, at(30));
    assert.deepStrictEqual(completed.map((c) => [c.stage, c.hours]), [['ENTRY_REGISTRATION', 2], ['DISMANTLING', 10], ['COMPONENT_INSPECTION', 5]]);
    assert.strictEqual(open.length, 1);
    assert.strictEqual(open[0].stage, 'REPAIR_REPLACEMENT');
    assert.strictEqual(open[0].hours, 13);
  });

  it('TC-DW-02: a released wagon has no open interval', () => {
    const { open } = stageIntervals(walk('W1', 'BOXNHL', [1, 1, 1, 1, 1, 1]), at(100));
    assert.strictEqual(open.length, 0);
  });
});

describe('the report', () => {
  const fleet = (n: number, repairHours: number, type = 'BOXNHL') =>
    Array.from({ length: n }, (_, i) => walk(`${type}-${i}`, type, [2, 8, 6, repairHours, 12, 4], i * 100)).flat();

  it('TC-DW-03: below the minimum, no median is quoted — a figure from four wagons is not a figure', () => {
    const r = dwellReport(fleet(MIN_INTERVALS - 1, 90), [], at(10_000));
    for (const s of r.byStage) assert.strictEqual(s.medianHours, null, s.stage);
    assert.strictEqual(r.bottleneck, null);
  });

  it('TC-DW-04: at the minimum, each stage has its median and the longest is the bottleneck', () => {
    const r = dwellReport(fleet(MIN_INTERVALS, 90), [], at(10_000));
    const repair = r.byStage.find((s) => s.stage === 'REPAIR_REPLACEMENT')!;
    assert.strictEqual(repair.n, MIN_INTERVALS);
    assert.strictEqual(repair.medianHours, 90);
    assert.deepStrictEqual(r.bottleneck, { stage: 'REPAIR_REPLACEMENT', medianHours: 90, n: MIN_INTERVALS });
  });

  it('TC-DW-05: a wagon\'s release is the sum of the medians of what is left, less what it has already spent where it is', () => {
    // 5 wagons of history; W-now entered REPAIR 30 h ago; target in 100 h.
    const now = at(10_000);
    const rows = [...fleet(5, 90), ...walk('W-now', 'BOXNHL', [2, 8, 6], 10_000 - 16 - 30)];
    const r = dwellReport(rows, [{ wagonNumber: 'W-now', wagonType: 'BOXNHL', currentStage: 'REPAIR_REPLACEMENT', targetReleaseDate: at(10_000 + 100) }], now);
    const p = r.projections.find((x) => x.wagonNumber === 'W-now')!;
    // remaining: REPAIR 90-30=60, REASSEMBLY 12, FINAL_QC 4 -> 76 h; target 100 h -> on time by 24 h
    assert.strictEqual(p.hoursRemaining, 76);
    assert.strictEqual(p.hoursLate, -24);
    assert.strictEqual(p.willMiss, false);
    assert.deepStrictEqual(p.steps.map((s) => [s.stage, s.medianHours, s.elapsedHours ?? null]), [
      ['REPAIR_REPLACEMENT', 90, 30], ['REASSEMBLY', 12, undefined ?? null], ['FINAL_QC_GATE', 4, null]
    ]);
    assert.strictEqual(p.steps[0].basis?.scope, 'TYPE');
  });

  it('TC-DW-06: a wagon already past a stage\'s median is given no time for it, not negative time', () => {
    const now = at(10_000);
    const rows = [...fleet(5, 90), ...walk('W-late', 'BOXNHL', [2, 8, 6], 10_000 - 16 - 200)];
    const r = dwellReport(rows, [{ wagonNumber: 'W-late', wagonType: 'BOXNHL', currentStage: 'REPAIR_REPLACEMENT', targetReleaseDate: at(10_000 + 10) }], now);
    const p = r.projections[0];
    assert.strictEqual(p.hoursRemaining, 16); // 0 + 12 + 4
    assert.strictEqual(p.willMiss, true);
    assert.strictEqual(p.hoursLate, 6);
  });

  it('TC-DW-07: a type the shop has not seen enough of falls back to the shop, and says so', () => {
    const now = at(10_000);
    const rows = [...fleet(5, 90, 'BOXNHL'), ...walk('BRN-1', 'BRN', [2, 8, 6], 10_000 - 16 - 1)];
    const r = dwellReport(rows, [{ wagonNumber: 'BRN-1', wagonType: 'BRN', currentStage: 'REPAIR_REPLACEMENT', targetReleaseDate: null }], now);
    const p = r.projections[0];
    assert.strictEqual(p.steps[0].basis?.scope, 'SHOP');
    assert.strictEqual(p.projectedReleaseDate !== null, true);
    assert.strictEqual(p.willMiss, null);
    assert.match(p.reason!, /No target release date/);
    assert.strictEqual(r.summary.noTargetDate, 1);
  });

  it('TC-DW-08: with no history for a remaining stage it refuses to name a date, and names the stage', () => {
    const now = at(10_000);
    // History that never went past REASSEMBLY.
    const partial = Array.from({ length: 6 }, (_, i) => walk(`P-${i}`, 'BOXNHL', [2, 8, 6, 20], i * 100)).flat();
    const rows = [...partial, ...walk('W', 'BOXNHL', [2, 8], 9_000)];
    const r = dwellReport(rows, [{ wagonNumber: 'W', wagonType: 'BOXNHL', currentStage: 'COMPONENT_INSPECTION', targetReleaseDate: at(10_100) }], now);
    const p = r.projections[0];
    assert.strictEqual(p.projectedReleaseDate, null);
    assert.match(p.reason!, /No median yet for reassembly/);
    assert.strictEqual(r.summary.notComputable, 1);
  });

  it('TC-DW-09: the ones that will miss come first', () => {
    const now = at(10_000);
    const rows = [...fleet(5, 90), ...walk('A', 'BOXNHL', [2, 8, 6], 9_900), ...walk('B', 'BOXNHL', [2, 8, 6], 9_900)];
    const r = dwellReport(rows, [
      { wagonNumber: 'A', wagonType: 'BOXNHL', currentStage: 'REPAIR_REPLACEMENT', targetReleaseDate: at(10_500) },
      { wagonNumber: 'B', wagonType: 'BOXNHL', currentStage: 'REPAIR_REPLACEMENT', targetReleaseDate: at(10_010) }
    ], now);
    assert.strictEqual(r.projections[0].wagonNumber, 'B');
    assert.strictEqual(r.summary.willMiss, 1);
    assert.strictEqual(r.summary.onTime, 1);
  });
});

describe('through the database', () => {
  it('TC-DW-10: reads real transitions and joins the wagon type; the registration row opens the first interval', async () => {
    const app = createApp(':memory:');
    const login = await app.dispatch({ method: 'POST', url: '/api/auth/login', body: { username: 'supervisor1', password: 'password123' } });
    const auth = { authorization: `Bearer ${login.body.token}` };
    const wagon = 'SECR/BOXNHL/55501';
    await app.dispatch({ method: 'POST', url: '/api/wagons/register', headers: auth, body: { wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR', targetReleaseDate: '2026-12-01T00:00:00Z' } });
    await app.dispatch({ method: 'POST', url: `/api/wagons/${encodeURIComponent(wagon)}/transition`, headers: auth, body: { targetStage: 'DISMANTLING' } });
    const r = getAnalyticsDwell(getDatabase());
    const p = r.projections.find((x) => x.wagonNumber === wagon)!;
    assert.ok(p, 'the active wagon is projected');
    assert.strictEqual(p.currentStage, 'DISMANTLING');
    assert.strictEqual(p.targetReleaseDate, '2026-12-01T00:00:00.000Z');
    assert.strictEqual(p.projectedReleaseDate, null, 'a fresh database has no history to compute from');
    assert.match(p.reason!, /No median yet/);
    const entry = r.byStage.find((s) => s.stage === 'ENTRY_REGISTRATION')!;
    assert.strictEqual(entry.n, 1, 'the registration row opened ENTRY_REGISTRATION and the move closed it');
    const admin = await app.dispatch({ method: 'POST', url: '/api/auth/login', body: { username: 'admin1', password: 'password123' } });
    const res = await app.dispatch({ method: 'GET', url: '/api/analytics/dwell', headers: { authorization: `Bearer ${admin.body.token}` } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.summary.active >= 1, true);
  });
});
