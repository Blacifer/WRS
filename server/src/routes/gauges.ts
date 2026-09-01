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
import { requireRole } from '../middleware/rbac.ts';
import { logAuditEvent } from '../db/auditLog.ts';

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
          `${counts.expired} on a lapsed gauge, ${counts.noGauge} with no gauge named at all.`
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
  requireRole('ADMIN'),
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
