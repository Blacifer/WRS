/**
 * Stores Depot Inventory REST API Router
 * Indian Railways WRS Raipur (Phase 3 - M1 / R5)
 */

import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.ts';
import { requireRole } from '../middleware/rbac.ts';
import { getDatabase } from '../db/connection.ts';
import { InventoryRepository } from '../db/inventoryRepository.ts';

export const inventoryRouter = Router();

function getRepo() {
  const db = getDatabase();
  return new InventoryRepository(db);
}

// -------------------------------------------------------------------------
// 1. List Inventory Parts Catalog & Stock Levels
// -------------------------------------------------------------------------
inventoryRouter.get('/', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const category = req.query?.category as string | undefined;
    const parts = repo.getInventory(category);

    res.status(200).json({
      success: true,
      data: parts,
      meta: {
        total: parts.length,
        category: category || 'ALL',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'INVENTORY_FETCH_FAILED',
      message: error.message || 'Failed to retrieve inventory parts.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 2. Aggregate Inventory KPIs & Metrics
// -------------------------------------------------------------------------
inventoryRouter.get('/stats', optionalAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const stats = repo.getInventoryStats();

    res.status(200).json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'STATS_FETCH_FAILED',
      message: error.message || 'Failed to retrieve inventory statistics.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 3. List Part Reservations (by wagonNumber and/or status)
// -------------------------------------------------------------------------
inventoryRouter.get('/reservations', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const wagonNumber = req.query?.wagonNumber as string | undefined;
    const status = req.query?.status as string | undefined;
    const reservations = repo.getReservations(wagonNumber, status);

    res.status(200).json({
      success: true,
      data: reservations,
      meta: {
        total: reservations.length,
        wagonNumber: wagonNumber || 'ALL',
        status: status || 'ALL',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'RESERVATIONS_FETCH_FAILED',
      message: error.message || 'Failed to retrieve reservations.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 4. Get Single Part by Part Code
// -------------------------------------------------------------------------
inventoryRouter.get('/part/:partCode', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { partCode } = req.params;
    const part = repo.getPartByCode(partCode);

    if (!part) {
      res.status(404).json({
        success: false,
        error: 'PART_NOT_FOUND',
        message: `Part with code '${partCode}' was not found in stores inventory.`,
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: part,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'PART_FETCH_FAILED',
      message: error.message || 'Failed to retrieve part.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 5. Reserve Part for Wagon
// -------------------------------------------------------------------------
inventoryRouter.post('/reserve', authMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { wagonNumber, partCode, quantity, source, predictedDefect, confidenceScore } = req.body;

    if (!wagonNumber || typeof wagonNumber !== 'string' || wagonNumber.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'INVALID_WAGON_NUMBER',
        message: 'wagonNumber is required and cannot be empty.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!partCode || typeof partCode !== 'string' || partCode.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'INVALID_PART_CODE',
        message: 'partCode is required and cannot be empty.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const qty = Number(quantity) || 1;
    if (qty <= 0) {
      res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'Quantity must be at least 1.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const reservation = repo.reservePart({
      wagonNumber,
      partCode,
      quantity: qty,
      source: source || 'MANUAL_INSPECTION',
      predictedDefect,
      confidenceScore
    });

    res.status(201).json({
      success: true,
      data: reservation,
      message: `Successfully reserved ${qty}x ${partCode} for wagon ${wagonNumber}.`,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    const isNotFound = error.message && error.message.includes('does not exist');
    res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: isNotFound ? 'PART_NOT_FOUND' : 'RESERVATION_FAILED',
      message: error.message || 'Failed to reserve part.',
      statusCode: isNotFound ? 404 : 400,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 6. Issue Part to Shop Floor
// -------------------------------------------------------------------------
inventoryRouter.post('/issue', authMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { reservationId } = req.body;

    if (!reservationId || typeof reservationId !== 'string' || reservationId.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'INVALID_RESERVATION_ID',
        message: 'reservationId is required.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const result = repo.issuePart(reservationId);

    res.status(200).json({
      success: true,
      data: result,
      message: `Successfully issued part ${result.part.partCode} (${result.reservation.quantity} ${result.part.unitOfMeasure}) to shop floor for wagon ${result.reservation.wagonNumber}.`,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    const isNotFound = error.message && error.message.includes('not found');
    res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: isNotFound ? 'RESERVATION_NOT_FOUND' : 'ISSUE_FAILED',
      message: error.message || 'Failed to issue part.',
      statusCode: isNotFound ? 404 : 400,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 7. Restock Part Inventory
// -------------------------------------------------------------------------
inventoryRouter.post('/restock', authMiddleware, requireRole('SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const { partCode, quantity } = req.body;

    if (!partCode || typeof partCode !== 'string' || partCode.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'INVALID_PART_CODE',
        message: 'partCode is required.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'Quantity must be a positive integer.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const updatedPart = repo.restockPart(partCode, qty);

    res.status(200).json({
      success: true,
      data: updatedPart,
      message: `Successfully restocked ${qty} units of ${partCode}. New stock: ${updatedPart.stockQuantity}.`,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    const isNotFound = error.message && error.message.includes('does not exist');
    res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: isNotFound ? 'PART_NOT_FOUND' : 'RESTOCK_FAILED',
      message: error.message || 'Failed to restock part.',
      statusCode: isNotFound ? 404 : 400,
      timestamp: new Date().toISOString()
    });
  }
});
