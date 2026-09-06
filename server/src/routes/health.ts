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
