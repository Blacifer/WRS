/**
 * A table rebuild that dies halfway leaves the table as it was
 * Indian Railways WRS Raipur
 *
 * Three migrations widen a CHECK by copying a table, dropping the original
 * and renaming the copy. Each ran as separate statements with nothing around
 * them. A power cut between the DROP and the RENAME — the shop PC is not on a
 * UPS — would have left the database without the table. For inspections,
 * that is the inspection record. INSTALL.md's advice was "take a backup
 * first anyway", which is advice for a fault, not a fix for one.
 *
 * These tests put the database back to the old shape with real rows in it,
 * kill the migration at the worst moment, and check that nothing changed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, rebuildAtomically } from '../src/db/migrations.ts';

/** A migrated database, then its inspections table put back to the old CHECK, with rows. */
function oldShapeWithRows(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);

  db.exec("INSERT OR IGNORE INTO users (id, username, password_hash, role, full_name, employee_id) VALUES ('u1','u1','x','INSPECTOR','U One','E1')");
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inspections'").get() as any).sql as string;
  assert.match(sql, /'CAMERA_AUTO'/, 'the migrated shape is the new one');
  const old = sql.replace(/CHECK\s*\(\s*measurement_source\s+IN\s*\([^)]*\)\s*\)/i, "CHECK(measurement_source IN ('MANUAL', 'OCR'))");

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('DROP TRIGGER IF EXISTS trg_prevent_inspections_update;');
  db.exec('DROP TRIGGER IF EXISTS trg_prevent_inspections_delete;');
  db.exec('DROP TABLE inspections;');
  db.exec(old);
  db.exec('PRAGMA foreign_keys = ON;');

  const cols = (db.prepare('PRAGMA table_info(inspections)').all() as any[]).map((c) => c.name);
  const minimal: Record<string, any> = {
    id: 'i1', wagon_number: 'W1', bogie_type: 'CASNUB_22_NLB', spring_condition: 'USED', spring_position: 'OUTER',
    measured_height: 258, classified_band: 'BLUE', band_roman: 'Band I', status: 'PASS', inspector_id: 'u1', inspector_name: 'U One',
    measurement_source: 'MANUAL'
  };
  const notNull = (db.prepare('PRAGMA table_info(inspections)').all() as any[]).filter((c) => c.notnull && c.dflt_value === null && !(c.name in minimal)).map((c) => c.name);
  for (const c of notNull) minimal[c] = c.endsWith('_at') ? new Date().toISOString() : 'x';
  const use = cols.filter((c) => c in minimal);
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO inspections (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`)
      .run(...use.map((c) => (c === 'id' ? `i${i}` : minimal[c])));
  }
  return db;
}

const rows = (db: DatabaseSync) => Number((db.prepare('SELECT COUNT(*) AS c FROM inspections').get() as any).c);
const tableSql = (db: DatabaseSync, name: string) => (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as any)?.sql as string | undefined;

describe('rebuildAtomically', () => {
  it('TC-MIG-01: a body that drops the table and then fails leaves the table untouched', () => {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('a'), ('b');");
    assert.throws(
      () => rebuildAtomically(db, 't rebuild', () => {
        db.exec('CREATE TABLE t_new (id INTEGER PRIMARY KEY, v TEXT);');
        db.exec('INSERT INTO t_new SELECT * FROM t;');
        db.exec('DROP TABLE t;');
        throw new Error('power cut');
      }),
      /t rebuild: rolled back, nothing changed — power cut/
    );
    assert.strictEqual(Number((db.prepare('SELECT COUNT(*) AS c FROM t').get() as any).c), 2);
    assert.strictEqual(tableSql(db, 't_new'), undefined, 'the half-built copy is gone too');
    // And the database is not left inside a transaction.
    db.exec('BEGIN; COMMIT;');
  });

  it('TC-MIG-02: foreign keys are enforced again afterwards, whether it succeeded or failed', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p(id));');
    db.exec('PRAGMA foreign_keys = ON;');
    assert.throws(() => rebuildAtomically(db, 'x', () => { throw new Error('no'); }));
    assert.strictEqual((db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys, 1);
    rebuildAtomically(db, 'x', () => undefined);
    assert.strictEqual((db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys, 1);
  });
});

describe('the inspections rebuild', () => {
  it('TC-MIG-10: killed between DROP and RENAME, the old table and every row survive', () => {
    const db = oldShapeWithRows();
    assert.strictEqual(rows(db), 3);
    assert.doesNotMatch(tableSql(db, 'inspections')!, /'CAMERA_AUTO'/);

    // Die on the RENAME — the moment the table has been dropped and its
    // replacement has not yet taken its name.
    const realExec = db.exec.bind(db);
    let killed = false;
    (db as any).exec = (sql: string) => {
      if (/ALTER TABLE inspections_srcfix RENAME/i.test(sql)) {
        killed = true;
        throw new Error('power cut');
      }
      return realExec(sql);
    };
    assert.throws(() => runMigrations(db), /inspections rebuild: rolled back, nothing changed — power cut/);
    assert.strictEqual(killed, true, 'the kill point was reached');
    (db as any).exec = realExec;

    assert.strictEqual(rows(db), 3, 'every inspection is still there');
    assert.doesNotMatch(tableSql(db, 'inspections')!, /'CAMERA_AUTO'/, 'and the table is exactly as it was');
    assert.strictEqual(tableSql(db, 'inspections_srcfix'), undefined);
    // The append-only triggers were dropped inside the transaction, so they are back.
    assert.throws(() => db.exec("DELETE FROM inspections WHERE id = 'i0'"), /append-only/);
  });

  it('TC-MIG-11: run again without the fault, it completes, and the rows come across', () => {
    const db = oldShapeWithRows();
    runMigrations(db);
    assert.strictEqual(rows(db), 3);
    assert.match(tableSql(db, 'inspections')!, /'CAMERA_AUTO'/);
    assert.throws(() => db.exec("DELETE FROM inspections WHERE id = 'i0'"), /append-only/);
    const idx = (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND tbl_name='inspections' AND name LIKE 'idx_inspections_%'").get() as any).c;
    assert.strictEqual(Number(idx), 7, 'all seven indexes recreated');
  });
});
