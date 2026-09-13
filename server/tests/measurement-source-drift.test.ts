/**
 * MeasurementSource — the union and the database agree
 * Indian Railways WRS Raipur
 *
 * The fault this guards against actually happened. CAMERA_ASSISTED was added
 * to the TypeScript union with no migration; the CHECK on
 * inspections.measurement_source still said ('MANUAL', 'OCR'); and the first
 * write with the new value would have been refused by the database — silently,
 * because the sorting route swallows write failures so that a ledger problem
 * never costs an inspector their tap. A camera that appeared to work and
 * recorded nothing.
 *
 * The same drift had already happened once to the learning subsystems. Twice
 * is a pattern, and the pattern is: the constraint is the authority, and a
 * widened union without a matching migration is not a change, it is a silent
 * no-op. So this pins every table that carries a source to the one list.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { ALL_MEASUREMENT_SOURCES } from '../../shared/types.ts';

const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'schema.sql');

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  seedUsers(db);
  return db;
}

/** What the database will actually accept for a column, read from its CHECK. */
function allowedByDb(db: DatabaseSync, table: string, column: string): string[] {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { sql?: string } | undefined;
  const re = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`, 'i');
  const check = re.exec(row?.sql || '');
  assert.ok(check, `${table}.${column} must be constrained by a CHECK — without it nothing guards this`);
  return [...check[1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!).sort();
}

const TABLES: Array<[string, string]> = [
  ['inspections', 'measurement_source'],
  ['spring_sorting_records', 'measurement_source'],
  ['checklist_items', 'verdict_source']
];

describe('MeasurementSource — the union and every table that stores one agree', () => {
  it('1. every table admits exactly the values the union declares', () => {
    const db = freshDb();
    const declared = [...ALL_MEASUREMENT_SOURCES].sort();
    for (const [table, column] of TABLES) {
      assert.deepStrictEqual(
        allowedByDb(db, table, column),
        declared,
        `${table}.${column} and ALL_MEASUREMENT_SOURCES have drifted apart`
      );
    }
  });

  it('2. every source survives a real write to every table', () => {
    // The CHECK is read above; this is the write actually going through, on a
    // fresh database, so a regex that happened to match cannot pass this.
    const db = freshDb();
    const user = db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string };

    for (const source of ALL_MEASUREMENT_SOURCES) {
      // spring_sorting_records: the bench.
      assert.doesNotThrow(
        () =>
          db
            .prepare(
              `INSERT INTO spring_sorting_records
                 (id, batch_id, bogie_type, spring_condition, spring_position, measured_height,
                  height_is_approximate, classified_band, status, inspector_id, measurement_source)
               VALUES (?, 'b', 'CASNUB_22_NLB', 'USED', 'OUTER', 250, 0, 'BLUE', 'PASS', ?, ?)`
            )
            .run(`ssr_${source}`, user.id, source),
        `spring_sorting_records refused ${source}`
      );
    }

    // And the one that must be refused, so the CHECK is known to be live.
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO spring_sorting_records
               (id, batch_id, bogie_type, spring_condition, spring_position, measured_height,
                height_is_approximate, classified_band, status, inspector_id, measurement_source)
             VALUES ('ssr_bad', 'b', 'CASNUB_22_NLB', 'USED', 'OUTER', 250, 0, 'BLUE', 'PASS', ?, 'GUESSED')`
          )
          .run(user.id),
      /CHECK constraint failed/i,
      'a value outside the union must be refused, or the constraint is not doing anything'
    );
  });

  it('3. an existing database with the old two-value CHECK is widened, with nothing lost', () => {
    // Simulate the shop's database as it was: build fresh, then narrow the
    // CHECK back to the old two values the way the old schema had it, insert
    // rows, and run the migrations again.
    const db = freshDb();
    const user = db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string };
    const rowsBefore = Number((db.prepare('SELECT COUNT(*) c FROM inspections').get() as any).c);

    // Rebuild inspections with the OLD check, carrying the rows over.
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='inspections'").get() as any).sql as string;
    const old = sql
      .replace(/CREATE TABLE\s+["'`]?inspections["'`]?/i, 'CREATE TABLE inspections_old')
      .replace(/CHECK\s*\(\s*measurement_source\s+IN\s*\([^)]*\)\s*\)/i, "CHECK(measurement_source IN ('MANUAL', 'OCR'))");
    const cols = (db.prepare('PRAGMA table_info(inspections)').all() as any[]).map((c) => c.name).join(', ');
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('DROP TRIGGER IF EXISTS trg_prevent_inspections_update;');
    db.exec('DROP TRIGGER IF EXISTS trg_prevent_inspections_delete;');
    db.exec(old);
    db.exec(`INSERT INTO inspections_old (${cols}) SELECT ${cols} FROM inspections;`);
    db.exec('DROP TABLE inspections;');
    db.exec('ALTER TABLE inspections_old RENAME TO inspections;');
    db.exec('PRAGMA foreign_keys = ON;');
    assert.deepStrictEqual(allowedByDb(db, 'inspections', 'measurement_source'), ['MANUAL', 'OCR']);

    // The shop's database now. Run the migrations on it.
    runMigrations(db);

    assert.deepStrictEqual(allowedByDb(db, 'inspections', 'measurement_source'), [...ALL_MEASUREMENT_SOURCES].sort());
    assert.strictEqual(Number((db.prepare('SELECT COUNT(*) c FROM inspections').get() as any).c), rowsBefore);
    // The append-only triggers must have come back with it. Checked in
    // sqlite_master rather than by attempting an UPDATE: on an empty table an
    // UPDATE matches no rows and a BEFORE UPDATE trigger never fires, which
    // reads as "no trigger" when the trigger is there.
    const triggers = (db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='inspections' ORDER BY name")
      .all() as Array<{ name: string }>).map((t) => t.name);
    assert.deepStrictEqual(triggers, ['trg_prevent_inspections_delete', 'trg_prevent_inspections_update']);
    // And the indexes.
    const idx = Number((db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE tbl_name='inspections' AND type='index' AND name LIKE 'idx_%'").get() as any).c);
    assert.strictEqual(idx, 7, 'all seven indexes must be recreated');
    void user;
  });
});

describe('schema.sql alone — the file a fresh install and the e2e harness both use', () => {
  it('4. every table carries the column and the full CHECK without any migration running', () => {
    // The migration ALTERs a column onto an existing database. A fresh
    // database is built from schema.sql, and the e2e harness does exactly
    // that with no migration in between — which is how the column went
    // missing there while every migrated test passed.
    const db = new DatabaseSync(':memory:');
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    const declared = [...ALL_MEASUREMENT_SOURCES].sort();
    for (const [table, column] of TABLES) {
      assert.deepStrictEqual(allowedByDb(db, table, column), declared, `${table}.${column} is missing from schema.sql`);
    }
  });
});
