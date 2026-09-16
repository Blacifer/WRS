/**
 * The backup that schedules itself
 * Indian Railways WRS Raipur
 *
 * INSTALL §7 asks whoever installs the system to create a Task Scheduler job
 * for the nightly backup. That is the step that gets skipped in every shop in
 * the world, and the readiness row stays red until somebody notices. So the
 * server takes the backup itself: every night at the configured hour (02:00
 * by default), and on start-up if the newest backup is more than a day old
 * — a PC that was off for a week backs up within minutes of coming back.
 *
 * It runs the same script the scheduled task would (scripts/backup-db.mjs),
 * as a child process, so there is exactly one backup implementation and the
 * cloud copy rides on it. The key: WRS_BACKUP_KEY_FILE if set; otherwise a
 * key generated once into server/data/backup.key, which the readiness panel
 * flags until a copy has been put somewhere that is not this PC. A backup
 * under a key beside the database is still a backup against a dead disk,
 * which is the failure that actually happens; no backup at all is not.
 *
 * WRS_BACKUP_SCHEDULE=off disables it, for a mirror or a test.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SchedulerOptions {
  dbPath: string;
  backupDir: string;
  photoDir: string;
  /** Local hour of day to run, 0–23. */
  hour?: number;
  /** Where the key lives; generated here if absent and no WRS_BACKUP_KEY_FILE is set. */
  keyFile?: string;
  log?: (line: string) => void;
  /** For tests: the script to run instead of the real one. */
  scriptPath?: string;
}

/** The next occurrence of `hour` o'clock local time after `now`. */
export function nextRunAt(now: Date, hour: number): Date {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

/** Newest backup's mtime in the directory, or null. */
export function newestBackupMs(backupDir: string): number | null {
  try {
    let newest: number | null = null;
    for (const f of fs.readdirSync(backupDir)) {
      if (!f.endsWith('.db.enc')) continue;
      const m = fs.statSync(path.join(backupDir, f)).mtimeMs;
      if (newest === null || m > newest) newest = m;
    }
    return newest;
  } catch { return null; }
}

/** True when the newest backup is older than a day, or there is none. */
export function needsCatchUp(backupDir: string, now = Date.now()): boolean {
  const newest = newestBackupMs(backupDir);
  return newest === null || now - newest > 24 * 3_600_000;
}

/**
 * The key file to use. WRS_BACKUP_KEY_FILE wins. Otherwise a key is written
 * once beside the data directory, and `generated` says so.
 */
export function ensureKeyFile(dataDir: string): { keyFile: string; generated: boolean; besideDatabase: boolean } {
  const fromEnv = process.env.WRS_BACKUP_KEY_FILE;
  if (fromEnv) return { keyFile: fromEnv, generated: false, besideDatabase: path.resolve(path.dirname(fromEnv)) === path.resolve(dataDir) };
  const keyFile = path.join(dataDir, 'backup.key');
  if (fs.existsSync(keyFile)) return { keyFile, generated: false, besideDatabase: true };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
  return { keyFile, generated: true, besideDatabase: true };
}

export interface BackupRunResult { ok: boolean; startedAt: string; finishedAt: string; output: string; }

/** Run the backup script once, asynchronously, and record the outcome beside the backups. */
export function runBackupNow(opts: SchedulerOptions): Promise<BackupRunResult> {
  const script = opts.scriptPath || path.resolve(__dirname, '..', '..', 'scripts', 'backup-db.mjs');
  const startedAt = new Date().toISOString();
  const key = ensureKeyFile(path.dirname(opts.dbPath));
  return new Promise((resolve) => {
    execFile(process.execPath, ['--experimental-strip-types', script, opts.dbPath, opts.backupDir, opts.photoDir], {
      env: { ...process.env, WRS_BACKUP_KEY_FILE: key.keyFile }, timeout: 30 * 60_000, maxBuffer: 8 * 1024 * 1024
    }, (err, stdout, stderr) => {
      const finishedAt = new Date().toISOString();
      const output = `${stdout || ''}${stderr || ''}`.trim();
      const result = { ok: !err, startedAt, finishedAt, output: output.slice(-4000) };
      try {
        fs.mkdirSync(opts.backupDir, { recursive: true });
        fs.writeFileSync(path.join(opts.backupDir, 'last-run.json'), JSON.stringify({ ...result, keyFile: key.keyFile, keyBesideDatabase: key.besideDatabase, scheduledByServer: true }, null, 2) + '\n');
      } catch { /* the backup itself is what matters */ }
      resolve(result);
    });
  });
}

/** What the last server-run backup said, for the readiness panel. */
export function lastRun(backupDir: string): (BackupRunResult & { keyFile?: string; keyBesideDatabase?: boolean; scheduledByServer?: boolean }) | null {
  try { return JSON.parse(fs.readFileSync(path.join(backupDir, 'last-run.json'), 'utf8')); } catch { return null; }
}

/**
 * Start the schedule. Returns a stop function. Nothing runs synchronously
 * here: the catch-up backup, if due, is a few minutes after start so the
 * server is answering the tablets first.
 */
export function startBackupSchedule(opts: SchedulerOptions): () => void {
  const log = opts.log || (() => {});
  const hour = Number.isFinite(opts.hour) ? Number(opts.hour) : 2;
  const timers: NodeJS.Timeout[] = [];
  let running = false;
  const run = async (why: string) => {
    if (running) return;
    running = true;
    log(`[backup] ${why}: taking the nightly backup`);
    try {
      const r = await runBackupNow(opts);
      log(`[backup] ${r.ok ? 'done' : 'FAILED'} — ${r.output.split('\n').filter((l) => /Done\.|Cloud copy|ERROR|failed/i.test(l)).join(' | ') || r.output.slice(-200)}`);
    } finally { running = false; }
  };
  const key = ensureKeyFile(path.dirname(opts.dbPath));
  if (key.generated) log(`[backup] Generated a backup key at ${key.keyFile}. Copy it somewhere that is not this PC — without it no backup can be restored.`);
  if (needsCatchUp(opts.backupDir)) {
    timers.push(setTimeout(() => void run('no backup in the last 24 hours'), 3 * 60_000));
  }
  const scheduleNext = () => {
    const at = nextRunAt(new Date(), hour);
    log(`[backup] next nightly backup at ${at.toISOString()}`);
    timers.push(setTimeout(async () => { await run('scheduled'); scheduleNext(); }, at.getTime() - Date.now()));
  };
  scheduleNext();
  return () => { for (const t of timers) clearTimeout(t); };
}
