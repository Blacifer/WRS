/**
 * Centralized Global Error Handler Middleware
 * Indian Railways WRS Raipur
 */

import type { Request, Response, NextFunction } from '../framework/index.ts';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  const timestamp = new Date().toISOString();
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  // Handle SQLite Trigger Immutability Error
  if (message.includes('Audit log is strictly append-only') || message.includes('immutable')) {
    res.status(405).json({
      success: false,
      error: 'IMMUTABLE_LOG_VIOLATION',
      message: 'Inspection records are strictly immutable per RDSO audit policy. Updates and deletions are prohibited.',
      statusCode: 405,
      timestamp
    });
    return;
  }

  // Handle Validation Errors
  if (err.name === 'ValidationError' || message.includes('Invalid classification request')) {
    res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message,
      statusCode: 400,
      timestamp
    });
    return;
  }

  // Generic Error
  res.status(statusCode).json({
    success: false,
    error: err.code || 'INTERNAL_ERROR',
    message,
    statusCode,
    timestamp
  });
}
