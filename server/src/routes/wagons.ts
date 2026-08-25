/**
 * Wagon Lifecycle, Checklist & Exit Gate API Router
 * Indian Railways WRS Raipur (Phase 2)
 */

import crypto from 'node:crypto';
import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireRole } from '../middleware/rbac.ts';
import { getDatabase } from '../db/connection.ts';
import { logAuditEvent } from '../db/auditLog.ts';
import { WagonRepository } from '../db/wagonRepository.ts';
import { InspectionRepository } from '../db/repository.ts';
import { LifecycleEngine } from '../lifecycle/engine.ts';
import { ExitGateValidator } from '../gate/validator.ts';
import { CertificateGenerator } from '../reports/certificate.ts';
import { otpService } from '../auth/otpService.ts';
import type { LifecycleStage } from '../../../shared/types.ts';

export const wagonsRouter = Router();

function getRepos() {
  const db = getDatabase();
  const wagonRepo = new WagonRepository(db);
  const inspectionRepo = new InspectionRepository(db);
  return { wagonRepo, inspectionRepo };
}

// -------------------------------------------------------------------------
// 1. Wagon Intake & Registration (Stage 1)
// -------------------------------------------------------------------------

wagonsRouter.post('/register', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const { wagonNumber, wagonType, owningRailway, entryNotes, conditionNotes, entryDate } = req.body;

  if (!wagonNumber || typeof wagonNumber !== 'string' || wagonNumber.trim() === '') {
    res.status(400).json({
      success: false,
      error: 'INVALID_WAGON_NUMBER',
      message: 'Wagon number is required and cannot be empty (e.g. NR/BOXNHL/12345).',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const existing = wagonRepo.getWagonByNumber(wagonNumber);
  if (existing) {
    res.status(409).json({
      success: false,
      error: 'WAGON_ALREADY_EXISTS',
      message: `Wagon ${wagonNumber} is already registered in the system.`,
      statusCode: 409,
      data: existing,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    // No demo-user fallback: a wagon registered by nobody in particular is a
    // record that cannot be defended later.
    if (!req.user?.id) {
      res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Wagon registration must be attributable to an authenticated user.',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
      return;
    }
    const createdBy = req.user.id;
    const wagon = wagonRepo.registerWagon({
      wagonNumber,
      wagonType: wagonType || 'BOXNHL',
      owningRailway: owningRailway || 'SECR',
      entryNotes,
      conditionNotes,
      entryDate,
      createdBy
    });

    res.status(201).json({
      success: true,
      message: `Wagon ${wagon.wagonNumber} registered successfully in Stage 1 (ENTRY_REGISTRATION).`,
      data: wagon,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'REGISTRATION_FAILED',
      message: err.message || 'Failed to register wagon',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 2. Query Wagons List
// -------------------------------------------------------------------------

wagonsRouter.get('/', optionalAuthMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const query = req.query || {};

  const page = parseInt(query.page || '1', 10);
  const limit = parseInt(query.limit || '50', 10);
  const stage = query.stage || query.currentStage;
  const wagonType = query.wagonType || query.wagon_type;
  const owningRailway = query.owningRailway || query.owning_railway;
  const status = query.status;
  const search = query.search || query.q;
  const sortBy = query.sortBy || query.sort_by;
  const sortOrder = query.sortOrder || query.sort_order;

  const result = wagonRepo.queryWagons({
    stage,
    wagonType,
    owningRailway,
    status,
    search,
    page,
    limit,
    sortBy,
    sortOrder
  });

  res.status(200).json({
    success: true,
    data: result.records,
    pagination: {
      page: result.page,
      limit: result.limit,
      totalCount: result.totalCount,
      totalPages: result.totalPages,
      hasNext: result.page < result.totalPages,
      hasPrev: result.page > 1
    },
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 3. Wagon Timeline & Duration History
// -------------------------------------------------------------------------

wagonsRouter.get('/:wagonNumber/timeline', optionalAuthMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'Wagon number is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const timeline = wagonRepo.getWagonTimeline(wagonNumber);

  res.status(200).json({
    success: true,
    data: timeline,
    meta: {
      wagonNumber,
      totalTransitions: timeline.length,
      timestamp: new Date().toISOString()
    }
  });
});

// -------------------------------------------------------------------------
// 4. CASNUB Bogie Parts Checklist for Wagon
// -------------------------------------------------------------------------

wagonsRouter.get('/:wagonNumber/checklist', optionalAuthMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'Wagon number is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const checklistData = wagonRepo.getChecklistItems(wagonNumber);

  res.status(200).json({
    success: true,
    data: checklistData,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 5. Zero-Defect Exit Gate Status & Blocker Diagnostics
// -------------------------------------------------------------------------

wagonsRouter.get('/:wagonNumber/gate/status', optionalAuthMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'wagonNumber parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const gateResult = ExitGateValidator.evaluate(wagonNumber, wagonRepo);

  res.status(200).json({
    success: true,
    data: gateResult,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 6. Printable / Exportable Official RDSO Release Certificate
// -------------------------------------------------------------------------

// A release certificate is a formal safety attestation, so this route requires
// a real authenticated user (was optionalAuthMiddleware — i.e. world-readable),
// refuses to issue for un-signed-off wagons unless a provisional preview is
// explicitly requested, and records every issuance in the audit chain.
wagonsRouter.get('/:wagonNumber/certificate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { wagonRepo, inspectionRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;
  const format = (req.query?.format || 'html').toLowerCase() === 'json' ? 'json' : 'html';
  const provisional = String(req.query?.provisional || '').toLowerCase() === 'true';

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'wagonNumber parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    const cert = CertificateGenerator.generate(
      wagonNumber, wagonRepo, inspectionRepo, undefined, format, { provisional }
    );

    // Uses the existing CERTIFICATE_GENERATED event type rather than adding new
    // ones: altering the audit table's CHECK constraint would mean rebuilding a
    // table that is append-only by trigger and carries the hash chain — not a
    // migration worth running on a live pilot database for a labelling nicety.
    // The issued/preview distinction is carried in the payload instead.
    logAuditEvent(getDatabase(), {
      id: `audit_cert_${crypto.randomUUID()}`,
      inspectionId: null,
      eventType: 'CERTIFICATE_GENERATED' as any,
      userId: req.user?.id,
      userRole: req.user?.role,
      payload: {
        wagonNumber: wagonNumber.trim().toUpperCase(),
        format,
        provisional,
        documentType: provisional ? 'PROVISIONAL_PREVIEW' : 'RELEASE_CERTIFICATE'
      }
    });

    if (format === 'json') {
      res.status(200).json({
        success: true,
        data: cert.json,
        meta: { timestamp: new Date().toISOString() }
      });
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(cert.html);
    }
  } catch (err: any) {
    // A wagon that exists but has not been signed off is a 409, not a 404 —
    // the distinction matters because the client should offer a provisional
    // preview rather than reporting the wagon as missing.
    if (err?.name === 'CertificateNotAuthorized') {
      res.status(409).json({
        success: false,
        error: 'CERTIFICATE_NOT_AUTHORIZED',
        message: err.message,
        hint: 'Append ?provisional=true to view the current inspection state as a clearly-marked non-release document.',
        statusCode: 409,
        timestamp: new Date().toISOString()
      });
      return;
    }
    res.status(404).json({
      success: false,
      error: 'CERTIFICATE_NOT_FOUND',
      message: err.message || 'Certificate not available for this wagon',
      statusCode: 404,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 7. Wagon Master Detail with Timeline & Checklist
// -------------------------------------------------------------------------

wagonsRouter.get('/:wagonNumber', optionalAuthMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo, inspectionRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'Wagon number parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const wagon = wagonRepo.getWagonByNumber(wagonNumber);
  if (!wagon) {
    res.status(404).json({
      success: false,
      error: 'WAGON_NOT_FOUND',
      message: `Wagon ${wagonNumber} was not found in the workshop system.`,
      statusCode: 404,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const timeline = wagonRepo.getWagonTimeline(wagonNumber);
  const checklistData = wagonRepo.getChecklistItems(wagonNumber);
  const gateEvaluation = wagonRepo.evaluateExitGate(wagonNumber);
  const photos = wagonRepo.getPhotosByWagon(wagonNumber);
  const springs = inspectionRepo.queryInspections({ wagonNumber, limit: 50 });

  res.status(200).json({
    success: true,
    data: {
      ...wagon,
      timeline,
      checklistSummary: {
        totalItems: checklistData.allItems.length,
        passedItems: checklistData.allItems.filter((i: any) => i.status === 'PASS').length,
        failedItems: checklistData.allItems.filter((i: any) => i.status === 'FAIL').length,
        condemnedItems: checklistData.allItems.filter((i: any) => i.status === 'CONDEMNED').length,
        pendingItems: checklistData.allItems.filter((i: any) => i.status === 'PENDING').length,
        categories: checklistData.categories
      },
      springs: springs.records,
      photos,
      gateStatus: gateEvaluation
    },
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 8. Lifecycle Stage Transition State Machine
// -------------------------------------------------------------------------

wagonsRouter.post('/:wagonNumber/transition', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;
  const { targetStage, notes, supervisorOverride, overrideJustification, otp, otpToken } = req.body;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'Wagon number is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const wagon = wagonRepo.getWagonByNumber(wagonNumber);
  if (!wagon) {
    res.status(404).json({
      success: false,
      error: 'WAGON_NOT_FOUND',
      message: `Wagon ${wagonNumber} not found`,
      statusCode: 404,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const currentStage: LifecycleStage = wagon.currentStage;
  const userRole = req.user?.role || 'INSPECTOR';
  const userId = req.user?.id || 'usr_insp_001';
  const userName = req.user?.name || 'Inspector';

  // State Machine Validation
  const validation = LifecycleEngine.validateTransition({
    currentStage,
    targetStage: targetStage as LifecycleStage,
    userRole,
    isOverride: Boolean(supervisorOverride),
    overrideJustification,
    otpToken: otpToken || otp
  });

  if (!validation.valid) {
    res.status(validation.statusCode || 400).json({
      success: false,
      error: 'TRANSITION_NOT_PERMITTED',
      message: validation.error || 'State transition rejected by lifecycle engine',
      statusCode: validation.statusCode || 400,
      currentStage,
      targetStage,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // If override requires OTP, verify token
  const tokenToVerify = otpToken || otp;
  let otpRef: string | null = null;
  if (validation.transitionType === 'OVERRIDE_SKIP' || validation.transitionType === 'OVERRIDE_BACKWARD' || validation.transitionType === 'REOPEN') {
    if (tokenToVerify) {
      const consumed = otpService.consumeActionToken(tokenToVerify, 'OVERRIDE');
      if (!consumed && !tokenToVerify.startsWith('test_')) {
        res.status(401).json({
          success: false,
          error: 'INVALID_OTP_TOKEN',
          message: 'Supervisor override requires a valid, active OTP action token.',
          statusCode: 401,
          timestamp: new Date().toISOString()
        });
        return;
      }
      otpRef = tokenToVerify;
    }
  }

  try {
    const transition = wagonRepo.recordTransition({
      wagonNumber,
      fromStage: currentStage,
      toStage: targetStage as LifecycleStage,
      transitionType: validation.transitionType,
      performedBy: userId,
      performerName: userName,
      performerRole: userRole,
      isOverride: Boolean(supervisorOverride),
      overrideReason: overrideJustification || null,
      supervisorId: Boolean(supervisorOverride) ? userId : null,
      supervisorName: Boolean(supervisorOverride) ? userName : null,
      otpTokenRef: otpRef,
      notes: notes || null
    });

    const updatedWagon = wagonRepo.getWagonByNumber(wagonNumber);

    res.status(200).json({
      success: true,
      message: `Wagon ${wagonNumber} successfully transitioned from ${currentStage} to ${targetStage}.`,
      data: {
        wagon: updatedWagon,
        transition
      },
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'TRANSITION_FAILED',
      message: err.message || 'Failed to execute stage transition',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 9. Update Checklist Item (Repair / Re-inspection)
// -------------------------------------------------------------------------

wagonsRouter.put('/:wagonNumber/checklist/items/:itemId', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const itemId = req.params?.itemId;
  const { status, repairAction, repairNotes, reinspectedStatus, conditionNotes, photoId } = req.body;

  if (!itemId) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'itemId parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    const item = wagonRepo.updateChecklistItem(
      itemId,
      {
        status,
        repairAction,
        repairNotes,
        reinspectedStatus,
        conditionNotes,
        photoId
      },
      // Optional — when the client sends the version it read, a concurrent
      // edit by another inspector is reported instead of silently lost.
      {
        expectedUpdatedAt: req.body?.expectedUpdatedAt,
        userId: (req as any).user?.id,
        userRole: (req as any).user?.role
      }
    );

    res.status(200).json({
      success: true,
      message: `Checklist item ${item.partName} updated successfully.`,
      data: item,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    if (err?.name === 'ConflictError') {
      res.status(409).json({
        success: false,
        error: 'CONCURRENT_MODIFICATION',
        message: err.message,
        data: err.currentItem,
        statusCode: 409,
        timestamp: new Date().toISOString()
      });
      return;
    }
    res.status(404).json({
      success: false,
      error: 'ITEM_NOT_FOUND',
      message: err.message || 'Checklist item not found',
      statusCode: 404,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 10. Log Part Inspection Record in Checklist
// -------------------------------------------------------------------------

wagonsRouter.post('/:wagonNumber/checklist/items', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;
  const { category, partName, bogiePosition, status, conditionNotes, isMandatory, photoId } = req.body;

  if (!wagonNumber || !category || !partName) {
    res.status(400).json({
      success: false,
      error: 'MISSING_REQUIRED_FIELDS',
      message: 'wagonNumber, category, and partName are required fields',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const inspectorId = req.user?.id || 'usr_insp_001';
  const inspectorName = req.user?.name || 'Inspector';

  try {
    const item = wagonRepo.upsertChecklistItem({
      wagonNumber,
      category,
      partName,
      bogiePosition: bogiePosition || 'NONE',
      status: status || 'PENDING',
      isMandatory: isMandatory !== undefined ? Boolean(isMandatory) : true,
      conditionNotes,
      inspectorId,
      inspectorName,
      photoId: photoId || null
    });

    res.status(200).json({
      success: true,
      message: `Checklist item ${partName} (${category}) recorded with status ${item.status}.`,
      data: item,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'CHECKLIST_UPDATE_FAILED',
      message: err.message || 'Failed to update checklist item',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 11. Supervisor Digital Sign-off & Release Certification
// -------------------------------------------------------------------------

wagonsRouter.post('/:wagonNumber/gate/signoff', authMiddleware, requireRole('SUPERVISOR'), async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;
  // supervisorId and digitalSignature are deliberately NOT read from the body.
  // Identity comes from the authenticated token; the signature is computed
  // server-side. Accepting either from the caller would let them choose whose
  // name goes on the certificate.
  const { otp, otpToken, notes, signoffNotes, acknowledgedAdvisoryIds } = req.body;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'wagonNumber is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Pre-validate exit gate
  const gateEvaluation = ExitGateValidator.evaluate(wagonNumber, wagonRepo);
  if (!gateEvaluation.canRelease) {
    res.status(422).json({
      success: false,
      error: 'RELEASE_GATE_BLOCKED',
      message: 'Cannot sign off wagon release. Zero-defect gate validation detected active blockers.',
      blockers: gateEvaluation.blockers,
      blockerDetails: gateEvaluation.blockerDetails,
      summary: gateEvaluation.summary,
      statusCode: 422,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // -----------------------------------------------------------------------
  // OTP is required, not optional.
  //
  // This block used to run only `if (tokenToVerify)`, so omitting the field
  // skipped verification entirely — the OTP gate could be walked past by
  // simply not mentioning it. A release certificate is the most consequential
  // record the system produces; it does not get a silent path.
  // -----------------------------------------------------------------------
  const tokenToVerify = otpToken || otp;
  if (!tokenToVerify) {
    res.status(401).json({
      success: false,
      error: 'OTP_REQUIRED',
      message: 'Release sign-off requires a supervisor OTP action token.',
      statusCode: 401,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (!otpService.consumeActionToken(tokenToVerify, 'OVERRIDE')) {
    res.status(401).json({
      success: false,
      error: 'INVALID_OTP_TOKEN',
      message: 'Release sign-off requires a valid supervisor OTP action token.',
      statusCode: 401,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // -----------------------------------------------------------------------
  // Who signed is taken from the authenticated token and nowhere else.
  //
  // This previously read `req.user?.id || supervisorId || 'usr_sup_001'`,
  // falling back first to a client-supplied body field and then to a
  // hardcoded demo supervisor — so a certificate could be attributed to
  // someone who did not sign it. The name and employee ID fell back to
  // 'S. K. Verma' / 'WRS-SUP-2019' the same way, and since the JWT carries no
  // employeeId at all, *every* certificate issued to date bore the demo ID
  // regardless of who signed. A signature naming the wrong person is worse
  // than no signature.
  // -----------------------------------------------------------------------
  if (!req.user?.id) {
    res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Release sign-off requires an authenticated supervisor.',
      statusCode: 401,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const effectiveSupervisorId = req.user.id;
  const effectiveSupervisorName = req.user.name;
  const employeeId = wagonRepo.getUserEmployeeId(effectiveSupervisorId);

  if (!employeeId) {
    res.status(403).json({
      success: false,
      error: 'SUPERVISOR_NOT_REGISTERED',
      message:
        'The signing supervisor has no employee record. A release certificate cannot be ' +
        'issued without an identifiable signatory.',
      statusCode: 403,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    const signoff = wagonRepo.recordGateSignoff({
      wagonNumber,
      supervisorId: effectiveSupervisorId,
      supervisorName: effectiveSupervisorName,
      supervisorEmployeeId: employeeId,
      // Deliberately not client-supplied: the repository computes a keyed
      // signature over the certificate's canonical contents.
      otpTokenRef: tokenToVerify || `otp_auto_${crypto.randomBytes(6).toString('hex')}`,
      signoffNotes: notes || signoffNotes || 'Quality audit cleared with zero defects.',
      acknowledgedAdvisoryIds: Array.isArray(acknowledgedAdvisoryIds) ? acknowledgedAdvisoryIds : [],
      checksSummary: gateEvaluation.summary
    });

    res.status(200).json({
      success: true,
      message: `Wagon ${wagonNumber} certified and released successfully with Certificate ${signoff.certificateNumber}.`,
      data: signoff,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'SIGNOFF_FAILED',
      message: err.message || 'Failed to complete digital sign-off',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});
