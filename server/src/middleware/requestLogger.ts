/**
 * Request Logger Middleware
 * Indian Railways WRS Raipur
 */

import type { Request, Response, NextFunction } from '../framework/index.ts';
import crypto from 'node:crypto';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', requestId as string);

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Silent in testing/production unless debug enabled
  });

  next();
}
