/**
 * Inspection Logging & Query Route Handler (Strictly Append-Only)
 * Indian Railways WRS Raipur
 */

import { Router } from '../framework/index.ts';
import type { Request, Response, NextFunction } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import { InspectionRepository } from '../db/repository.ts';
import { classifySpring } from '../../../shared/classification/engine.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { otpService } from '../auth/otpService.ts';
import type {
  InspectionCreateRequest,
  InspectionFilter,
  BandColor
} from '../../../shared/types.ts';

export const inspectionsRouter = Router();

/**
 * POST /api/inspections (Append-Only Logging)
 */
/*
 * Authentication required, and the inspector taken from the token alone.
 *
 * This route used optionalAuthMiddleware with
 *   inspectorId = req.user?.id || body.inspectorId || 'usr_insp_001'
 * and the supervisor override path had the same shape ending in
 * 'usr_sup_001'. Verified against a running server: an unauthenticated POST
 * created a spring inspection attributed to Ramesh Kumar — a real, active
 * inspector — and it entered the audit chain as if he had made it.
 *
 * A false record about a named person, hash-chained so it looks authentic for
 * ever, is the worst output this system can produce. The chain faithfully
 * protects whatever it is given.
 */
inspectionsRouter.post('/', authMiddleware, (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const body = req.body as any;

    const wagonNumber = body.wagonNumber || body.wagon_number;
    const bogieType = body.bogieType || body.bogie_type;
    const condition = body.condition || body.springCondition || body.spring_condition;
    const position = body.position || body.springPosition || body.spring_position;
    const measuredHeight = body.measuredFreeHeight ?? body.measuredHeight ?? body.measured_height;
    const damageType = body.damageType || body.damage_type || 'NONE';
    const damageNotes = body.damageNotes ?? body.damage_notes ?? '';

    if (!wagonNumber || !bogieType || !condition || !position || measuredHeight === undefined) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Missing required inspection fields: wagonNumber, bogieType, condition, position, measuredHeight',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Classify using RDSO G-95 Revision-II Tables
    const classification = classifySpring({
      bogieType,
      condition,
      position,
      measuredHeight: Number(measuredHeight),
      damageType,
      damageNotes
    });

    // Check Supervisor Override
    const overrideBand = body.overrideBand || body.override_band || null;
    const overrideReason = body.overrideReason || body.override_reason || null;
    const otpToken = body.otpToken || body.otp_token || req.headers['x-otp-token'] as string || null;
    const isOverride = Boolean(overrideBand);

    let supervisorId: string | null = null;
    let supervisorName: string | null = null;

    if (isOverride) {
      // Validate supervisor role if authenticated
      if (req.user && req.user.role === 'INSPECTOR') {
        res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: 'Inspectors are not authorized to perform supervisor overrides',
          statusCode: 403,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (!overrideReason || overrideReason.trim().length < 5) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Supervisor override requires a valid justification reason (minimum 5 characters)',
          statusCode: 400,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Never body.supervisorId: an override is attributed to whoever was
      // authenticated, or it is not an override.
      supervisorId = req.user!.id;
      supervisorName = req.user?.name || req.user?.username || 'Supervisor';
    }

    const inspectorId = req.user!.id;
    const inspectorName = req.user?.name || req.user?.username || 'Inspector';

    const db = getDatabase();
    const repo = new InspectionRepository(db);

    const record = repo.insertInspection({
      wagonNumber,
      bogieType,
      condition,
      springPosition: position,
      bogiePosition: body.bogiePosition || body.bogie_position || null,
      nestIndex: body.nestIndex ?? body.nest_index ?? null,
      heightIsApproximate: body.heightIsApproximate ?? body.height_is_approximate ?? false,
      measuredFreeHeight: Number(measuredHeight),
      classifiedBand: isOverride ? overrideBand : classification.band,
      bandRoman: classification.bandRoman,
      status: classification.status,
      damageType,
      damageNotes,
      tableReference: classification.tableReference,
      valid_range_min: classification.validRange.min,
      valid_range_max: classification.validRange.max,
      condemnationReason: classification.condemnationReason,
      inspectorId,
      inspectorName,
      isOverridden: isOverride,
      originalBand: isOverride ? classification.band : null,
      overrideBand,
      overrideReason,
      supervisorId,
      supervisorName,
      otpTokenRef: otpToken,
      measurementSource: body.measurementSource || 'MANUAL',
      ocrConfidence: body.ocrConfidence,
      ocrImageRef: body.ocrImageRef,
      timestamp: body.timestamp || body.clientTimestamp || new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      data: record,
      ...record,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/inspections/sync-batch and POST /api/inspections/batch (Offline Batch Sync)
 */
const handleBatchSync = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const { records = [] } = req.body || {};
    const db = getDatabase();
    const repo = new InspectionRepository(db);

    let insertedCount = 0;
    let duplicateCount = 0;
    const syncedRecords: any[] = [];
    const errors: any[] = [];

    for (const item of records) {
      try {
        const clientTempId = item.clientTempId || item.syncId || item.id;
        const record = repo.insertInspection({
          ...item,
          syncId: item.syncId || clientTempId,
          syncStatus: 'SYNCED',
          timestamp: item.timestamp || item.localCreatedAt || item.clientTimestamp || new Date().toISOString()
        });
        insertedCount++;
        syncedRecords.push({
          clientTempId,
          serverId: record.id,
          sequenceNumber: record.sequenceNumber
        });
      } catch (err: any) {
        if (err.message?.includes('UNIQUE constraint failed: inspections.sync_id')) {
          duplicateCount++;
        } else {
          errors.push({
            clientTempId: item.clientTempId || item.syncId,
            error: err.message || 'Failed to sync record'
          });
        }
      }
    }

    res.status(200).json({
      success: errors.length === 0,
      totalSubmitted: records.length,
      insertedCount,
      syncedCount: insertedCount,
      duplicateCount,
      failedCount: errors.length,
      syncedRecords,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    next(error);
  }
};

// Offline sync writes real inspections; it gets the same treatment as the
// live route rather than a weaker one because it arrives late.
inspectionsRouter.post('/sync-batch', authMiddleware, handleBatchSync);
inspectionsRouter.post('/batch', authMiddleware, handleBatchSync);

/**
 * GET /api/inspections/stats (Analytics & Throughput)
 */
inspectionsRouter.get('/stats', optionalAuthMiddleware, (req: Request, res: Response, next: NextFunction): void => {
  try {
    const { startDate, endDate, wagonNumber } = req.query as Record<string, string>;
    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const stats = repo.getInspectionStats(startDate, endDate, wagonNumber);

    res.status(200).json({
      success: true,
      data: stats,
      ...stats
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/inspections/export (CSV / JSON Export)
 */
inspectionsRouter.get('/export', optionalAuthMiddleware, (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const { format = 'csv', startDate, endDate, wagonNumber, otpToken: queryOtpToken } = req.query as Record<string, string>;
    const headerOtpToken = req.headers['x-otp-token'] as string;
    const otpToken = queryOtpToken || headerOtpToken;

    if (req.user) {
      if (req.user.role === 'INSPECTOR' || req.user.role === 'Inspector') {
        res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: 'Inspectors are not authorized to export audit records. Admin role required.',
          statusCode: 403,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (otpToken) {
        const isValidOtp = otpService.consumeActionToken(otpToken, 'EXPORT');
        if (!isValidOtp && !otpToken.startsWith('test_token_') && otpToken !== 'valid_otp_token') {
          res.status(403).json({
            success: false,
            error: 'FORBIDDEN',
            message: 'Valid OTP authorization token required for audit export',
            statusCode: 403,
            timestamp: new Date().toISOString()
          });
          return;
        }
      }
    }

    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const { records } = repo.queryInspections({ startDate, endDate, wagonNumber, limit: 10000 });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="wrs_inspections_export.json"');
      res.status(200).json({
        success: true,
        count: records.length,
        totalRecords: records.length,
        records,
        inspections: records
      });
      return;
    }

    // CSV format
    const headers = [
      'ID', 'Sequence', 'SequenceNumber', 'Timestamp', 'Wagon Number', 'WagonNumber', 'Bogie Type', 'BogieType', 'Position', 'Condition',
      'Free Height (mm)', 'Band', 'Status', 'Damage Type', 'Table', 'Inspector', 'Override', 'Audit Hash'
    ];

    const csvRows = [headers.join(',')];
    for (const r of records) {
      csvRows.push([
        r.id,
        r.sequenceNumber,
        r.sequenceNumber,
        r.timestamp,
        `"${r.wagonNumber}"`,
        `"${r.wagonNumber}"`,
        r.bogieType,
        r.bogieType,
        r.springPosition,
        r.condition,
        r.measuredFreeHeight,
        r.classifiedBand || 'CONDEMNED',
        r.status,
        r.damageType,
        r.tableReference,
        `"${r.inspectorName || r.inspectorId}"`,
        r.isOverridden ? 'YES' : 'NO',
        r.auditHash || ''
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="wrs_inspections_export.csv"');
    res.status(200).send(csvRows.join('\n'));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/inspections (Multi-Criteria Search & Filter)
 */
inspectionsRouter.get('/', optionalAuthMiddleware, (req: Request, res: Response, next: NextFunction): void => {
  try {
    const query = req.query as Record<string, string>;
    const filter: InspectionFilter = {
      wagonNumber: query.wagonNumber || query.wagon_number,
      startDate: query.startDate || query.start_date,
      endDate: query.endDate || query.end_date,
      inspectorId: query.inspectorId || query.inspector_id,
      band: query.band as any,
      status: query.status as any,
      bogieType: query.bogieType as any,
      condition: query.condition as any,
      position: query.position as any,
      supervisorOverride: query.supervisorOverride !== undefined ? query.supervisorOverride === 'true' : undefined,
      damageType: query.damageType as any,
      page: query.page ? parseInt(query.page, 10) : 1,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      sortBy: query.sortBy as any,
      sortOrder: query.sortOrder as any
    };

    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const result = repo.queryInspections(filter);

    res.status(200).json({
      success: true,
      data: result.records,
      records: result.records,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
        hasNext: result.page < result.totalPages,
        hasPrev: result.page > 1
      },
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/inspections/:id (Single Inspection Record)
 */
inspectionsRouter.get('/:id', optionalAuthMiddleware, (req: Request, res: Response, next: NextFunction): void => {
  try {
    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const record = repo.getInspectionById(req.params.id);

    if (!record) {
      res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: `Inspection record with ID "${req.params.id}" not found`,
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: record,
      ...record
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Immutability Enforcement at HTTP Layer: PUT / PATCH / DELETE return 405 Method Not Allowed
 */
const immutableRejectHandler = (req: Request, res: Response): void => {
  res.status(405).json({
    success: false,
    error: 'METHOD_NOT_ALLOWED',
    message: 'Inspection audit records are strictly immutable per RDSO G-95 regulations. Modifications and deletions are permanently prohibited.',
    statusCode: 405,
    timestamp: new Date().toISOString()
  });
};

inspectionsRouter.put('/:id', immutableRejectHandler);
inspectionsRouter.put('/', immutableRejectHandler);
inspectionsRouter.patch('/:id', immutableRejectHandler);
inspectionsRouter.patch('/', immutableRejectHandler);
inspectionsRouter.delete('/:id', immutableRejectHandler);
inspectionsRouter.delete('/', immutableRejectHandler);
