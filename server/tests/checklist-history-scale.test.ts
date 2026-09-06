/**
 * The wagon history must not read the whole audit log
 * Indian Railways WRS Raipur
 *
 * The wagon number lives inside payload_json rather than in a column, so
 * "this wagon's checklist history" had no index to use. The condition report
 * pulled every CHECKLIST_ITEM_INSPECTED row ever written and picked out the
 * wagon's own in JavaScript.
 *
 * At the pilot's forty events that is invisible. Measured on a year of
 * records — 199,500 events — it took 3.6 seconds to find 35 rows, on a screen
 * somebody opens while standing at a wagon. Filtered in SQL against a partial
 * index on the same expression: 0.3 ms.
 *
 * This test pins the plan rather than a stopwatch. A timing assertion on a
 * shared machine is a flake generator, and the thing that actually matters is
 * whether SQLite searches an index or reads the table.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';

describe('Checklist history at volume', () => {
  let db: DatabaseSync;

  before(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
  });

  test('TC-HSC-01: the index exists, and covers only checklist events', () => {
    const row = db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_audit_checklist_wagon'
    `).get() as any;

    assert.ok(row, 'the history query has no index without it');
    // Partial, so it costs nothing on the other event types — logins are by
    // far the most numerous and have no wagon at all.
    assert.match(row.sql, /WHERE event_type = 'CHECKLIST_ITEM_INSPECTED'/);
    assert.match(row.sql, /json_extract/);
  });

  test('TC-HSC-03: the shop-wide findings query is answered from an index', () => {
    /*
     * "What keeps coming back" reads every checklist row rather than one
     * wagon's, so the two existing indexes — both led by wagon_number — are
     * no help to it. It also counts each status and takes MAX(updated_at), so
     * an index without those columns still fetches every matching row.
     *
     * Measured on a year of records, 82,000 checklist rows: 469 ms with no
     * index, 121 ms with the narrow form, 30 ms covering. This pins the
     * covering plan, because the narrow one looks correct and is four times
     * slower.
     */
    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT part_name, category,
             COUNT(DISTINCT wagon_number) AS wagonsAffected,
             SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) AS condemned,
             MAX(updated_at) AS lastSeen
      FROM checklist_items
      WHERE status IN ('FAIL', 'CONDEMNED', 'REPAIRED', 'REPLACED')
      GROUP BY part_name, category
    `).all() as any[];

    const detail = plan.map((p) => p.detail).join(' | ');
    assert.match(detail, /COVERING INDEX idx_checklist_findings/, `plan was: ${detail}`);
  });

  test('TC-HSC-02: the history query searches the index rather than scanning', () => {
    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT payload_json, created_at, user_id
      FROM inspection_audit_log
      WHERE event_type = 'CHECKLIST_ITEM_INSPECTED'
        AND json_extract(payload_json, '$.wagonNumber') = ?
      ORDER BY created_at ASC
    `).all('SECR/BOXNHL/10001') as any[];

    const detail = plan.map((p) => p.detail).join(' | ');

    assert.match(detail, /USING INDEX idx_audit_checklist_wagon/, `plan was: ${detail}`);
    assert.doesNotMatch(
      detail,
      /SCAN inspection_audit_log/,
      'reading the whole audit log to answer one wagon is the fault being fixed'
    );
  });
});
