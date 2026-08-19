/**
 * Trackside OMRS (Online Monitoring of Rolling Stock) AI Triage REST API Router
 * Indian Railways WRS Raipur (Phase 3 - M1 / R5)
 */

import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { optionalAuthMiddleware } from '../middleware/auth.ts';
import { getDatabase } from '../db/connection.ts';
import { OMRSRepository } from '../db/omrsRepository.ts';
import { InventoryRepository } from '../db/inventoryRepository.ts';

export const omrsRouter = Router();

function getRepos() {
  const db = getDatabase();
  const omrsRepo = new OMRSRepository(db);
  const inventoryRepo = new InventoryRepository(db);
  return { omrsRepo, inventoryRepo };
}

// -------------------------------------------------------------------------
// 1. List Recent Trackside OMRS Telemetry Scans
// -------------------------------------------------------------------------
omrsRouter.get('/scans', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { omrsRepo } = getRepos();
    const limit = Number(req.query?.limit) || 50;
    const scans = omrsRepo.getRecentScans(limit);

    res.status(200).json({
      success: true,
      data: scans,
      meta: {
        total: scans.length,
        limit,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SCANS_FETCH_FAILED',
      message: error.message || 'Failed to retrieve OMRS scans.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 2. Get OMRS Telemetry Scans for Specific Wagon
// -------------------------------------------------------------------------
omrsRouter.get('/scans/:wagonNumber', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { omrsRepo } = getRepos();
    const { wagonNumber } = req.params;
    const scan = omrsRepo.getScanByWagon(wagonNumber);

    if (!scan) {
      res.status(404).json({
        success: false,
        error: 'SCAN_NOT_FOUND',
        message: `No OMRS telemetry scan found for wagon '${wagonNumber}'.`,
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: scan,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SCAN_FETCH_FAILED',
      message: error.message || 'Failed to retrieve wagon scan.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 3. Simulate Trackside OMRS Sensor Scan
// -------------------------------------------------------------------------
omrsRouter.post('/simulate-scan', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { omrsRepo } = getRepos();
    const {
      wagonNumber,
      trainSpeedKmph,
      wheelImpactKn,
      acousticBearingPeakDb,
      temperatureCelsius,
      wheelProfileDeviationMm,
      location,
      predictedDefects,
      triageSeverity
    } = req.body;

    if (!wagonNumber || typeof wagonNumber !== 'string' || wagonNumber.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'INVALID_WAGON_NUMBER',
        message: 'wagonNumber is required.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const scan = omrsRepo.recordScan({
      wagonNumber,
      trainSpeedKmph,
      wheelImpactKn,
      acousticBearingPeakDb,
      temperatureCelsius,
      wheelProfileDeviationMm,
      location,
      predictedDefects,
      triageSeverity
    });

    res.status(201).json({
      success: true,
      data: scan,
      message: `Trackside OMRS telemetry scan recorded for wagon ${wagonNumber}.`,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SIMULATION_FAILED',
      message: error.message || 'Failed to simulate OMRS scan.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 4. Run AI Triage and Auto-Reserve Parts for Wagon
// -------------------------------------------------------------------------
omrsRouter.post('/triage/:wagonNumber', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { omrsRepo, inventoryRepo } = getRepos();
    const { wagonNumber } = req.params;

    if (!wagonNumber || typeof wagonNumber !== 'string' || wagonNumber.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'INVALID_WAGON_NUMBER',
        message: 'wagonNumber is required.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const result = omrsRepo.runAITriage(wagonNumber, inventoryRepo);

    res.status(200).json({
      success: true,
      data: result,
      message: result.triageSummary,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'TRIAGE_FAILED',
      message: error.message || 'Failed to execute OMRS AI triage.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});
