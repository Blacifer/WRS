/**
 * Role-Based Access Control (RBAC) Matrix
 * Indian Railways WRS Raipur
 */

import type { UserRole } from '../../../shared/types.ts';

export const ROLE_HIERARCHY: Record<string, number> = {
  INSPECTOR: 1,
  Inspector: 1,
  SUPERVISOR: 2,
  Supervisor: 2,
  ADMIN: 3,
  Admin: 3
};

export function hasMinimumRole(userRole: UserRole | string, requiredRole: UserRole | string): boolean {
  const userLevel = ROLE_HIERARCHY[userRole] || 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
  return userLevel >= requiredLevel;
}

export function isSupervisorOrAdmin(userRole: UserRole | string): boolean {
  return hasMinimumRole(userRole, 'SUPERVISOR');
}

export function isAdmin(userRole: UserRole | string): boolean {
  return hasMinimumRole(userRole, 'ADMIN');
}
