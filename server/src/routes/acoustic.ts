/**
 * Smart Acoustic Bearing & Pneumatic Leak Detection REST API Router
 * Indian Railways WRS Raipur (Phase 3 - M5 / R3)
 */

import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { getDatabase } from '../db/connection.ts';
import { WagonRepository } from '../db/wagonRepository.ts';
import type { AcousticAnomalyType, CASNUBCategory } from '../../../shared/types.ts';

export const acousticRouter = Router();

function getRepo() {
  const db = getDatabase();
  return new WagonRepository(db);
}

// -------------------------------------------------------------------------
// 1. Process & Log Real-Time Acoustic Diagnostic Telemetry
// -------------------------------------------------------------------------
/*
 * Reading this system requires an account.
 *
 * These routes were mounted on optionalAuthMiddleware, which takes a token
 * when one is offered and proceeds perfectly happily when none is. The effect
 * was that everything readable here was readable by anyone who could reach
 * the server: the wagon list, every checklist, every spring measurement with
 * the inspector's name against it, the component ledger, the stores, and — the
 * worst of them — /api/inspections/export, which handed over the entire
 * inspection record as a CSV to a caller with no account.
 *
 * That last one also shows why "optional" auth is the wrong shape for a read
 * gate. The export's protections (no inspectors, and a second factor for
 * anyone enrolled) were all written inside `if (req.user)`, so sending no
 * credentials at all skipped every one of them. A check that only runs for
 * people who identified themselves is not a check.
 */

acousticRouter.post('/diagnose', authMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
    const {
      wagonNumber,
      dominantFrequencyHz,
      peakDb,
      anomalyType,
      confidence,
      details,
      targetCategory,
      targetPartName
    } = req.body || {};

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

    const validAnomalyTypes: AcousticAnomalyType[] = ['NONE', 'AIR_LEAK', 'BEARING_DEFECT'];
    if (!anomalyType || !validAnomalyTypes.includes(anomalyType as AcousticAnomalyType)) {
      res.status(400).json({
        success: false,
        error: 'INVALID_ANOMALY_TYPE',
        message: `anomalyType must be one of: ${validAnomalyTypes.join(', ')}`,
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const freq = Number(dominantFrequencyHz);
    if (isNaN(freq) || freq < 0) {
      res.status(400).json({
        success: false,
        error: 'INVALID_FREQUENCY',
        message: 'dominantFrequencyHz must be a positive number.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const dbVal = Number(peakDb);
    if (isNaN(dbVal)) {
      res.status(400).json({
        success: false,
        error: 'INVALID_PEAK_DB',
        message: 'peakDb must be a valid number.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const inspectorId = (req as any).user?.id || 'usr_insp_001';

    const result = repo.recordAcousticDiagnostic({
      wagonNumber,
      dominantFrequencyHz: freq,
      peakDb: dbVal,
      anomalyType: anomalyType as AcousticAnomalyType,
      confidence: confidence ? Number(confidence) : undefined,
      details,
      targetCategory: targetCategory as CASNUBCategory,
      targetPartName,
      inspectorId
    });

    res.status(200).json({
      success: true,
      data: result,
      message: anomalyType === 'NONE'
        ? `Acoustic diagnostic for wagon ${wagonNumber} nominal.`
        : `Acoustic anomaly [${anomalyType}] flagged and logged against exit gate blockers for wagon ${wagonNumber}.`,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'ACOUSTIC_DIAGNOSE_FAILED',
      message: error.message || 'Failed to process acoustic diagnostic.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 2. Query Acoustic Diagnostic History for Wagon
// -------------------------------------------------------------------------
acousticRouter.get('/history/:wagonNumber', authMiddleware, async (req: Request, res: Response) => {
  try {
    const repo = getRepo();
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

    const records = repo.getAcousticDiagnostics(wagonNumber);

    res.status(200).json({
      success: true,
      data: records,
      meta: {
        wagonNumber,
        count: records.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'ACOUSTIC_HISTORY_FAILED',
      message: error.message || 'Failed to retrieve acoustic history.',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});
