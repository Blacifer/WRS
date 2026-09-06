/**
 * No two inspections may be handed the same sequence number
 * Indian Railways WRS Raipur
 *
 * getNextSequenceNumber read `last_val`, added one in JavaScript, and wrote
 * the result back. Between the read and the write another writer could read
 * the same value, and both callers would be handed the same number.
 *
 * That number is how an inspector refers to a reading out loud — "check seq
 * 341" — and how a supervisor finds it again. Two readings sharing one is not
 * a cosmetic problem: it makes the reference ambiguous at exactly the moment
 * somebody is trying to check a condemnation.
 *
 * The same shape broke the audit chain, and that was found by running the
 * restore drill on the pilot database rather than by any test. This is the
 * same fault in the same file, fixed the same way: stop doing the arithmetic
 * outside the database.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { InspectionRepository } from '../src/db/repository.ts';
import { seedUsers } from '../src/db/seed.ts';

/** A real file, because two connections to :memory: are two databases. */
function tempDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-seq-')), 'seq.db');
}

describe('Inspection sequence allocation', () => {
  test('TC-SEQ-01: two connections to one database never get the same number', () => {
    /*
     * The exact interleaving the old code allowed: both read, then both
     * write. With a read-then-write pair each connection is handed the same
     * value; with one atomic statement SQLite serialises them.
     */
    const dbPath = tempDbPath();
    const a = new DatabaseSync(dbPath);
    a.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    runMigrations(a);

    const b = new DatabaseSync(dbPath);
    b.exec('PRAGMA busy_timeout = 5000;');

    const repoA = new InspectionRepository(a);
    const repoB = new InspectionRepository(b);

    const first = repoA.getNextSequenceNumber();
    const second = repoB.getNextSequenceNumber();

    assert.notEqual(first, second, 'two writers were handed the same sequence number');
    assert.equal(second, first + 1, 'and the second must follow the first');

    a.close();
    b.close();
  });

  test('TC-SEQ-02: numbers are unique and contiguous across interleaved connections', () => {
    const dbPath = tempDbPath();
    const a = new DatabaseSync(dbPath);
    a.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    runMigrations(a);
    const b = new DatabaseSync(dbPath);
    b.exec('PRAGMA busy_timeout = 5000;');

    const repoA = new InspectionRepository(a);
    const repoB = new InspectionRepository(b);

    const got: number[] = [];
    for (let i = 0; i < 50; i++) {
      got.push(repoA.getNextSequenceNumber());
      got.push(repoB.getNextSequenceNumber());
    }

    assert.equal(new Set(got).size, got.length, 'every number must be handed out once');
    assert.deepEqual(
      [...got].sort((x, y) => x - y),
      Array.from({ length: got.length }, (_, i) => i + 1),
      'and the run must have no gaps'
    );

    a.close();
    b.close();
  });

  test('TC-SEQ-03: a database with no counter row resumes past its existing records', () => {
    /*
     * Migrations insert the counter, so this is a file that predates it or was
     * built by hand. Restarting from 1 would hand out numbers already printed
     * on existing inspections.
     */
    const dbPath = tempDbPath();
    const db = new DatabaseSync(dbPath);
    runMigrations(db);
    seedUsers(db);   // an inspection must name a real inspector

    const repo = new InspectionRepository(db);
    repo.insertInspection({
      wagonNumber: 'SECR/BOXNHL/SEQ001',
      springPosition: 'OUTER',
      measuredFreeHeight: 260.0,
      inspectorId: 'usr_insp_001',
      sequenceNumber: 500
    } as any);

    db.prepare("DELETE FROM sequence_tracker WHERE name = 'inspection_seq'").run();

    assert.equal(repo.getNextSequenceNumber(), 501, 'must resume past the highest existing record');
    assert.equal(repo.getNextSequenceNumber(), 502, 'and keep going from there');

    db.close();
  });
});
