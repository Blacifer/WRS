/**
 * Health and System Information Routes
 * Indian Railways WRS Raipur
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';
import { getDatabase } from '../db/connection.ts';
import { config } from '../config/index.ts';
import { lastRun } from '../backup/scheduler.ts';
import { mirrorState } from '../middleware/readOnlyMirror.ts';
import { photoStore } from '../db/photoStore.ts';
import { verifyPassword } from '../auth/password.ts';
import { verifyAuditChain } from '../db/auditLog.ts';
import { isZapheitConfigured, askZapheit } from '../ai/zapheit.ts';
import { EXPECTED_MANUAL_SOURCES, indexedSources } from '../manual/manualIndex.ts';

/** One line per server start, beside the database. Written by index.ts, read by the readiness panel. */
export const STARTS_LOG = 'starts.log';

/** The password published in the README. Login refuses it in production. */
const DEMO_PASSWORD = 'password123';

export const healthRouter = Router();

healthRouter.get('/health', (req: Request, res: Response): void => {
  let dbHealthy = true;
  let totalRecords = 0;

  try {
    const db = getDatabase();
    const row = db.prepare('SELECT COUNT(*) as count FROM inspections').get() as { count: number };
    totalRecords = row?.count ?? 0;
  } catch {
    dbHealthy = false;
  }

  const memory = process.memoryUsage();

  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      connected: dbHealthy,
      mode: 'WAL',
      totalRecords
    },
    memory: {
      rssMb: Math.round((memory.rss / (1024 * 1024)) * 10) / 10,
      heapUsedMb: Math.round((memory.heapUsed / (1024 * 1024)) * 10) / 10
    },
    // A mirror says so, and when its copy was taken, so the DRM's screen can too.
    mirror: mirrorState()
  });
});

healthRouter.get('/version', (req: Request, res: Response): void => {
  res.status(200).json({
    appName: 'WRS Raipur Spring Classification & Inspection System',
    phase: 'Phase 1 - Bogie Spring Overhaul Bay',
    version: '1.0.0',
    rdsoSpecification: 'RDSO Technical Pamphlet G-95 Revision-II (Tables 28-33)',
    buildTime: '2026-08-14T07:00:00.000Z'
  });
});


// ---------------------------------------------------------------------------
// GET /api/system/storage
//
// Whether this deployment is being backed up, and how large it has become.
//
// The database holds every inspection, every certificate and the whole
// hash-chained audit log, and backup-db.sh exists to protect it — but nothing
// schedules that script and nothing reported whether it had ever run. A
// backup job that stops running is silent by nature: it produces no error,
// only an absence, and nobody notices an absence until they need the file.
//
// So this reads the backup directory and says plainly how old the newest one
// is. It does not take backups and does not pretend to; scheduling belongs to
// the host. What it removes is the silence.
//
// Size is reported for the same reason. Evidence photographs live as base64
// in this file, and a workshop that suddenly starts photographing everything
// should be able to see the consequence before the volume becomes a problem
// rather than after.
//
// system.configure — the administrator. Not the DRM: this is the state of the
// installation, not of the workshop's work.
// ---------------------------------------------------------------------------
healthRouter.get(
  '/system/storage',
  authMiddleware,
  requireCapability('system.configure'),
  (_req: AuthenticatedRequest, res: Response): void => {
    const dbPath = config.dbPath;
    const backupDir = config.backupDir;

    const sizeOf = (f: string): number => {
      try { return fs.statSync(f).size; } catch { return 0; }
    };

    /*
     * WAL and the shared-memory file count toward what is on disk. Reporting
     * only the main file understates a busy database, sometimes by a lot.
     */
    const databaseBytes = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`) + sizeOf(`${dbPath}-shm`);

    let backups: Array<{ name: string; bytes: number; at: string }> = [];
    try {
      backups = fs.readdirSync(backupDir)
        .filter((n) => n.endsWith('.db.enc'))
        .map((n) => {
          const full = path.join(backupDir, n);
          const st = fs.statSync(full);
          return { name: n, bytes: st.size, at: st.mtime.toISOString() };
        })
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    } catch {
      // No directory means no backup has ever been taken here, which is a
      // finding rather than an error.
      backups = [];
    }

    const newest = backups[0] || null;
    const ageHours = newest
      ? Math.round(((Date.now() - Date.parse(newest.at)) / 3_600_000) * 10) / 10
      : null;

    const db = getDatabase();
    const count = (sql: string): number => {
      try { return (db.prepare(sql).get() as any)?.c ?? 0; } catch { return 0; }
    };

    res.status(200).json({
      success: true,
      data: {
        databaseBytes,
        photoCount: count('SELECT COUNT(*) AS c FROM wagon_photos'),
        photoBytes: count('SELECT COALESCE(SUM(file_size), 0) AS c FROM wagon_photos'),
        inspectionCount: count('SELECT COUNT(*) AS c FROM inspections'),
        auditEventCount: count('SELECT COUNT(*) AS c FROM inspection_audit_log'),
        backup: {
          directory: backupDir,
          count: backups.length,
          newestAt: newest?.at ?? null,
          newestBytes: newest?.bytes ?? null,
          ageHours,
          /*
           * Stated rather than left to the reader to work out. "Never" and
           * "eleven days ago" are both failures and should read as failures;
           * an administrator glancing at a screen should not have to subtract
           * dates to find that out.
           */
          state: !newest ? 'NEVER' : (ageHours as number) <= 48 ? 'RECENT' : 'STALE'
        }
      },
      meta: { timestamp: new Date().toISOString() }
    });
  }
);

// ---------------------------------------------------------------------------
// GET /api/system/readiness — is this installation actually ready to be used
//
// WHY THIS EXISTS
// ---------------
// Everything below was already knowable and none of it was anywhere on a
// screen. Whether the JWT secret is still the one published in this source,
// whether CORS is still open to any website, whether an account is still on
// the demonstration password, whether a backup has ever run: all answerable in
// a line of code each, and all discovered by asking somebody rather than by
// looking.
//
// Every item here is MEASURED, never declared. A tick means this server just
// checked and found it true — the Zapheit row is a live call, not the presence
// of a key; the audit row recomputes the chain; the password row hashes real
// passwords. A readiness panel that reported its own configuration back to
// itself would tick green on a deployment with none of this done, which is the
// deployment that most needs to be told.
//
// system.configure — the administrator's, like the storage panel. This is the
// state of the installation, not of the workshop's work.
// ---------------------------------------------------------------------------

type ReadinessState = 'PASS' | 'WARN' | 'FAIL';

interface ReadinessCheck {
  id: string;
  label: string;
  state: ReadinessState;
  detail: string;
}

/*
 * How many accounts the demonstration-password check will hash before it
 * stops.
 *
 * Each verification is a deliberate ~50 ms of PBKDF2 — that slowness is the
 * point of the hash — and this server is one process. Left unbounded on a
 * shop with fifty accounts it would block every other request for two and a
 * half seconds. It yields between accounts so nothing stalls, and stops at
 * this many, reporting how many it actually reached rather than implying it
 * checked them all.
 */
const MAX_PASSWORD_CHECKS = 40;

healthRouter.get(
  '/system/readiness',
  authMiddleware,
  requireCapability('system.configure'),
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const checks: ReadinessCheck[] = [];
    const isProd = process.env.NODE_ENV === 'production';

    // --- the three that decide whether this is a deployment or a laptop ---
    checks.push({
      id: 'node-env',
      label: 'Running in production mode',
      state: isProd ? 'PASS' : 'WARN',
      detail: isProd
        ? 'NODE_ENV=production. The demonstration accounts are refused and the startup guards are active.'
        : `NODE_ENV is "${process.env.NODE_ENV || 'development'}". Safe for a laptop; on the workshop PC set it to production so the credential guards switch on.`
    });

    const secretIsDefault = !process.env.JWT_SECRET;
    checks.push({
      id: 'jwt-secret',
      label: 'Signing secret is this installation’s own',
      state: secretIsDefault ? 'FAIL' : 'PASS',
      detail: secretIsDefault
        ? 'JWT_SECRET is unset, so the built-in development secret is in use. It is published in this source code, and anyone holding it can forge a token for any user including an administrator. It also signs release certificates.'
        : 'JWT_SECRET is set from the environment. Keep a copy somewhere other than this machine: changing it invalidates every certificate signed with it.'
    });

    const corsOpen = !process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*';
    checks.push({
      id: 'cors-origin',
      label: 'API answers only the workshop’s own address',
      state: corsOpen ? (isProd ? 'FAIL' : 'WARN') : 'PASS',
      detail: corsOpen
        ? 'CORS_ORIGIN is open to any origin, so any website a signed-in person visits can call this API with their browser. Set it to the exact address the tablets load the app from.'
        : `Pinned to ${process.env.CORS_ORIGIN}.`
    });

    // --- credentials: the check that needed the password routes to exist ---
    const accounts = db.prepare(
      'SELECT username, password_hash FROM users WHERE is_active = 1 AND username != ?'
    ).all('system') as Array<{ username: string; password_hash: string }>;

    const onDemoPassword: string[] = [];
    let checkedAccounts = 0;
    for (const a of accounts.slice(0, MAX_PASSWORD_CHECKS)) {
      // Yield first, so a slow scan never holds the event loop against the
      // shop floor. The bench matters more than this panel does.
      await new Promise((r) => setImmediate(r));
      checkedAccounts += 1;
      if (verifyPassword(DEMO_PASSWORD, a.password_hash)) onDemoPassword.push(a.username);
    }
    const unchecked = Math.max(0, accounts.length - checkedAccounts);

    /*
     * The same switch the login route reads. With SEED_DEMO_USERS=true on a
     * production build (DEMO-DATA.cmd sets it for a demonstration) the demo
     * password DOES sign in, and this row used to say the opposite on the
     * very PC where a room full of people had just watched it work. The
     * state stays FAIL — the switch and the accounts must come out before
     * real use — but the detail says what is actually true.
     */
    const demoSwitchOn = process.env.SEED_DEMO_USERS === 'true';
    checks.push({
      id: 'demo-passwords',
      label: 'No account is still on the demonstration password',
      state: onDemoPassword.length ? (isProd ? 'FAIL' : 'WARN') : 'PASS',
      detail: onDemoPassword.length
        ? `${onDemoPassword.length} account(s) still use it: ${onDemoPassword.slice(0, 6).join(', ')}` +
          `${onDemoPassword.length > 6 ? '…' : ''}. ` +
          (demoSwitchOn
            ? 'SEED_DEMO_USERS=true is set in .env, so they can sign in — this is the demonstration record. Before real use, delete that line from .env and deactivate these accounts from the User Accounts screen.'
            : (isProd
              ? 'Production logins refuse this password, so these accounts cannot sign in there. Set a password for each from the User Accounts screen.'
              : 'Set a password for each from the User Accounts screen before this goes to the shop.')) +
          (unchecked ? ` ${unchecked} further account(s) were not checked.` : '')
        : `Checked ${checkedAccounts} active account(s).` +
          (unchecked ? ` ${unchecked} further account(s) were not checked.` : '')
    });

    /*
     * How big this has grown, and what that costs the backup.
     *
     * Photographs used to be stored as base64 inside the database file, so
     * the evidence a shop is asked to collect was also the thing that made
     * the weekly backup impossible. New photographs are files beside the
     * database now (server/src/db/photoStore.ts), so two figures are
     * reported: the database, whose size decides whether the weekly backup
     * is still feasible; and the photo directory, which the backup script
     * carries file by file and only ever grows by what was added since.
     *
     * The thresholds come from a measurement rather than a guess. Backing up
     * a 514 MB database — snapshot, encrypt, verify — ran at 11.1 MB/s on a
     * developer machine, and the shop PC is three to five times slower. That
     * puts 5 GB at roughly half an hour there, 20 GB at two hours, 80 GB at
     * eight. A weekly job that takes eight hours is a job somebody kills.
     *
     * The restore needs room for the encrypted file and the plaintext beside
     * the original, so the disk wants roughly three times the database free.
     */
    const dbBytes = (() => {
      let total = 0;
      for (const suffix of ['', '-wal', '-shm']) {
        try { total += fs.statSync(config.dbPath + suffix).size; } catch { /* absent is zero */ }
      }
      return total;
    })();
    // Photographs written before they became files, still inside the database.
    const inlinePhotoBytes = (() => {
      try {
        const a = db.prepare("SELECT COALESCE(SUM(LENGTH(image_data)), 0) AS b FROM wagon_photos WHERE image_data NOT LIKE 'file:%'").get() as { b: number };
        const c = db.prepare("SELECT COALESCE(SUM(LENGTH(image_data)), 0) AS b FROM spring_images WHERE image_data NOT LIKE 'file:%'").get() as { b: number };
        return Number(a?.b || 0) + Number(c?.b || 0);
      } catch { return 0; }
    })();
    const onDisk = photoStore().sizeOnDisk();
    const gb = dbBytes / (1024 ** 3);
    const BACKUP_MB_PER_SEC = 11.1;
    const shopMinutes = Math.round(((dbBytes / (1024 * 1024)) / BACKUP_MB_PER_SEC) * 4 / 60);
    const inlineShare = dbBytes > 0 ? Math.round((inlinePhotoBytes / dbBytes) * 100) : 0;
    const fmt = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / (1024 * 1024))} MB`);
    const sizeText = fmt(dbBytes);
    const photosText = `${onDisk.files} photograph file(s), ${fmt(onDisk.bytes)}, under ${config.photoDir}`;

    checks.push({
      id: 'storage',
      label: 'The database is small enough to keep backing up',
      state: gb >= 8 ? 'FAIL' : gb >= 2 ? 'WARN' : 'PASS',
      detail: gb >= 2
        ? `${sizeText}` + (inlineShare > 0 ? `, of which ${inlineShare}% is photographs written before they became files` : '') +
          `. A backup of this runs about ${shopMinutes} minute(s) on shop hardware, ` +
          'and the disk needs roughly three times the database free to take and restore one. ' +
          `Photographs taken now are files, not rows: ${photosText}. They do not add to this figure.`
        : `${sizeText}. A backup of this takes about ${Math.max(shopMinutes, 1)} minute(s) on shop hardware. ` +
          `Photographs are files beside it — ${photosText} — carried by the same backup, file by file.`
    });

    // --- the record, and whether a copy of it exists ---
    const backupDir = config.backupDir;
    let newestBackupMs: number | null = null;
    let backupCount = 0;
    try {
      for (const f of fs.readdirSync(backupDir)) {
        if (!f.endsWith('.enc')) continue;
        backupCount += 1;
        const m = fs.statSync(path.join(backupDir, f)).mtimeMs;
        if (newestBackupMs === null || m > newestBackupMs) newestBackupMs = m;
      }
    } catch { /* no directory yet is the same as no backup */ }

    /*
     * A backup on the same disk as the database is not a backup.
     *
     * The default destination is server/data/backups — beside the file it is
     * protecting. Format the machine, lose the disk, or meet ransomware, and
     * the database and every copy of it go together. Nothing said so, and the
     * panel showed a healthy green row for exactly that arrangement.
     *
     * Compared by filesystem device rather than by path text, so a mapped
     * network drive on Windows or a mounted USB disk reads as separate even
     * though the path may look similar.
     */
    let backupOnSameDisk = false;
    try {
      const dbDev = fs.statSync(config.dbPath).dev;
      const dirDev = fs.statSync(backupDir).dev;
      backupOnSameDisk = dbDev === dirDev;
    } catch { /* no backup directory yet — the row below already says that */ }

    const backupAgeHours = newestBackupMs === null ? null : (Date.now() - newestBackupMs) / 3_600_000;
    // What the server's own nightly backup last said, and where its key is.
    const serverRun = lastRun(backupDir);
    const keyBeside = serverRun?.keyBesideDatabase === true;
    checks.push({
      id: 'backup',
      label: 'A recent encrypted backup exists',
      state: backupAgeHours === null ? 'FAIL' : backupOnSameDisk ? 'WARN' : backupAgeHours <= 24 * 8 ? 'PASS' : 'WARN',
      detail: backupAgeHours === null
        ? 'No backup has ever been taken. The server takes one itself every night at ' +
          `${process.env.WRS_BACKUP_HOUR || '02'}:00, and within minutes of starting when none is a day old` +
          (serverRun && !serverRun.ok ? ` — the last attempt FAILED: ${String(serverRun.output).split('\n').slice(-2).join(' ')}` : '') +
          `. Point it at a different disk from the database (WRS_BACKUP_DIR is currently ${backupDir}).`
        : backupOnSameDisk
          ? `${backupCount} backup(s) retained, newest ${Math.floor(backupAgeHours)} hour(s) ago — but they are on the same disk as the database. ` +
            'If this machine is formatted or its disk fails, the records and every copy of them go together. ' +
            'Point the backup at another drive, a network share, or a USB disk kept elsewhere — ' +
            `set WRS_BACKUP_DIR in .env (currently ${backupDir}) and in the scheduled task.`
          : `${backupCount} backup(s) retained on a separate disk, newest ${Math.floor(backupAgeHours)} hour(s) ago.` +
            (serverRun?.scheduledByServer ? ' Taken by the server itself; the next is tonight.' : '') +
            (keyBeside ? ` The backup key was generated beside the database (${serverRun?.keyFile}); copy it to the office and set WRS_BACKUP_KEY_FILE — a key only on this PC is lost with it.` : '')
    });

    /*
     * The off-site copy. A backup on a USB disk in another room protects
     * against a dead PC; it does not protect against the room. When the
     * cloud settings are present, backup-db.mjs pushes each encrypted file to
     * an S3-compatible bucket and verifies it by ETag, recording the result in
     * cloud-manifest.json beside the backups. This row reads that manifest —
     * a cloud copy that has been failing for a week is a row here, not a
     * surprise on the day the disk dies. Not configured is a WARN, not a
     * FAIL: a shop with no internet has the USB disk, and the row says so.
     */
    const cloud = (() => {
      const configured = Boolean(process.env.WRS_CLOUD_ENDPOINT && process.env.WRS_CLOUD_BUCKET && process.env.WRS_CLOUD_ACCESS_KEY && process.env.WRS_CLOUD_SECRET_KEY);
      let manifest: any = null;
      try { manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'cloud-manifest.json'), 'utf8')); } catch { manifest = null; }
      return { configured, manifest };
    })();
    const cloudNewestInCloud = Boolean(cloud.manifest?.newestBackup?.inCloud);
    const cloudLastRunHours = cloud.manifest?.lastRunAt ? (Date.now() - new Date(cloud.manifest.lastRunAt).getTime()) / 3_600_000 : null;
    const cloudFailures = Array.isArray(cloud.manifest?.failures) ? cloud.manifest.failures.length : 0;
    checks.push({
      id: 'cloud_backup',
      label: 'The newest backup is also off-site (cloud)',
      state: !cloud.configured
        ? 'WARN'
        : cloudNewestInCloud && cloudFailures === 0 && cloudLastRunHours !== null && cloudLastRunHours <= 24 * 8 ? 'PASS' : 'WARN',
      detail: !cloud.configured
        ? 'No cloud copy is configured. Set WRS_CLOUD_ENDPOINT, WRS_CLOUD_BUCKET, WRS_CLOUD_ACCESS_KEY and WRS_CLOUD_SECRET_KEY in .env ' +
          '(any S3-compatible storage — AWS Mumbai, an Indian provider, or a MinIO the railway runs) and the next scheduled backup pushes its ' +
          'encrypted files there and verifies them. Until then the USB disk in another room is the only off-site copy.'
        : !cloud.manifest
          ? 'Cloud settings are present but no backup has run since they were set. Run the scheduled backup, or: node server/scripts/backup-db.mjs --cloud'
          : `${Object.keys(cloud.manifest.uploads || {}).length} file(s) verified in ${cloud.manifest.bucket} at ${String(cloud.manifest.endpoint).replace(/^https?:\/\//, '')}; ` +
            (cloudNewestInCloud ? `the newest backup (${cloud.manifest.newestBackup.file}) is there. ` : `the newest backup is NOT there yet. `) +
            `Last run ${cloudLastRunHours === null ? 'unknown' : Math.floor(cloudLastRunHours) + ' hour(s) ago'}` +
            (cloudFailures ? `; ${cloudFailures} upload(s) failed — see cloud-manifest.json beside the backups.` : '.') +
            ' The files are encrypted before they leave; the key never does.'
    });

    /*
     * How often the server has come up lately — which is how often it went
     * down. index.ts appends a line per start; START.cmd restarts it within
     * five seconds of an exit, so a crash that recurs is invisible from a
     * tablet and visible only here. One start in a day is a boot. Two or
     * three is a config change, or a power cut. More is a fault somebody
     * needs to read the log for.
     */
    const starts24h = (() => {
      try {
        const cutoff = Date.now() - 24 * 3_600_000;
        return fs.readFileSync(path.join(path.dirname(config.dbPath), STARTS_LOG), 'utf8')
          .split('\n')
          .filter((line) => {
            const t = Date.parse(line.slice(0, 24));
            return Number.isFinite(t) && t >= cutoff;
          }).length;
      } catch { return null; }
    })();
    checks.push({
      id: 'restarts',
      label: 'The server has not been restarting',
      state: starts24h === null ? 'WARN' : starts24h <= 3 ? 'PASS' : 'WARN',
      detail: starts24h === null
        ? `No record of starts beside the database (${STARTS_LOG}). The server may not be able to write there.`
        : starts24h <= 1
          ? 'Started once in the last 24 hours.'
          : starts24h <= 3
            ? `Started ${starts24h} times in the last 24 hours — a reboot or a settings change, most likely.`
            : `Started ${starts24h} times in the last 24 hours. Something is stopping it and START.cmd is bringing it back. ` +
              'Read logs\\wrs-<date>.log beside START.cmd for the reason each time it stopped; the tablets will not have noticed.'
    });

    const chain = verifyAuditChain(db);
    checks.push({
      id: 'audit-chain',
      label: 'The audit chain verifies',
      state: chain.verified ? 'PASS' : 'FAIL',
      detail: chain.verified
        ? `${chain.entriesChecked} entries, hashes intact. This says no record was altered after it was written — not that every reading was correct.`
        : 'The chain does not verify. Open Audit Chain for where it breaks.'
    });

    // --- the instruments ---
    const gaugeRows = db.prepare(
      'SELECT gauge_code, applies_to, valid_upto FROM gauges WHERE is_active = 1'
    ).all() as Array<{ gauge_code: string; applies_to: string | null; valid_upto: string | null }>;

    const today = new Date().toISOString().slice(0, 10);
    const inCalibration = gaugeRows.filter((g) => g.valid_upto && g.valid_upto >= today);
    /*
     * Scope rather than count. WMM 2.0 Chapter 6 gives a separate strip per
     * spring position — outer 260, inner 262, snubber 294 mm nominal — so one
     * gauge cannot serve the bench however well calibrated it is.
     */
    const scopes = new Set(
      inCalibration.map((g) => (g.applies_to || '').toUpperCase()).filter(Boolean)
    );
    const covered = scopes.has('ALL')
      ? ['OUTER', 'INNER', 'SNUBBER']
      : ['OUTER', 'INNER', 'SNUBBER'].filter((p) => scopes.has(p));
    const missing = ['OUTER', 'INNER', 'SNUBBER'].filter((p) => !covered.includes(p));

    checks.push({
      id: 'gauges',
      label: 'A calibrated gauge for every spring position',
      state: gaugeRows.length === 0 ? 'FAIL' : missing.length ? 'WARN' : 'PASS',
      /*
       * The register can only be filled by the shop, and the manual says why.
       *
       * WMM p.191: "Spring height gauges must be kept in spring section", and
       * on banding, "As of now, only local colour coding is in practice in
       * zonal Railways." There is no national catalogue of gauge codes to look
       * up — the instruments and their markings are local to each workshop.
       * So this row names what is missing and points at the screen that fixes
       * it, rather than implying somebody could find the answer elsewhere.
       */
      detail: gaugeRows.length === 0
        ? 'No gauges in the register, so no reading can name the instrument it was taken with. ' +
          'Add them under User Accounts → Gauge Register, from the instruments actually on the bench.'
        : missing.length
          ? `${inCalibration.length} of ${gaugeRows.length} gauge(s) in calibration. Nothing covers: ${missing.join(', ').toLowerCase()}. ` +
            'Each spring position has its own strip, so one gauge cannot stand in for another. ' +
            'WMM p.191 keeps spring height gauges in the spring section and notes that colour coding is local practice, ' +
            'so these codes come from this shop rather than from a national list.'
          : `${inCalibration.length} gauge(s) in calibration, covering outer, inner and snubber.`
    });

    // --- the manual, which is the citation behind every refusal ---
    /*
     * Per document, not just a total.
     *
     * A count on its own cannot tell a healthy index from one missing a
     * document — and the index now holds more than one. A deployment with the
     * manual but without the audit check-sheet reported thousands of passages
     * and looked entirely well.
     */
    const present = indexedSources(db);
    const manualPassages = Object.values(present).reduce((n, c) => n + c, 0);
    const notIndexed = EXPECTED_MANUAL_SOURCES.filter((src) => !present[src.label]);
    const notIndexedRequired = notIndexed.filter((src) => src.required);

    const held = EXPECTED_MANUAL_SOURCES
      .filter((src) => present[src.label])
      .map((src) => `${src.label} ${present[src.label]}`)
      .join(', ');

    checks.push({
      id: 'manual',
      label: 'The manual is indexed and searchable',
      state: notIndexedRequired.length ? 'WARN' : notIndexed.length ? 'WARN' : 'PASS',
      detail: notIndexedRequired.length
        ? 'The Wagon Maintenance Manual is not indexed, so nothing can cite a clause. ' +
          'Run: npm run index-manual -- "/path/to/Vol-I (System Documentation).pdf"'
        : notIndexed.length
          ? `${manualPassages} passages indexed (${held}). Not indexed: ` +
            notIndexed
              .map((src) => `${src.name}${src.file ? ` — npm run index-manual -- "${src.file}" ${src.label}` : ''}`)
              .join('; ')
          : `${manualPassages} passages indexed (${held}). Every quote names the document it came from.`
    });

    /*
     * Zapheit is asked, not assumed.
     *
     * A key in the environment proves somebody pasted a key. Whether the model
     * answers from this machine is a different question, and it is the one
     * that matters on a shop LAN that may have no route out at all. This is
     * also the only row here that is allowed to be absent without fault: every
     * feature it touches falls back to what works today.
     */
    let zapheitState: ReadinessState = 'WARN';
    let zapheitDetail = 'No ZAPHEIT_API_KEY set. Ask the Manual, voice entry and summaries all work without it — search stays keyword-based and voice uses the built-in parser.';
    if (isZapheitConfigured()) {
      const reply = await askZapheit('Reply with the single word: ready.', 'Are you reachable?', { maxTokens: 5 });
      if (reply) {
        zapheitState = 'PASS';
        zapheitDetail = `Answered from this machine using ${config.zapheitModel}.`;
      } else {
        zapheitState = 'WARN';
        zapheitDetail = `A key is set but ${config.zapheitBaseUrl} did not answer — no route out of this LAN, a wrong base URL or model name, or the key is not accepted. Everything falls back to working without it.`;
      }
    }
    checks.push({ id: 'zapheit', label: 'Zapheit answers from this machine', state: zapheitState, detail: zapheitDetail });

    const failed = checks.filter((c) => c.state === 'FAIL').length;
    const warned = checks.filter((c) => c.state === 'WARN').length;

    res.status(200).json({
      success: true,
      data: {
        ready: failed === 0 && warned === 0,
        environment: process.env.NODE_ENV || 'development',
        passed: checks.length - failed - warned,
        warned,
        failed,
        checks
      },
      meta: { timestamp: new Date().toISOString() }
    });
  }
);
