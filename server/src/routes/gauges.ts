/**
 * The gauge register
 * Indian Railways WRS Raipur
 *
 * Reading the register is open to anyone signed in, because an inspector has
 * to name the gauge in their hand before they can record a reading with it.
 * Changing it — and in particular recording a calibration date — is an
 * administrator's act, since a calibration date asserts that somebody checked
 * the instrument, and that assertion is exactly what an auditor will test.
 */

import { Router } from '../framework/index.ts';
import type { Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import { GaugeRepository } from '../db/gaugeRepository.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';
import { logAuditEvent } from '../db/auditLog.ts';
import { gaugeDrift, DRIFT_THRESHOLD_MM, MIN_READINGS_EACH_SIDE } from '../../../shared/analysis/gaugeDrift.ts';

export const gaugesRouter = Router();

const repo = () => new GaugeRepository(getDatabase());

const ok = (res: Response, data: any, status = 200) =>
  res.status(status).json({ success: true, data, timestamp: new Date().toISOString() });

// ---------------------------------------------------------------------------
// GET /api/gauges
// ---------------------------------------------------------------------------
gaugesRouter.get('/', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = req.query || {};
    ok(res, {
      gauges: repo().list({
        activeOnly: q.includeInactive !== 'true',
        appliesTo: q.appliesTo ? String(q.appliesTo) : undefined
      })
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'GAUGE_LIST_FAILED',
      message: error?.message || 'The gauge register could not be read',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /api/gauges/drift
//
// A gauge that reads high, seen in the distribution it leaves behind. See
// shared/analysis/gaugeDrift.ts. Advisory: the answer is the master gauge.
// ---------------------------------------------------------------------------
gaugesRouter.get('/drift', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = Math.min(Math.max(Number(req.query?.days) || 90, 7), 366);
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const rows = getDatabase().prepare(`
      SELECT gauge_code AS gaugeCode, bogie_type || '|' || spring_condition || '|' || spring_position AS kind, measured_height AS heightMm
      FROM spring_sorting_records r
      WHERE gauge_code IS NOT NULL AND measured_height IS NOT NULL AND height_is_approximate = 0
        AND voided = 0 AND created_at >= ?
        AND NOT EXISTS (SELECT 1 FROM spring_sorting_records l WHERE l.supersedes = r.id)
    `).all(since) as any[];
    const lines = gaugeDrift(rows);
    /*
     * One line per finding, not two. With exactly two gauges on a kind, each
     * is flagged against the other and the same disagreement appeared twice
     * (OSG-02 vs OSG-01, then OSG-01 vs OSG-02) — four lines for two facts on
     * the register the first administrator opened. A pair is reported once,
     * named as a pair, with both gauges' figures.
     */
    const seenPair = new Set<string>();
    const flagged = lines.filter((l) => l.flagged).filter((l) => {
      const m = /Disagrees with ([A-Z0-9-]+), the only other gauge/.exec(l.note);
      if (!m) return true;
      const key = `${l.kind}|${[l.gaugeCode, m[1]].sort().join('+')}`;
      if (seenPair.has(key)) return false;
      seenPair.add(key); return true;
    }).map((l) => {
      const m = /Disagrees with ([A-Z0-9-]+), the only other gauge on this kind, by ([\d.]+) mm \(median ([\d.]+) vs ([\d.]+), (\d+) vs (\d+) readings\)/.exec(l.note);
      if (!m) return l;
      const [, other, by, med, omed, n, on] = m;
      return {
        ...l,
        gaugeCode: `${l.gaugeCode} & ${other}`,
        note: `The two gauges on this kind disagree by ${by} mm (${l.gaugeCode} median ${med} over ${n} readings; ${other} median ${omed} over ${on}). The record cannot say which is off — put both against the master.`,
        noteHi: `इस प्रकार के दो गेज ${by} मिमी अलग पढ़ते हैं (${l.gaugeCode} मध्यमान ${med}, ${n} रीडिंग; ${other} मध्यमान ${omed}, ${on})। रिकॉर्ड नहीं बता सकता कौन-सा गलत है — दोनों को मास्टर गेज से मिलाएँ।`
      };
    });
    ok(res, {
      days, thresholdMm: DRIFT_THRESHOLD_MM, minReadingsEachSide: MIN_READINGS_EACH_SIDE,
      readings: rows.length, lines,
      flagged,
      summary: lines.filter((l) => l.flagged).length === 0
        ? (lines.some((l) => l.shiftMm !== null) ? 'No gauge reads more than a millimetre from the others on the same kind of spring.' : 'Not enough readings on more than one gauge per kind to compare yet.')
        : `${flagged.length} finding${flagged.length === 1 ? '' : 's'}: a gauge reads a millimetre or more from the shop's other gauges on the same kind of spring. Put them against the master.`,
      summaryHi: lines.filter((l) => l.flagged).length === 0
        ? (lines.some((l) => l.shiftMm !== null) ? 'एक ही प्रकार की स्प्रिंग पर कोई गेज दूसरों से एक मिलीमीटर से अधिक नहीं पढ़ता।' : 'तुलना के लिए अभी प्रति प्रकार एक से अधिक गेज पर पर्याप्त रीडिंग नहीं।')
        : `${flagged.length} निष्कर्ष: एक ही प्रकार की स्प्रिंग पर कोई गेज दूसरों से एक मिलीमीटर या अधिक पढ़ता है। उन्हें मास्टर गेज से मिलाएँ।`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'GAUGE_DRIFT_FAILED', message: error?.message || 'Gauge drift could not be computed', statusCode: 500, timestamp: new Date().toISOString() });
  }
});

// GET /api/gauges/exposure
//
// How much of the recorded work rests on an instrument nobody has verified.
// The question a supervisor or the DRM would actually ask, rather than
// whether the paperwork is tidy.
// ---------------------------------------------------------------------------
gaugesRouter.get('/exposure', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const counts = repo().readingsOnUnverifiedGauges();
    const total = counts.unrecorded + counts.expired + counts.noGauge;
    ok(res, {
      ...counts,
      total,
      summary: total === 0
        ? 'Every recorded spring names a gauge with a valid calibration.'
        : `${total} recorded springs were judged with an instrument whose calibration ` +
          `is not established: ${counts.unrecorded} on a gauge with no calibration date, ` +
          `${counts.expired} on a lapsed gauge, ${counts.noGauge} with no gauge named at all.`,
      summaryHi: total === 0
        ? 'हर दर्ज स्प्रिंग एक वैध कैलिब्रेशन वाला गेज बताती है।'
        : `${total} दर्ज स्प्रिंग ऐसे उपकरण से जाँची गईं जिसका कैलिब्रेशन स्थापित नहीं: ${counts.unrecorded} बिना कैलिब्रेशन तिथि वाले गेज पर, ` +
          `${counts.expired} समय-सीमा पार गेज पर, ${counts.noGauge} बिना किसी गेज के नाम के।`
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'GAUGE_EXPOSURE_FAILED',
      message: error?.message || 'Gauge exposure could not be computed',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/gauges/:gaugeCode
//
// Recording a calibration says somebody checked this instrument on that date.
// It is an administrator's act and it is written to the audit log, because a
// calibration date that can be set quietly is worth nothing to an auditor.
// ---------------------------------------------------------------------------
gaugesRouter.put(
  '/:gaugeCode',
  authMiddleware,
  requireCapability('system.configure'),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const gaugeCode = String(req.params?.gaugeCode || '').trim();
      const body = (req.body || {}) as Record<string, any>;

      if (!gaugeCode) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'A gauge code is required.',
          statusCode: 400,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const description = String(body.description || '').trim();
      if (!description) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'A gauge needs a description saying what it measures.',
          statusCode: 400,
          timestamp: new Date().toISOString()
        });
        return;
      }

      /*
       * A field this endpoint does not understand is refused rather than
       * ignored.
       *
       * Sending calibrationValidUpto instead of validUpto — a plausible
       * mistake, and one made while testing this very endpoint — returned 200
       * with a gauge that was not calibrated at all. The administrator sees
       * success, the gauge keeps reading UNRECORDED, and every spring measured
       * on it stays flagged in the audit export with nobody able to say why.
       *
       * Silent acceptance of something that did nothing is the failure mode
       * this system can least afford, since the whole point of the gauge
       * register is that a reading is worth its instrument's calibration
       * record.
       */
      const ACCEPTED = new Set([
        'description', 'appliesTo', 'certificateNumber', 'issuedTo',
        'calibratedOn', 'validUpto', 'notes'
      ]);
      const unknown = Object.keys(body).filter((k) => !ACCEPTED.has(k));
      if (unknown.length > 0) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message:
            `Unrecognised field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. ` +
            `A calibration is recorded with calibratedOn and validUpto (YYYY-MM-DD). ` +
            `Accepted fields: ${[...ACCEPTED].join(', ')}.`,
          statusCode: 400,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // A date is either a real ISO date or it is absent. A malformed one
      // would read as a calibration record while meaning nothing.
      for (const field of ['calibratedOn', 'validUpto']) {
        const v = body[field];
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
          res.status(400).json({
            success: false,
            error: 'VALIDATION_ERROR',
            message: `${field} must be a date in the form YYYY-MM-DD, or left empty.`,
            statusCode: 400,
            timestamp: new Date().toISOString()
          });
          return;
        }
      }

      const before = repo().byCode(gaugeCode);
      const gauge = repo().upsert({
        gaugeCode,
        description,
        appliesTo: body.appliesTo ?? null,
        certificateNumber: body.certificateNumber ?? null,
        issuedTo: body.issuedTo ?? null,
        calibratedOn: body.calibratedOn ?? null,
        validUpto: body.validUpto ?? null,
        notes: body.notes ?? null
      });

      logAuditEvent(getDatabase(), {
        eventType: 'SECURITY_ALERT',
        userId: req.user?.id || 'usr_system',
        userRole: req.user?.role || 'SYSTEM',
        payload: {
          action: before ? 'GAUGE_UPDATED' : 'GAUGE_REGISTERED',
          gaugeCode,
          description,
          calibratedOn: gauge.calibratedOn,
          validUpto: gauge.validUpto,
          previousValidUpto: before?.validUpto ?? null
        }
      });

      ok(res, { gauge }, before ? 200 : 201);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: 'GAUGE_SAVE_FAILED',
        message: error?.message || 'The gauge could not be saved',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }
  }
);
