/**
 * Role-Based Access Control (RBAC) Guard Middleware
 * Indian Railways WRS Raipur
 */

import type { Response, NextFunction } from '../framework/index.ts';
import type { AuthenticatedRequest } from './auth.ts';
import { hasMinimumRole } from '../auth/rbac.ts';
import type { UserRole } from '../../../shared/types.ts';

export function requireRole(requiredRole: UserRole | string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required for this operation',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!hasMinimumRole(req.user.role, requiredRole)) {
      res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: `Insufficient permissions. Requires minimum role: ${requiredRole}`,
        statusCode: 403,
        timestamp: new Date().toISOString()
      });
      return;
    }

    next();
  };
}
