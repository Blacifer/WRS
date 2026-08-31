/**
 * Role-Based Access Control (RBAC) Matrix
 * Indian Railways WRS Raipur
 */

import type { UserRole } from '../../../shared/types.ts';

export const ROLE_HIERARCHY: Record<string, number> = {
  INSPECTOR: 1,
  SUPERVISOR: 2,
  ADMIN: 3
};

/**
 * Reduces however a role was written to the one spelling this file knows.
 *
 * The role type carried six spellings for three roles — INSPECTOR and
 * Inspector and so on — and every check was a case-sensitive object lookup
 * against a table that listed only some of them. A user stored as "admin"
 * scored zero and was refused everything, with a 403 that named a role they
 * appeared to hold. That failure is safe, which is precisely why it would
 * have survived to a real roster: the demo accounts are all uppercase, so
 * nothing would have shown it until somebody typed a name by hand.
 *
 * Unknown values still score zero and are still refused. The change is that
 * "Admin", "admin" and "ADMIN" now resolve to the same thing instead of
 * three different ones.
 */
export function normaliseRole(role: UserRole | string | null | undefined): string {
  return String(role ?? '').trim().toUpperCase();
}

export function hasMinimumRole(userRole: UserRole | string, requiredRole: UserRole | string): boolean {
  const userLevel = ROLE_HIERARCHY[normaliseRole(userRole)] || 0;
  const requiredLevel = ROLE_HIERARCHY[normaliseRole(requiredRole)] || 0;
  // A required role this table does not know must never be satisfiable —
  // otherwise a typo in a requireRole() call would open the route to
  // everyone, since every user would clear a requirement of zero.
  if (requiredLevel === 0) return false;
  return userLevel >= requiredLevel;
}

export function isSupervisorOrAdmin(userRole: UserRole | string): boolean {
  return hasMinimumRole(userRole, 'SUPERVISOR');
}

export function isAdmin(userRole: UserRole | string): boolean {
  return hasMinimumRole(userRole, 'ADMIN');
}
