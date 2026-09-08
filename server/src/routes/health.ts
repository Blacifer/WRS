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
import { verifyPassword } from '../auth/password.ts';
import { verifyAuditChain } from '../db/auditLog.ts';
import { isZapheitConfigured, askZapheit } from '../ai/zapheit.ts';
import { EXPECTED_MANUAL_SOURCES, indexedSources } from '../manual/manualIndex.ts';

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
    }
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
    const backupDir = path.resolve(path.dirname(dbPath), 'backups');

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

    checks.push({
      id: 'demo-passwords',
      label: 'No account is still on the demonstration password',
      state: onDemoPassword.length ? (isProd ? 'FAIL' : 'WARN') : 'PASS',
      detail: onDemoPassword.length
        ? `${onDemoPassword.length} account(s) still use it: ${onDemoPassword.slice(0, 6).join(', ')}` +
          `${onDemoPassword.length > 6 ? '…' : ''}. Production logins refuse this password, so these accounts cannot sign in there. ` +
          'Set a password for each from the User Accounts screen.' +
          (unchecked ? ` ${unchecked} further account(s) were not checked.` : '')
        : `Checked ${checkedAccounts} active account(s).` +
          (unchecked ? ` ${unchecked} further account(s) were not checked.` : '')
    });

    // --- the record, and whether a copy of it exists ---
    const backupDir = path.resolve(path.dirname(config.dbPath), 'backups');
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

    const backupAgeHours = newestBackupMs === null ? null : (Date.now() - newestBackupMs) / 3_600_000;
    checks.push({
      id: 'backup',
      label: 'A recent encrypted backup exists',
      state: backupAgeHours === null ? 'FAIL' : backupAgeHours <= 24 * 8 ? 'PASS' : 'WARN',
      detail: backupAgeHours === null
        ? 'No backup has ever been taken. server/scripts/backup-db.sh encrypts and verifies one; nothing schedules it. A weekly cron line on this host is enough, and scripts/backup-drill.sh proves the whole round trip — backup, restore, and refusal of a tampered file — before you need it.'
        : `${backupCount} backup(s) retained, newest ${Math.floor(backupAgeHours)} hour(s) ago.`
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
