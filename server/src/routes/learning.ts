/**
 * Machine Learning Feedback Loop API
 * Indian Railways WRS Raipur
 *
 * Exposes the correction ledger, the accuracy metrics derived from it, and
 * the human approval gate for any parameter the system proposes to tune.
 */

import { Router } from '../framework/index.ts';
import type { Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import { LearningService } from '../learning/learningService.ts';
import type { LearningSubsystem } from '../learning/learningService.ts';
import { ALL_LEARNING_SUBSYSTEMS } from '../learning/learningService.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';

export const learningRouter = Router();

function service(): LearningService {
  return new LearningService(getDatabase());
}

// Derived, not restated — see ALL_LEARNING_SUBSYSTEMS in learningService.ts
// for why this list is no longer written out by hand.
const VALID_SUBSYSTEMS: readonly LearningSubsystem[] = ALL_LEARNING_SUBSYSTEMS;

// ---------------------------------------------------------------------------
// POST /api/learning/outcome
// Records one machine judgement and what the human did with it. Called by the
// client whenever an OCR read, classification or voice command is committed.

// ---------------------------------------------------------------------------
// GET /api/learning/parameters/effective
//
// The values the running system should actually use.
//
// Without this the loop did not close: outcomes were recorded, accuracy was
// computed, proposals were raised and approved — and the approved value was
// written to a table nothing read. Approving a change altered no behaviour
// whatsoever, which makes a dial that is connected to nothing, and someone
// will eventually turn it and believe they have done something.
// ---------------------------------------------------------------------------
learningRouter.get('/parameters/effective', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  const values: Record<string, number> = {};
  for (const row of service().listParameters()) {
    values[row.param_key] = row.current_value;
  }
  res.status(200).json({ success: true, data: values, timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// GET /api/learning/memory — "how much has it seen, what has it learned"
// ---------------------------------------------------------------------------
learningRouter.get('/memory', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({ success: true, data: service().getMemory(), timestamp: new Date().toISOString() });
});

learningRouter.get('/parameters/:paramKey/history', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const paramKey = req.params?.paramKey;
  if (!paramKey) {
    res.status(400).json({ success: false, error: 'MISSING_PARAM', message: 'paramKey is required', statusCode: 400, timestamp: new Date().toISOString() });
    return;
  }
  res.status(200).json({ success: true, data: service().getParameterHistory(paramKey), timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
learningRouter.post('/outcome', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body || {};

    if (!body.subsystem || !VALID_SUBSYSTEMS.includes(body.subsystem)) {
      res.status(400).json({
        success: false,
        error: 'INVALID_SUBSYSTEM',
        message: `subsystem must be one of: ${VALID_SUBSYSTEMS.join(', ')}`,
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (typeof body.wasCorrected !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'MISSING_WAS_CORRECTED',
        message: 'wasCorrected (boolean) is required — it is the training signal.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const result = service().recordOutcome({
      subsystem: body.subsystem,
      wagonNumber: body.wagonNumber ?? null,
      inspectionId: body.inspectionId ?? null,
      machineOutput: body.machineOutput ?? null,
      machineConfidence: typeof body.machineConfidence === 'number' ? body.machineConfidence : null,
      humanOutput: body.humanOutput,
      wasCorrected: body.wasCorrected,
      correctionMagnitude:
        typeof body.correctionMagnitude === 'number' ? Math.abs(body.correctionMagnitude) : null,
      context: body.context ?? null,
      userId: req.user?.id ?? null,
      userRole: req.user?.role ?? null
    });

    res.status(201).json({
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'LEARNING_RECORD_FAILED',
      message: err?.message || 'Could not record learning outcome',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/learning/dashboard — what the system has learned so far
// ---------------------------------------------------------------------------
learningRouter.get(
  '/dashboard',
  authMiddleware,
  /*
   * Reading is a capability, not a rank.
   *
   * requireRole asks "are you this senior or above" against a ladder that
   * lists INSPECTOR, SUPERVISOR and ADMIN and does not contain DRM at all —
   * so the divisional officer scores zero and is refused, while his own
   * navigation offers him this screen because he holds learning.view. Same
   * shape as the Audit Chain bug: the nav and the enforcement disagreed and
   * the officer lost.
   *
   * Deciding a proposal below stays a rank check, because approving a change
   * to how the system behaves is not something the DRM does.
   */
  requireCapability('learning.view'),
  (_req: AuthenticatedRequest, res: Response) => {
    const svc = service();
    svc.ensureParameters();
    res.status(200).json({
      success: true,
      data: svc.getDashboard(),
      meta: { timestamp: new Date().toISOString() }
    });
  }
);

// ---------------------------------------------------------------------------
// GET /api/learning/accuracy/:subsystem
// ---------------------------------------------------------------------------
learningRouter.get(
  '/accuracy/:subsystem',
  authMiddleware,
  // Read, so the same capability as the dashboard above.
  requireCapability('learning.view'),
  (req: AuthenticatedRequest, res: Response) => {
    const subsystem = req.params?.subsystem as LearningSubsystem;
    if (!VALID_SUBSYSTEMS.includes(subsystem)) {
      res.status(400).json({
        success: false,
        error: 'INVALID_SUBSYSTEM',
        message: `subsystem must be one of: ${VALID_SUBSYSTEMS.join(', ')}`,
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }
    const windowDays = req.query?.windowDays ? Number(req.query.windowDays) : undefined;
    res.status(200).json({
      success: true,
      data: {
        accuracy: service().getAccuracy(subsystem, windowDays),
        calibration: service().getConfidenceCalibration(subsystem)
      },
      meta: { timestamp: new Date().toISOString() }
    });
  }
);

// ---------------------------------------------------------------------------
// POST /api/learning/analyze — re-derive insights and raise proposals
// ---------------------------------------------------------------------------
learningRouter.post(
  '/analyze',
  authMiddleware,
  requireCapability('learning.approve'),
  (_req: AuthenticatedRequest, res: Response) => {
    const svc = service();
    svc.ensureParameters();
    const insights = svc.deriveInsights();
    const { proposed } = svc.generateProposals();
    res.status(200).json({
      success: true,
      data: { insights, proposalsRaised: proposed, parameters: svc.listParameters() },
      meta: { timestamp: new Date().toISOString() }
    });
  }
);

// ---------------------------------------------------------------------------
// POST /api/learning/parameters/:paramKey/decide
// The human approval gate. Nothing the system proposes takes effect without
// a named person accepting it — admin only.
// ---------------------------------------------------------------------------
learningRouter.post(
  '/parameters/:paramKey/decide',
  authMiddleware,
  requireCapability('system.configure'),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const paramKey = req.params?.paramKey;
      const decision = (req.body?.decision || '').toUpperCase();

      if (decision !== 'APPROVE' && decision !== 'REJECT') {
        res.status(400).json({
          success: false,
          error: 'INVALID_DECISION',
          message: 'decision must be "APPROVE" or "REJECT".',
          statusCode: 400,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const updated = service().decideProposal(paramKey!, decision, req.user!.id);
      res.status(200).json({
        success: true,
        data: updated,
        meta: { timestamp: new Date().toISOString() }
      });
    } catch (err: any) {
      const status = err?.name === 'ValidationError' ? 400 : 500;
      res.status(status).json({
        success: false,
        error: err?.name === 'ValidationError' ? 'VALIDATION_ERROR' : 'DECISION_FAILED',
        message: err?.message || 'Could not apply decision',
        statusCode: status,
        timestamp: new Date().toISOString()
      });
    }
  }
);
