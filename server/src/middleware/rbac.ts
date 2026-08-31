/**
 * Role-Based Access Control (RBAC) Guard Middleware
 * Indian Railways WRS Raipur
 */

import type { Response, NextFunction } from '../framework/index.ts';
import type { AuthenticatedRequest } from './auth.ts';
import { hasMinimumRole } from '../auth/rbac.ts';
import { can } from '../../../shared/auth/permissions.ts';
import type { Capability } from '../../../shared/auth/permissions.ts';
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

/**
 * Guards a route by what the act IS, rather than by how senior the caller is.
 *
 * requireRole below asks "are you this rank or above", which let an ADMIN
 * through every SUPERVISOR gate — including certifying a wagon fit to run.
 * This asks whether the role holds the named capability, so a role that does
 * not hold it is refused however senior it is.
 *
 * New routes should use this. requireRole remains for the routes still
 * expressed in ranks, and both now agree on how a role name is spelled.
 */
export function requireCapability(capability: Capability) {
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

    if (!can(req.user.role, capability)) {
      res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        // Names the act, not the rank. "Requires minimum role: SUPERVISOR"
        // invited the reading that a more senior role would do instead.
        message: `Your role (${req.user.role}) does not carry the authority to ${capability.replace('.', ' ')}.`,
        statusCode: 403,
        timestamp: new Date().toISOString()
      });
      return;
    }

    next();
  };
}
