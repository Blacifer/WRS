/**
 * Health and System Information Routes
 * Indian Railways WRS Raipur
 */

import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';

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
