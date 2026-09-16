/**
 * The backup that schedules itself
 * Indian Railways WRS Raipur
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nextRunAt, needsCatchUp, ensureKeyFile, runBackupNow, lastRun } from '../src/backup/scheduler.ts';

describe('the schedule', () => {
  it('TC-SCH-01: the next run is tonight at the hour, or tomorrow if that hour has passed', () => {
    const at = (h: number, m = 0) => { const d = new Date(2026, 8, 16, h, m, 0, 0); return d; };
    assert.equal(nextRunAt(at(1, 30), 2).getTime(), at(2).getTime());
    assert.equal(nextRunAt(at(2, 0), 2).getTime(), new Date(2026, 8, 17, 2).getTime(), 'exactly on the hour counts as passed');
    assert.equal(nextRunAt(at(14), 2).getTime(), new Date(2026, 8, 17, 2).getTime());
  });

  it('TC-SCH-02: catch-up is due with no backup, or one older than a day', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-sch-'));
    assert.equal(needsCatchUp(dir), true);
    const f = path.join(dir, 'wrs_inspections_x.db.enc'); fs.writeFileSync(f, 'x');
    assert.equal(needsCatchUp(dir), false);
    const old = Date.now() - 30 * 3_600_000; fs.utimesSync(f, old / 1000, old / 1000);
    assert.equal(needsCatchUp(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('TC-SCH-03: without WRS_BACKUP_KEY_FILE a key is generated once beside the data, and flagged as such', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-key-'));
    const saved = process.env.WRS_BACKUP_KEY_FILE; delete process.env.WRS_BACKUP_KEY_FILE;
    try {
      const a = ensureKeyFile(dir);
      assert.equal(a.generated, true); assert.equal(a.besideDatabase, true);
      assert.equal(fs.readFileSync(a.keyFile, 'utf8').trim().length, 64);
      const b = ensureKeyFile(dir);
      assert.equal(b.generated, false); assert.equal(b.keyFile, a.keyFile);
      process.env.WRS_BACKUP_KEY_FILE = path.join(os.tmpdir(), 'elsewhere.key');
      assert.equal(ensureKeyFile(dir).besideDatabase, false);
    } finally { if (saved) process.env.WRS_BACKUP_KEY_FILE = saved; else delete process.env.WRS_BACKUP_KEY_FILE; fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('TC-SCH-04: a run takes a real encrypted backup with the real script and records the outcome', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-run-'));
    const saved = process.env.WRS_BACKUP_KEY_FILE; delete process.env.WRS_BACKUP_KEY_FILE;
    try {
      const dbPath = path.join(work, 'data', 'wrs.db'); fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new DatabaseSync(dbPath); db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1)'); db.close();
      const backupDir = path.join(work, 'backups');
      const r = await runBackupNow({ dbPath, backupDir, photoDir: path.join(work, 'data', 'photos') });
      assert.equal(r.ok, true, r.output);
      assert.ok(fs.readdirSync(backupDir).some((f) => f.endsWith('.db.enc')), 'an encrypted backup was written');
      const last = lastRun(backupDir)!;
      assert.equal(last.ok, true); assert.equal(last.scheduledByServer, true); assert.equal(last.keyBesideDatabase, true);
      assert.ok(fs.existsSync(path.join(work, 'data', 'backup.key')));
      assert.equal(needsCatchUp(backupDir), false);
    } finally { if (saved) process.env.WRS_BACKUP_KEY_FILE = saved; fs.rmSync(work, { recursive: true, force: true }); }
  });
});
