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
import { getObservedCondemnationRates } from '../db/wagonAnalytics.ts';
import { verifyAuditChain } from '../db/auditLog.ts';
import { GaugeRepository } from '../db/gaugeRepository.ts';
import { InspectionRepository } from '../db/repository.ts';
import { forecastConsumption } from '../../../shared/knowledge/consumptionForecast.ts';

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
    /*
     * A sectioned audit export rather than a wagon list.
     *
     * The previous version was eight columns of wagon metadata — which stage
     * each is at and how long it has been there. That is a status report. An
     * audit asks different questions: who did this, on what instrument, was
     * anything condemned and why, and can the record be shown not to have
     * been altered since. None of that was in the file, and all of it was
     * already in the database.
     *
     * Sections are separated by a blank line and a header row, which is how
     * an audit extract is normally shaped and which Excel opens without
     * complaint. Section 1 is deliberately first: a reviewer should meet the
     * integrity statement before the data it applies to.
     */
    const db = getDatabase();
    const wagons = repo.queryWagons({ limit: 500 }).records;
    const chain = verifyAuditChain(db);
    const gauges = new GaugeRepository(db);
    const exposure = gauges.readingsOnUnverifiedGauges();
    const inspections = new InspectionRepository(db).queryInspections({ limit: 500 }).records;

    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const out: string[] = [];

    out.push('SECTION 1 — REPORT AND RECORD INTEGRITY');
    out.push('Field,Value');
    out.push(`${q('Generated at')},${q(new Date().toISOString())}`);
    out.push(`${q('Generated by')},${q((req as any).user?.username || 'unknown')}`);
    out.push(`${q('Audit chain verified')},${q(chain.verified ? 'YES' : 'NO')}`);
    out.push(`${q('Audit entries checked')},${q(chain.entriesChecked)}`);
    out.push(`${q('Entries failing verification')},${q(chain.breaksFound)}`);
    out.push(`${q('What a pass proves')},${q('No entry was altered after it was written. It does not prove every measurement was correct.')}`);
    out.push(`${q('Readings on a gauge with no calibration date')},${q(exposure.unrecorded)}`);
    out.push(`${q('Readings on a lapsed gauge')},${q(exposure.expired)}`);
    out.push(`${q('Readings with no gauge named')},${q(exposure.noGauge)}`);

    out.push('');
    out.push('SECTION 2 — WAGONS');
    out.push('Wagon Number,Type,Railway,Current Stage,Status,Entry Date,Release Date,Elapsed Hours,Registered By');
    for (const w of wagons) {
      out.push([
        q(w.wagonNumber), q(w.wagonType), q(w.owningRailway), q(w.currentStage), q(w.status),
        q(w.entryDate), q(w.actualReleaseDate || ''), w.totalElapsedHours || 0, q(w.createdBy || '')
      ].join(','));
    }

    out.push('');
    out.push('SECTION 3 — SPRING READINGS');
    out.push('Recorded At,Wagon Number,Bogie Type,Position,Condition,Measured Height (mm),Band,Status,Condemnation Reason,Inspector,Table Reference');
    for (const r of inspections as any[]) {
      out.push([
        q(r.timestamp), q(r.wagonNumber), q(r.bogieType), q(r.springPosition), q(r.condition),
        r.measuredFreeHeight ?? '', q(r.classifiedBand || ''), q(r.status),
        q(r.condemnationReason || ''), q(r.inspectorName || r.inspectorId), q(r.tableReference || '')
      ].join(','));
    }

    out.push('');
    out.push('SECTION 4 — WHO DID WHAT');
    out.push('When,Event,Actor,Role,Employee ID,From Address,Wagon / Inspection');
    const activity = db.prepare(`
      SELECT a.event_type, a.user_role, a.ip_address, a.created_at, a.inspection_id,
             u.full_name AS actor_name, u.employee_id AS actor_employee_id
      FROM inspection_audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC, a.rowid DESC
      LIMIT 500
    `).all() as any[];
    for (const a of activity) {
      out.push([
        q(a.created_at), q(a.event_type), q(a.actor_name || ''), q(a.user_role || ''),
        q(a.actor_employee_id || ''), q(a.ip_address || ''), q(a.inspection_id || '')
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="WRS_Raipur_QC_Audit_Export.csv"');
    res.status(200).send(out.join('\n'));
  } else {
    // Executive Summary HTML / PDF format
    const pipeline = repo.getAnalyticsPipeline();
    const tat = repo.getAnalyticsTAT();
    const parts = repo.getAnalyticsParts();
    /*
     * The three things that decide whether the rest of this report is worth
     * anything: is the record provably unaltered, were the readings taken on
     * instruments with a calibration record, and what is currently stopping a
     * wagon leaving. A quality report without them is a status update.
     */
    const dbForReport = getDatabase();
    const chainForReport = verifyAuditChain(dbForReport);
    const exposureForReport = new GaugeRepository(dbForReport).readingsOnUnverifiedGauges();
    const blockersForReport = repo.getAnalyticsBlockers();

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
    .note { font-size: 11px; color: #64748b; margin-top: 6px; }
    .ok { color: #166534; font-size: 13px; }
    .bad { color: #991b1b; font-size: 13px; font-weight: bold; }
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
  <h2>1. Record integrity</h2>
  <p class="${chainForReport.verified ? 'ok' : 'bad'}">
    <strong>${chainForReport.verified ? 'Audit chain verified' : 'AUDIT CHAIN BROKEN'}</strong>
    — ${chainForReport.entriesChecked} entries checked, ${chainForReport.breaksFound} failing verification.
  </p>
  <p class="note">
    A pass proves no entry was altered after it was written. It does not prove every
    measurement was correct — that is what the shadow-mode cross-check against the
    paper register is for.
  </p>
  <table>
    <thead><tr><th>Measurements on instruments without an established calibration</th><th>Readings</th></tr></thead>
    <tbody>
      <tr><td>Gauge carrying no calibration date</td><td><strong>${exposureForReport.unrecorded}</strong></td></tr>
      <tr><td>Gauge whose calibration had lapsed</td><td><strong>${exposureForReport.expired}</strong></td></tr>
      <tr><td>No gauge named at all</td><td><strong>${exposureForReport.noGauge}</strong></td></tr>
    </tbody>
  </table>
  <p class="note">
    A reading is only worth its gauge's calibration record. Recording a calibration
    now does not change readings already taken — they keep the state they had.
  </p>

  <h2>2. 7-Stage Pipeline Load</h2>
  <table>
    <thead><tr><th>Stage</th><th>Active Wagons Count</th></tr></thead>
    <tbody>
      ${Object.entries(pipeline.counts).map(([stg, count]) => `<tr><td>${stg}</td><td><strong>${count}</strong></td></tr>`).join('')}
    </tbody>
  </table>

  <h2>3. What is stopping a wagon leaving</h2>
  ${(() => {
    // getAnalyticsBlockers returns { blockedWagons: [...] }. Checked against
    // the live endpoint rather than guessed — the first version of this
    // section rendered an empty table because it looked for `.wagons`.
    const rows = Array.isArray(blockersForReport)
      ? blockersForReport
      : (blockersForReport?.blockedWagons || []);
    if (!rows.length) return '<p class="ok">Nothing is blocked.</p>';
    return `<table>
      <thead><tr><th>Wagon</th><th>Stage</th><th>Reasons it cannot be released</th></tr></thead>
      <tbody>
        ${rows.map((b: any) => `<tr>
          <td>${b.wagonNumber || ''}</td>
          <td>${b.currentStage || ''}</td>
          <td>${(b.blockers || []).length}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <p class="note">Each reason is named in full in the CSV export and on the Gate &amp; Release screen.</p>`;
  })()}

  <h2>4. Who did what</h2>
  <table>
    <thead><tr><th>When</th><th>Event</th><th>Person</th><th>Role</th></tr></thead>
    <tbody>
      ${(dbForReport.prepare(`
        SELECT a.event_type, a.user_role, a.created_at, u.full_name AS actor_name
        FROM inspection_audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC, a.rowid DESC
        LIMIT 40
      `).all() as any[]).map((a) => `<tr>
        <td>${a.created_at}</td><td>${a.event_type}</td>
        <td>${a.actor_name || ''}</td><td>${a.user_role || ''}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <p class="note">The last 40 actions. The full ledger is in the CSV export and on History &amp; Logs.</p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  }
});

// -------------------------------------------------------------------------
// GET /api/analytics/forecast?days=14
//
// What Stores should expect to issue over the coming period.
//
// Gated on analytics.read alongside the rest of the divisional reporting: it
// is built from the same inspection record and it is a planning figure, not
// something an inspector acts on at the bench.
//
// Three inputs of different kinds — the shop's own out-turn return, RDSO's
// spring counts, and the condemnation rate observed here. Only the last is
// learned, and the endpoint reports how many observations it rests on so the
// figure can be argued with rather than merely believed.
// -------------------------------------------------------------------------
analyticsRouter.get('/forecast', authMiddleware, requireCapability('analytics.read'), async (req: Request, res: Response) => {
  try {
    const raw = Number((req.query || {}).days);
    const days = Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), 297) : 14;

    const rates = getObservedCondemnationRates(getDatabase(), (req.query || {}).since);
    const forecast = forecastConsumption(days, rates);

    res.status(200).json({
      success: true,
      data: forecast,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'FORECAST_FAILED',
      message: error?.message || 'Could not produce a consumption forecast',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});
