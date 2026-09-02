/**
 * Learning Subsystem Drift Tests
 * Indian Railways WRS Raipur
 *
 * Three times now this codebase has been bitten by the same thing: a list
 * maintained by hand drifting from the source it is supposed to mirror.
 *
 *   tests/runner.ts   SUITES omitted a test file, and the runner reported a
 *                     pass over 38 suites while never opening the 39th.
 *   AuditEventType    fell to eight values against the audit log's own CHECK
 *                     of twenty-four, and every call site papered over the
 *                     gap with `as any`.
 *   LearningSubsystem the union gained MEASUREMENT_ANOMALY and the database
 *                     CHECK did not, so every write was refused — into a
 *                     catch that swallowed it, leaving the ledger silently
 *                     empty. The same five strings were also written out by
 *                     hand in three more places, none of which were updated.
 *
 * Each was found by accident rather than by anything watching. These tests
 * watch. They compare the constant against the schema that actually governs
 * it, so a fourth instance fails here instead of six months later.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import {
  LearningService,
  ALL_LEARNING_SUBSYSTEMS,
  type LearningSubsystem
} from '../src/learning/learningService.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', 'src', 'db', 'schema.sql');

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  seedUsers(db);
  return db;
}

/** The subsystem values the live database will actually accept. */
function subsystemsAllowedByDb(db: DatabaseSync): string[] {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='machine_learning_events'")
    .get() as { sql?: string } | undefined;

  const check = /CHECK\s*\(\s*subsystem\s+IN\s*\(([^)]*)\)\s*\)/i.exec(row?.sql || '');
  assert.ok(check, 'machine_learning_events must constrain subsystem — without it nothing guards this');

  return [...check[1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
}

describe('Learning subsystems — the list, the schema, and the screens agree', () => {
  describe('1. The constant matches the database that governs it', () => {
    it('TC-DRIFT-01: every declared subsystem is one the database will accept', () => {
      const db = freshDb();
      const allowed = subsystemsAllowedByDb(db);

      for (const subsystem of ALL_LEARNING_SUBSYSTEMS) {
        assert.ok(
          allowed.includes(subsystem),
          `${subsystem} is declared in ALL_LEARNING_SUBSYSTEMS but the CHECK on ` +
            `machine_learning_events would refuse it. Every write would fail — and the ` +
            `sorting route swallows that failure, so it would fail silently. Add a migration.`
        );
      }
      db.close();
    });

    it('TC-DRIFT-02: the database accepts nothing the constant has not declared', () => {
      const db = freshDb();
      const allowed = subsystemsAllowedByDb(db);

      for (const value of allowed) {
        assert.ok(
          (ALL_LEARNING_SUBSYSTEMS as readonly string[]).includes(value),
          `The database admits "${value}" but ALL_LEARNING_SUBSYSTEMS does not declare it, ` +
            `so rows of that kind could exist and never appear on any screen.`
        );
      }
      db.close();
    });

    it('TC-DRIFT-03: a fresh schema and a migrated one agree', () => {
      /*
       * schema.sql builds a new database; migrations.ts repairs an existing
       * one. They are edited separately and it is entirely possible to fix
       * only one — in which case the shop's live database and a developer's
       * fresh one behave differently, which is the worst kind of bug to chase.
       */
      const migrated = freshDb();
      const fromSchema = new DatabaseSync(':memory:');
      fromSchema.exec(fs.readFileSync(SCHEMA_PATH, 'utf-8'));

      assert.deepEqual(
        subsystemsAllowedByDb(fromSchema).sort(),
        subsystemsAllowedByDb(migrated).sort(),
        'schema.sql and migrations.ts must admit the same subsystems'
      );

      migrated.close();
      fromSchema.close();
    });
  });

  describe('2. Every subsystem survives a real write', () => {
    it('TC-DRIFT-04: each one can actually be recorded and read back', () => {
      const db = freshDb();
      const service = new LearningService(db);

      for (const subsystem of ALL_LEARNING_SUBSYSTEMS) {
        assert.doesNotThrow(
          () =>
            service.recordOutcome({
              subsystem: subsystem as LearningSubsystem,
              machineOutput: { probe: true },
              wasCorrected: false
            }),
          `recordOutcome refused ${subsystem}`
        );
      }

      const n = db
        .prepare('SELECT COUNT(*) AS n FROM machine_learning_events')
        .get() as { n: number };
      assert.equal(n.n, ALL_LEARNING_SUBSYSTEMS.length);
      db.close();
    });

    it('TC-DRIFT-05: the ledger stays append-only after the table rebuild', () => {
      /*
       * Admitting MEASUREMENT_ANOMALY meant rebuilding the table, because
       * SQLite cannot alter a CHECK in place. Dropping a table takes its
       * triggers with it, and these two are what make the ledger evidence
       * rather than notes. A rebuild that quietly loses them leaves something
       * that looks intact and can be rewritten.
       */
      const db = freshDb();
      new LearningService(db).recordOutcome({
        subsystem: 'MEASUREMENT_ANOMALY',
        machineOutput: {},
        wasCorrected: true
      });

      assert.throws(
        () => db.exec('DELETE FROM machine_learning_events'),
        /append-only/i,
        'evidence must not be deletable'
      );
      assert.throws(
        () => db.exec('UPDATE machine_learning_events SET was_corrected = 0'),
        /append-only/i,
        'evidence must not be rewritable'
      );
      db.close();
    });
  });

  describe('3. The screens report every subsystem', () => {
    it('TC-DRIFT-06: getMemory covers the whole list, not a copy of it', () => {
      const db = freshDb();
      const memory = new LearningService(db).getMemory();
      const reported = memory.observations.map((o) => o.subsystem).sort();

      assert.deepEqual(
        reported,
        [...ALL_LEARNING_SUBSYSTEMS].sort(),
        'a subsystem missing here is recorded and invisible'
      );
      db.close();
    });

    it('TC-DRIFT-07: a recorded anomaly outcome reaches the dashboard', () => {
      const db = freshDb();
      const service = new LearningService(db);

      // The flag being raised, then the inspector re-measuring.
      service.recordOutcome({
        subsystem: 'MEASUREMENT_ANOMALY',
        machineOutput: { measuredHeight: 206.5, kinds: ['DIGIT_TRANSPOSITION'] },
        wasCorrected: false,
        context: { answered: false }
      });
      service.recordOutcome({
        subsystem: 'MEASUREMENT_ANOMALY',
        machineOutput: { flagged: true, originalHeight: 206.5 },
        humanOutput: { action: 'RE_MEASURED', correctedHeight: 260.5 },
        wasCorrected: true,
        correctionMagnitude: 54,
        context: { answered: true }
      });

      const row = new LearningService(db)
        .getMemory()
        .observations.find((o) => o.subsystem === 'MEASUREMENT_ANOMALY');

      assert.ok(row);
      assert.equal(row.total, 2);
      assert.equal(row.corrected, 1);
      assert.equal(
        row.enoughToLearnFrom,
        false,
        'two observations must not be presented as something learned from'
      );
      db.close();
    });
  });
});
