/**
 * Serialized Component Health Passports REST API Router
 * Indian Railways WRS Raipur (Phase 3 - M1 / R4)
 */

import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.ts';
import { getDatabase } from '../db/connection.ts';
import { ComponentRepository } from '../db/componentRepository.ts';

export const componentsRouter = Router();

function getRepo(): ComponentRepository {
  return new ComponentRepository(getDatabase());
}

// -------------------------------------------------------------------------
// 1. List / Search Components with Filters and Pagination
// -------------------------------------------------------------------------
componentsRouter.get('/', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const query = req.query || {};

    const result = repo.getComponents({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 50,
      componentType: query.componentType || query.type,
      status: query.status,
      category: query.category,
      wagonNumber: query.wagonNumber,
      healthStatus: query.healthStatus,
      search: query.search || query.q,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder as 'ASC' | 'DESC' | 'asc' | 'desc' | undefined
    });

    res.status(200).json({
      success: true,
      data: result.components,
      pagination: result.pagination,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'COMPONENTS_FETCH_FAILED',
      message: err.message || 'Failed to fetch serialized components.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 2. Summary Statistics & Health KPIs
// -------------------------------------------------------------------------
componentsRouter.get('/stats', optionalAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const stats = repo.getComponentStats();

    res.status(200).json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'STATS_FETCH_FAILED',
      message: err.message || 'Failed to fetch component statistics.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 3. QR Code Lookup
// -------------------------------------------------------------------------
componentsRouter.get('/qr/:qrCode', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { qrCode } = req.params;
    const component = repo.getComponentByQR(qrCode, true);

    if (!component) {
      res.status(404).json({
        success: false,
        error: 'COMPONENT_NOT_FOUND',
        message: `No serialized component found for QR code: ${qrCode}`,
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: component,
      component,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'QR_LOOKUP_FAILED',
      message: err.message || 'Failed to perform QR lookup.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 3b. QR Code Scan Payload Verification
// -------------------------------------------------------------------------
componentsRouter.post('/scan-qr', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { qrPayload, qrCode } = req.body || {};
    const code = qrPayload || qrCode;
    if (!code) {
      res.status(400).json({
        success: false,
        error: 'QR_PAYLOAD_REQUIRED',
        message: 'qrPayload or qrCode is required in request body.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const component = repo.getComponentByQR(code, true);
    if (!component) {
      res.status(404).json({
        success: false,
        error: 'COMPONENT_NOT_FOUND',
        message: `No serialized component found for QR payload: ${code}`,
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: component,
      component,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'QR_SCAN_FAILED',
      message: err.message || 'Failed to process QR code.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 4. Query All Components Mounted on a Specified Wagon
// -------------------------------------------------------------------------
componentsRouter.get('/wagon/:wagonNumber', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { wagonNumber } = req.params;
    const components = repo.getComponentsByWagon(wagonNumber);

    res.status(200).json({
      success: true,
      data: components,
      meta: {
        wagonNumber: wagonNumber.toUpperCase(),
        total: components.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'WAGON_COMPONENTS_FETCH_FAILED',
      message: err.message || 'Failed to fetch wagon components.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 5a. Component History Lookup
// -------------------------------------------------------------------------
componentsRouter.get('/:serialNumber/history', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { serialNumber } = req.params;
    const component = repo.getComponentBySerial(serialNumber, true);

    if (!component) {
      res.status(404).json({
        success: false,
        error: 'COMPONENT_NOT_FOUND',
        message: `Serialized component '${serialNumber}' was not found.`,
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: component.history || [],
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'HISTORY_FETCH_FAILED',
      message: err.message || 'Failed to fetch component history.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 5. Serial Number Lookup with Complete Lifecycle History
// -------------------------------------------------------------------------
componentsRouter.get('/:serialNumber', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { serialNumber } = req.params;
    const component = repo.getComponentBySerial(serialNumber, true);

    if (!component) {
      res.status(404).json({
        success: false,
        error: 'COMPONENT_NOT_FOUND',
        message: `Serialized component '${serialNumber}' was not found in Passport Ledger.`,
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: component,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'COMPONENT_FETCH_FAILED',
      message: err.message || 'Failed to fetch serialized component.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 6. Register New Serialized Component
// -------------------------------------------------------------------------
componentsRouter.post('/register', authMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const body = req.body || {};

    if (!body.serialNumber || typeof body.serialNumber !== 'string' || body.serialNumber.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'INVALID_SERIAL_NUMBER',
        message: 'serialNumber is required and cannot be empty.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!body.componentType || typeof body.componentType !== 'string') {
      res.status(400).json({
        success: false,
        error: 'INVALID_COMPONENT_TYPE',
        message: 'componentType is required.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const component = repo.registerComponent(
      {
        ...body,
        inspectorId: req.user?.id,
        inspectorName: req.user?.name || req.user?.fullName
      },
      req.user?.id || 'usr_insp_001',
      req.user?.name || req.user?.fullName || 'Shop Inspector'
    );

    res.status(201).json({
      success: true,
      data: component,
      message: `Component ${component.serialNumber} registered successfully in Stores Passport Ledger.`,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    const isConflict = err.message && (
      err.message.includes('ALREADY_EXISTS') ||
      err.message.includes('UNIQUE') ||
      err.message.includes('already exists')
    );

    res.status(isConflict ? 409 : 400).json({
      success: false,
      error: isConflict ? 'COMPONENT_ALREADY_EXISTS' : 'REGISTRATION_FAILED',
      message: err.message || 'Failed to register component.',
      statusCode: isConflict ? 409 : 400,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 7. Assign / Reassign Component to Wagon
// -------------------------------------------------------------------------
componentsRouter.post('/:serialNumber/assign', authMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { serialNumber } = req.params;
    const { wagonNumber, bogiePosition, stage, notes } = req.body || {};

    if (!wagonNumber || typeof wagonNumber !== 'string' || wagonNumber.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'INVALID_WAGON_NUMBER',
        message: 'wagonNumber is required for component assignment.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const component = repo.assignComponent(
      serialNumber,
      wagonNumber,
      bogiePosition || 'NONE',
      stage || 'COMPONENT_INSPECTION',
      notes,
      req.user?.id || 'usr_insp_001',
      req.user?.name || req.user?.fullName || 'Shop Inspector'
    );

    res.status(200).json({
      success: true,
      data: component,
      message: `Component ${component.serialNumber} assigned to wagon ${wagonNumber.toUpperCase()} at position ${bogiePosition || 'NONE'}.`,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    const isNotFound = err.message && (err.message.includes('not found') || err.message.includes('NOT_FOUND'));
    res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: isNotFound ? 'COMPONENT_NOT_FOUND' : 'ASSIGNMENT_FAILED',
      message: err.message || 'Failed to assign component.',
      statusCode: isNotFound ? 404 : 400,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 8. Unassign Component from Wagon
// -------------------------------------------------------------------------
componentsRouter.post('/:serialNumber/unassign', authMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { serialNumber } = req.params;
    const { reason, targetStatus, notes } = req.body || {};

    const component = repo.unassignComponent(
      serialNumber,
      reason,
      targetStatus || 'AVAILABLE_IN_STORES',
      notes,
      req.user?.id || 'usr_insp_001',
      req.user?.name || req.user?.fullName || 'Shop Inspector'
    );

    res.status(200).json({
      success: true,
      data: component,
      message: `Component ${component.serialNumber} successfully unassigned from wagon.`,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    const isNotFound = err.message && (err.message.includes('not found') || err.message.includes('NOT_FOUND'));
    res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: isNotFound ? 'COMPONENT_NOT_FOUND' : 'UNASSIGNMENT_FAILED',
      message: err.message || 'Failed to unassign component.',
      statusCode: isNotFound ? 404 : 400,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 9. Update Component Health Score
// -------------------------------------------------------------------------
componentsRouter.post('/:serialNumber/health', authMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { serialNumber } = req.params;
    const { healthScore, notes } = req.body || {};

    if (healthScore === undefined || isNaN(Number(healthScore))) {
      res.status(400).json({
        success: false,
        error: 'INVALID_HEALTH_SCORE',
        message: 'healthScore must be a valid number between 0 and 100.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const component = repo.updateHealthScore(
      serialNumber,
      Number(healthScore),
      notes,
      req.user?.id || 'usr_insp_001',
      req.user?.name || req.user?.fullName || 'Shop Inspector'
    );

    res.status(200).json({
      success: true,
      data: component,
      message: `Health score for component ${component.serialNumber} updated to ${component.healthScore}% (${component.healthStatus}).`,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    const isNotFound = err.message && (err.message.includes('not found') || err.message.includes('NOT_FOUND'));
    res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: isNotFound ? 'COMPONENT_NOT_FOUND' : 'HEALTH_UPDATE_FAILED',
      message: err.message || 'Failed to update component health score.',
      statusCode: isNotFound ? 404 : 400,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 10. Record Overhaul (POH)
// -------------------------------------------------------------------------
componentsRouter.post('/:serialNumber/overhaul', authMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { serialNumber } = req.params;
    const { pohDate, nextPohDue, restoredHealthScore, notes } = req.body || {};

    const component = repo.recordOverhaul(
      serialNumber,
      pohDate,
      nextPohDue,
      restoredHealthScore !== undefined ? Number(restoredHealthScore) : 100.0,
      notes,
      req.user?.id || 'usr_insp_001',
      req.user?.name || req.user?.fullName || 'POH Engineer'
    );

    res.status(200).json({
      success: true,
      data: component,
      message: `Component ${component.serialNumber} overhaul recorded. Overhaul count: ${component.overhaulCount}, Status: ${component.status}.`,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    const isNotFound = err.message && (err.message.includes('not found') || err.message.includes('NOT_FOUND'));
    res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: isNotFound ? 'COMPONENT_NOT_FOUND' : 'OVERHAUL_FAILED',
      message: err.message || 'Failed to record overhaul.',
      statusCode: isNotFound ? 404 : 400,
      timestamp: new Date().toISOString()
    });
  }
});
