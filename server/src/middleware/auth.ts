/**
 * Authentication Middleware
 * Indian Railways WRS Raipur
 */

import type { Request, Response, NextFunction } from '../framework/index.ts';
import { verifyToken } from '../auth/jwt.ts';
import type { JwtPayload } from '../auth/jwt.ts';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Authentication token is missing or malformed',
      statusCode: 401,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const token = authHeader.substring(7).trim();
  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Authentication token is invalid or expired',
      statusCode: 401,
      timestamp: new Date().toISOString()
    });
    return;
  }

  req.user = payload;
  next();
}

/**
 * Optional authentication: attaches user if token is present and valid, but does not block if missing
 */
export function optionalAuthMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
    }
  }
  next();
}
