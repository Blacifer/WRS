/**
 * Spring Classification Route Handler
 * Indian Railways WRS Raipur
 */

import { Router } from '../framework/index.ts';
import type { Request, Response, NextFunction } from '../framework/index.ts';
import { classifySpring } from '../../../shared/classification/engine.ts';
import type { ClassificationRequest } from '../../../shared/types.ts';

export const classifyRouter = Router();

function handleClassification(req: Request, res: Response, next: NextFunction): void {
  try {
    const body = req.body as ClassificationRequest;

    if (!body || !body.bogieType || !body.condition || !body.position || body.measuredHeight === undefined) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Missing required classification fields: bogieType, condition, position, measuredHeight',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const result = classifySpring({
      bogieType: body.bogieType,
      condition: body.condition,
      position: body.position,
      measuredHeight: Number(body.measuredHeight),
      damageType: body.damageType || 'NONE',
      damageNotes: body.damageNotes
    });

    res.status(200).json({
      success: true,
      data: result,
      // For backward compatibility with tests expecting direct result or data envelope
      ...result,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
}

classifyRouter.post('/classify', handleClassification);
classifyRouter.post('/classification/classify', handleClassification);
