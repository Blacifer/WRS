/**
 * DRM Officer Analytics & Executive Reporting API Router
 * Indian Railways WRS Raipur (Phase 2)
 */

import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';
import { getDatabase } from '../db/connection.ts';
import { WagonRepository } from '../db/wagonRepository.ts';

export const analyticsRouter = Router();

function getRepo() {
  const db = getDatabase();
  return new WagonRepository(db);
}

/*
 * These endpoints were all optionalAuthMiddleware, which accepts a token if
 * one is offered and proceeds happily when none is. On a workshop LAN that
 * looked harmless. It means anyone who can reach the server — with no account
 * at all — could read /analytics/inspectors and get back named railway
 * employees with their inspection counts and how many parts each had
 * condemned. That is personnel data about identifiable people, and the moment
 * this is served over a tunnel or hosted anywhere it is simply public.
 *
 * Two different gates, because these are two different kinds of information:
 *
 *   /pipeline    how many wagons sit at each stage. The supervisor's own
 *                wagon list draws its stage counts from this, so it is gated
 *                on wagon.view — the same capability that lets someone open
 *                the pipeline screen and count the rows by hand.
 *
 *   everything   turnaround times, throughput, parts, per-inspector figures,
 *   else         blockers and the export. Divisional reading, gated on
 *                analytics.read, which is deliberately held by the DRM and an
 *                administrator and not by a supervisor.
 */

// -------------------------------------------------------------------------
// 1. 7-Stage Workshop Pipeline Metrics
// -------------------------------------------------------------------------

analyticsRouter.get('/pipeline', authMiddleware, requireCapability('wagon.view'), async (req: Request, res: Response) => {
  const repo = getRepo();
  const pipeline = repo.getAnalyticsPipeline();

  res.status(200).json({
    success: true,
    data: pipeline,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 2. Turnaround Time (TAT) Statistical Distributions & Trends
// -------------------------------------------------------------------------

analyticsRouter.get('/tat', authMiddleware, requireCapability('analytics.read'), async (req: Request, res: Response) => {
  const repo = getRepo();
  const tat = repo.getAnalyticsTAT();

  res.status(200).json({
    success: true,
    data: tat,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 3. Workshop Throughput Analytics (Daily/Weekly/Monthly)
// -------------------------------------------------------------------------

analyticsRouter.get('/throughput', authMiddleware, requireCapability('analytics.read'), async (req: Request, res: Response) => {
  const repo = getRepo();
  const throughput = repo.getAnalyticsThroughput();

  res.status(200).json({
    success: true,
    data: throughput,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 4. CASNUB Bogie Parts Health & Condemnation Statistics
// -------------------------------------------------------------------------

analyticsRouter.get('/parts', authMiddleware, requireCapability('analytics.read'), async (req: Request, res: Response) => {
  const repo = getRepo();
  const parts = repo.getAnalyticsParts();

  res.status(200).json({
    success: true,
    data: parts,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 5. Inspector Productivity & Quality Metrics
// -------------------------------------------------------------------------

analyticsRouter.get('/inspectors', authMiddleware, requireCapability('analytics.read'), async (req: Request, res: Response) => {
  const repo = getRepo();
  const inspectors = repo.getAnalyticsInspectors();

  res.status(200).json({
    success: true,
    data: inspectors,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 6. Active QC Blockers Diagnostics
// -------------------------------------------------------------------------

analyticsRouter.get('/blockers', authMiddleware, requireCapability('analytics.read'), async (req: Request, res: Response) => {
  const repo = getRepo();
  const blockers = repo.getAnalyticsBlockers();

  res.status(200).json({
    success: true,
    data: blockers,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 7. Audit Data Export (CSV & Executive PDF/HTML Report)
// -------------------------------------------------------------------------

analyticsRouter.get('/export', authMiddleware, requireCapability('analytics.read'), async (req: Request, res: Response) => {
  const repo = getRepo();
  const format = (req.query?.format || 'csv').toLowerCase();

  if (format === 'csv') {
    const wagons = repo.queryWagons({ limit: 500 }).records;
    const csvHeader = 'Wagon Number,Type,Railway,Current Stage,Status,Entry Date,Release Date,Total Elapsed Hours\n';
    const csvRows = wagons.map(w => {
      return `"${w.wagonNumber}","${w.wagonType}","${w.owningRailway}","${w.currentStage}","${w.status}","${w.entryDate}","${w.actualReleaseDate || ''}",${w.totalElapsedHours || 0}`;
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="WRS_Raipur_QC_Audit_Export.csv"');
    res.status(200).send(csvHeader + csvRows);
  } else {
    // Executive Summary HTML / PDF format
    const pipeline = repo.getAnalyticsPipeline();
    const tat = repo.getAnalyticsTAT();
    const parts = repo.getAnalyticsParts();

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>WRS Raipur - DRM Executive Monthly Quality Audit Report</title>
  <style>
    body { font-family: sans-serif; color: #0f172a; padding: 24px; }
    h1 { color: #1e3a8a; font-size: 20px; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; }
    .kpi-row { display: flex; gap: 16px; margin-bottom: 24px; }
    .kpi-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px 16px; background: #f8fafc; flex: 1; }
    .kpi-title { font-size: 11px; color: #64748b; font-weight: bold; }
    .kpi-val { font-size: 22px; font-weight: bold; color: #1e3a8a; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; }
    th { background: #f1f5f9; }
  </style>
</head>
<body>
  <h1>भारतीय रेल / INDIAN RAILWAYS — WRS Raipur DRM Quality Report</h1>
  <p><strong>Generated At:</strong> ${new Date().toISOString()}</p>
  <div class="kpi-row">
    <div class="kpi-card"><div class="kpi-title">ACTIVE WAGONS</div><div class="kpi-val">${pipeline.totalActive}</div></div>
    <div class="kpi-card"><div class="kpi-title">TOTAL RELEASED</div><div class="kpi-val">${pipeline.totalReleased}</div></div>
    <div class="kpi-card"><div class="kpi-title">MEAN TAT (HOURS)</div><div class="kpi-val">${tat.averageHours}h</div></div>
    <div class="kpi-card"><div class="kpi-title">MEDIAN TAT</div><div class="kpi-val">${tat.medianHours}h</div></div>
    <div class="kpi-card"><div class="kpi-title">TOTAL PARTS INSPECTED</div><div class="kpi-val">${parts.totalInspected}</div></div>
  </div>
  <h2>1. 7-Stage Pipeline Load</h2>
  <table>
    <thead><tr><th>Stage</th><th>Active Wagons Count</th></tr></thead>
    <tbody>
      ${Object.entries(pipeline.counts).map(([stg, count]) => `<tr><td>${stg}</td><td><strong>${count}</strong></td></tr>`).join('')}
    </tbody>
  </table>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  }
});
