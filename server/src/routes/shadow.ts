/**
 * The shadow run — the app beside the register, and whether to trust it
 * Indian Railways WRS Raipur
 *
 * docs/SHADOW_MODE_ROLLOUT.md and SHADOW_MODE_FORMS.md as endpoints. The
 * supervisor designated for the week records what the app cannot know; the
 * app fills in its own half of every day from its records; the verdict is
 * arithmetic over both, and the export is the log CRIS or RDSO will be
 * shown when they ask how the system was validated.
 *
 * Reading is shadow.view (supervisor, admin, DRM). Writing is shadow.record
 * (supervisor, admin) — the DRM reads the division and signs nothing.
 */

import { Router } from '../framework/index.ts';
import type { Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';
import { ShadowRepository } from '../db/shadowRepository.ts';

export const shadowRouter = Router();
const repo = () => new ShadowRepository(getDatabase());
const now = () => new Date().toISOString();
const bad = (res: Response, message: string, status = 400, error = 'VALIDATION_ERROR') =>
  res.status(status).json({ success: false, error, message, statusCode: status, timestamp: now() });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/shadow/report?days=7&today=YYYY-MM-DD
shadowRouter.get('/report', authMiddleware, requireCapability('shadow.view'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = Math.min(Math.max(Number(req.query?.days) || 7, 1), 60);
    const today = DATE_RE.test(String(req.query?.today || '')) ? String(req.query!.today) : undefined;
    res.status(200).json({ success: true, data: repo().report(days, today), meta: { days, timestamp: now() } });
  } catch (err: any) {
    bad(res, err?.message || 'Could not build the shadow report', 500, 'SHADOW_REPORT_FAILED');
  }
});

// GET /api/shadow/discrepancies?since=YYYY-MM-DD&all=1
shadowRouter.get('/discrepancies', authMiddleware, requireCapability('shadow.view'), (req: AuthenticatedRequest, res: Response) => {
  const since = DATE_RE.test(String(req.query?.since || '')) ? String(req.query!.since) : undefined;
  const all = String(req.query?.all || '') === '1';
  res.status(200).json({ success: true, data: repo().listDiscrepancies(since, all), meta: { timestamp: now() } });
});

// POST /api/shadow/discrepancies — one line of the log
shadowRouter.post('/discrepancies', authMiddleware, requireCapability('shadow.record'), (req: AuthenticatedRequest, res: Response) => {
  const v = ShadowRepository.validateDiscrepancy(req.body || {});
  if (!v.ok) return bad(res, v.message);
  try {
    // Its own append-only table is the record; nothing to add to the chain
    // that would not be a second copy under a name that does not fit.
    const { id } = repo().recordDiscrepancy({ ...v.value, reportedBy: req.user!.id });
    res.status(201).json({ success: true, data: { id }, meta: { timestamp: now() } });
  } catch (err: any) {
    bad(res, err?.message || 'Could not record the discrepancy', 400, 'SHADOW_RECORD_FAILED');
  }
});

// GET /api/shadow/summaries?since=
shadowRouter.get('/summaries', authMiddleware, requireCapability('shadow.view'), (req: AuthenticatedRequest, res: Response) => {
  const since = DATE_RE.test(String(req.query?.since || '')) ? String(req.query!.since) : undefined;
  res.status(200).json({ success: true, data: repo().listSummaries(since), meta: { timestamp: now() } });
});

// POST /api/shadow/summaries — one shift's summary, the register's half
shadowRouter.post('/summaries', authMiddleware, requireCapability('shadow.record'), (req: AuthenticatedRequest, res: Response) => {
  const b = req.body || {};
  const s = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : NaN);
  if (!DATE_RE.test(s(b.summaryDate))) return bad(res, 'summaryDate must be YYYY-MM-DD.');
  if (!s(b.shift)) return bad(res, 'shift is required.');
  const reg = num(b.registerMinutesOneWagon);
  const app = num(b.appMinutesOneWagon);
  if (Number.isNaN(reg) || Number.isNaN(app)) return bad(res, 'minutes must be numbers of minutes, or left blank.');
  const errs = num(b.transcriptionErrorsBoxMissed);
  if (Number.isNaN(errs)) return bad(res, 'transcriptionErrorsBoxMissed must be a count.');
  try {
    const { id } = repo().recordSummary({
      summaryDate: s(b.summaryDate), shift: s(b.shift, 40), supervisorId: req.user!.id,
      registerMinutesOneWagon: reg, appMinutesOneWagon: app, transcriptionErrorsBoxMissed: errs ?? 0,
      whatAppGotWrong: s(b.whatAppGotWrong) || null, whatAppCaught: s(b.whatAppCaught) || null,
      whatSlowed: s(b.whatSlowed) || null, wouldHaveStoppedAWagon: s(b.wouldHaveStoppedAWagon) || null
    });
    res.status(201).json({ success: true, data: { id }, meta: { timestamp: now() } });
  } catch (err: any) {
    bad(res, err?.message || 'Could not record the summary', 400, 'SHADOW_RECORD_FAILED');
  }
});

// GET /api/shadow/export.csv?days=  — the completed logs, for whoever asks how the system was validated
shadowRouter.get('/export.csv', authMiddleware, requireCapability('shadow.view'), (req: AuthenticatedRequest, res: Response) => {
  const days = Math.min(Math.max(Number(req.query?.days) || 60, 1), 366);
  const r = repo().report(days);
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push('# WRS Raipur shadow run — discrepancy log');
  lines.push(['id', 'date', 'shift', 'inspector', 'wagon', 'location', 'register_says', 'app_says', 'register_verdict', 'app_verdict', 'who_was_right', 'cause', 'why', 'would_have_stopped_a_wagon', 'supersedes', 'reported_by', 'recorded_at'].join(','));
  for (const d of r.discrepancies) lines.push([d.id, d.occurredOn, d.shift, d.inspectorName, d.wagonNumber, d.location, d.registerSays, d.appSays, d.registerVerdict, d.appVerdict, d.whoWasRight, d.cause, d.why, d.wouldHaveStoppedAWagon ? 'yes' : 'no', d.supersedes, d.reportedByName ?? d.reportedBy, d.createdAt].map(cell).join(','));
  lines.push('');
  lines.push('# Daily summaries — the register\'s half, written by the supervisor');
  lines.push(['date', 'shift', 'supervisor', 'register_minutes_one_wagon', 'app_minutes_one_wagon', 'transcription_errors_box_missed', 'what_app_got_wrong', 'what_app_caught', 'what_slowed', 'would_have_stopped_a_wagon', 'recorded_at'].join(','));
  for (const s of r.summaries) lines.push([s.summaryDate, s.shift, s.supervisorName ?? s.supervisorId, s.registerMinutesOneWagon, s.appMinutesOneWagon, s.transcriptionErrorsBoxMissed, s.whatAppGotWrong, s.whatAppCaught, s.whatSlowed, s.wouldHaveStoppedAWagon, s.createdAt].map(cell).join(','));
  lines.push('');
  lines.push('# The app\'s half of each day, from its own records');
  lines.push(['date', 'wagons_swept', 'springs_recorded', 'springs_condemned', 'nests_flagged', 'discrepancies_logged', 'amber_raised', 'amber_re_measured', 'amber_stands', 'amber_unanswered', 'bench_worked_minutes', 'bench_springs_per_hour', 'bench_rate_plausible', 'checklist_verdicts', 'checklist_wagons', 'checklist_worked_minutes', 'overrides', 'withdrawn'].join(','));
  for (const d of r.days) lines.push([d.date, d.wagonsSwept, d.springsRecorded, d.springsCondemned, d.nestsFlagged, d.discrepanciesLogged, d.amber.raised, d.amber.reMeasured, d.amber.stands, d.amber.unanswered, d.bench.workedMinutes, d.bench.springsPerHour.perHour, d.bench.springsPerHour.plausible ? 'yes' : 'NO', d.checklists.verdicts, d.checklists.wagons, d.checklists.workedMinutes, d.overrides, d.withdrawn].map(cell).join(','));
  lines.push('');
  lines.push('# Verdict');
  lines.push(`app_passed_register_condemned,${r.verdict.appPassedRegisterCondemned}`);
  lines.push(`blocking,${r.verdict.blocking ? 'yes' : 'no'}`);
  for (const f of r.verdict.findings) lines.push(`finding,${cell(f)}`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="wrs-shadow-run-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.status(200).send(lines.join('\n'));
});
