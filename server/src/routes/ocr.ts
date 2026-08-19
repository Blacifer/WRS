/**
 * Caliper OCR and Measurement Input Routes
 * Indian Railways WRS Raipur
 */

import { Router } from '../framework/index.ts';
import type { Request, Response, NextFunction } from '../framework/index.ts';
import { ocrEngine } from '../ocr/engine.ts';
import { optionalAuthMiddleware } from '../middleware/auth.ts';

export const ocrRouter = Router();

/**
 * POST /api/ocr/read-caliper
 * Accepts { imageBase64: string } or { imageText: string } or raw buffer
 */
ocrRouter.post('/read-caliper', optionalAuthMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { imageBase64, imageText, image } = req.body || {};
    const input = imageBase64 || imageText || image;

    if (!input) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'imageBase64 or imageText is required in request body',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const result = await ocrEngine.readCaliperImage(input);

    res.status(200).json({
      success: true,
      data: result,
      ...result,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ocr/validate-manual
 * Validates manual input value against physical limits (100 - 500mm)
 */
ocrRouter.post('/validate-manual', optionalAuthMiddleware, (req: Request, res: Response, next: NextFunction): void => {
  try {
    const { value } = req.body || {};
    const result = ocrEngine.validateManualInput(value);

    if (!result.valid) {
      res.status(400).json({
        success: false,
        error: 'INVALID_MEASUREMENT',
        message: result.error || 'Invalid measurement value',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        value: result.value,
        valid: true
      },
      value: result.value,
      valid: true
    });
  } catch (error) {
    next(error);
  }
});
