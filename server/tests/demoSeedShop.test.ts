/**
 * The demonstration record — what a demo database must hold, and must not
 * Indian Railways WRS Raipur
 *
 * A demonstration on an empty bench shows a shop that has never sorted a
 * spring. These pin what the seed writes so that every screen has something
 * honest to show: a month of gauge-attributed bench readings, certificates
 * that verify against this server's own key, a wagon with parts off and on,
 * counted assembly frames, and a shadow-run week. And what it must not write:
 * a number nobody computed. The typed "AI confidence" of the old OMRS seed
 * is gone, and this makes sure it stays gone.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedDemoData } from '../src/db/seed.ts';
import { verifyCertificate } from '../src/reports/certificateSigning.ts';
import { getObservedCondemnationRates } from '../src/db/wagonAnalytics.ts';
import { gaugeDrift } from '../../shared/analysis/gaugeDrift.ts';
import { PocketCountRepository } from '../src/db/pocketCountRepository.ts';

describe('The demonstration record', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedDemoData(db);
  });

  it('TC-DEMO-01: a month of the bench, every reading naming a gauge and an inspector, at the shop\'s pace', () => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM spring_sorting_records').get() as any).n;
    assert.ok(n >= 2000 && n <= 4000, `bench rows: ${n}`);
    const unattributed = (db.prepare('SELECT COUNT(*) AS n FROM spring_sorting_records WHERE gauge_code IS NULL OR inspector_id IS NULL').get() as any).n;
    assert.equal(unattributed, 0);
    const condemned = (db.prepare("SELECT COUNT(*) AS n FROM spring_sorting_records WHERE status = 'CONDEMNED'").get() as any).n;
    const pct = (condemned / n) * 100;
    assert.ok(pct > 2 && pct < 10, `condemnation ${pct.toFixed(1)}% — about the rate the shop quotes, not zero and not alarming`);
    // The bench is what the forecast reads; with a month on record it has rates to offer.
    const rates = getObservedCondemnationRates(db) as any[];
    assert.ok(rates.some((r) => r.condemned >= 30), 'at least one spring kind has 30 condemnations behind it, so the forecast forecasts');
  });

  it('TC-DEMO-02: the released wagons carry certificates that verify against this server\'s key, and their release dates', () => {
    const rows = db.prepare('SELECT * FROM gate_signoffs').all() as any[];
    assert.equal(rows.length, 2);
    for (const r of rows) {
      const canonical = JSON.stringify({ wagonNumber: r.wagon_number, certificateNumber: r.certificate_number, supervisorId: r.supervisor_id, supervisorEmployeeId: r.supervisor_employee_id, signedAt: r.signed_at, summary: JSON.parse(r.checks_summary_json) });
      assert.equal(verifyCertificate(canonical, r.digital_signature), true, `${r.wagon_number} verifies`);
      assert.ok(!/DIGISIG/.test(r.digital_signature), 'no placeholder signature');
      const w = db.prepare('SELECT actual_release_date, entry_date FROM wagons WHERE wagon_number = ?').get(r.wagon_number) as any;
      const days = (new Date(w.actual_release_date).getTime() - new Date(w.entry_date).getTime()) / 86400000;
      assert.ok(days >= 5 && days <= 7, `turnaround ${days.toFixed(1)} days`);
    }
  });

  it('TC-DEMO-03: one gauge reads high on purpose, and the drift check finds it', () => {
    const since = new Date(Date.now() - 40 * 86400000).toISOString();
    const readings = (db.prepare(`SELECT gauge_code AS gaugeCode, bogie_type || '|' || spring_condition || '|' || spring_position AS kind, measured_height AS heightMm
                                 FROM spring_sorting_records WHERE created_at >= ? AND voided = 0 AND gauge_code IS NOT NULL`).all(since) as any[]);
    const drift = gaugeDrift(readings);
    const high = drift.find((g) => g.gaugeCode === 'OSG-02' && g.flagged);
    assert.ok(high, `OSG-02 is flagged: ${JSON.stringify(drift.filter((g) => g.gaugeCode === 'OSG-02'))}`);
    assert.ok(high!.shiftMm! >= 0.8, `shift ${high!.shiftMm} mm`);
  });

  it('TC-DEMO-04: one wagon\'s story — parts, an air-brake test, counted frames, a short one', () => {
    assert.ok((db.prepare("SELECT COUNT(*) AS n FROM wagon_part_ledger WHERE wagon_number = 'CR/BOBRN/50223'").get() as any).n >= 10);
    assert.ok((db.prepare("SELECT COUNT(*) AS n FROM wagon_part_ledger WHERE event = 'SCRAPPED' AND reason IS NOT NULL").get() as any).n >= 1, 'a scrap with a reason');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM swt_tests').get() as any).n, 3);
    const frames = new PocketCountRepository(db).wagonSummary('WR/BCNHL/40112');
    assert.equal(frames.length, 4);
    assert.ok(frames.some((f) => f.comparison?.verdict === 'SHORT'), 'one frame is short');
    assert.ok(frames.some((f) => f.recount && f.agree === true), 'one frame has an agreeing blind recount');
  });

  it('TC-DEMO-05: a week of the shadow run, with the one case that decides go-live', () => {
    const rows = db.prepare('SELECT * FROM shadow_discrepancies').all() as any[];
    assert.equal(rows.length, 3);
    assert.ok(rows.some((r) => r.would_have_stopped_a_wagon === 1 && r.who_was_right === 'APP'));
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM shadow_daily_summaries').get() as any).n, 1);
  });

  it('TC-DEMO-06: no number nobody computed — the OMRS "AI triage" is gone', () => {
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM omrs_scans').get() as any).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE source = 'OMRS_AI_TRIAGE'").get() as any).n, 0);
  });

  it('TC-DEMO-07: running the seed twice writes nothing twice, and every live-record query has its index', () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM spring_sorting_records').get() as any).n;
    seedDemoData(db);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM spring_sorting_records').get() as any).n, before);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM wagons').get() as any).n, 13);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM gate_signoffs').get() as any).n, 2);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'spring_sorting_records'").all().map((r: any) => r.name);
    assert.ok(idx.includes('idx_sorting_supersedes'), `supersedes is indexed: ${idx.join(', ')}`);
  });
});
