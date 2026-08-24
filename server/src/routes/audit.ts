/**
 * Audit Chain Verification API
 * Indian Railways WRS Raipur
 *
 * The system's central claim to the DRM is that nothing can be quietly
 * changed after the fact. Append-only triggers enforce that through the
 * application; the SHA-256 chain is what catches tampering that went around
 * it. This endpoint is where that claim becomes checkable rather than
 * asserted — someone can ask, at any moment, whether the ledger still adds up.
 */

import { Router } from '../framework/index.ts';
import type { Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import { verifyAuditChain } from '../db/auditLog.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireRole } from '../middleware/rbac.ts';

export const auditRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/audit/verify
//
// Restricted to SUPERVISOR and above. Whether the audit trail is intact is
// itself sensitive: an inspector who could poll this would learn immediately
// whether an alteration had been noticed.
// ---------------------------------------------------------------------------
auditRouter.get(
  '/verify',
  authMiddleware,
  requireRole('SUPERVISOR'),
  (_req: AuthenticatedRequest, res: Response) => {
    try {
      const result = verifyAuditChain(getDatabase());

      res.status(200).json({
        success: true,
        data: {
          ...result,
          // A one-line reading for the dashboard, so the answer does not
          // depend on the reader interpreting the fields correctly.
          summary: result.verified
            ? `Audit chain verified — ${result.entriesChecked} entries, unbroken.`
            : `Audit chain BROKEN — ${result.breaksFound} of ${result.entriesChecked} entries ` +
              `fail verification. First at entry ${result.firstBrokenAt?.id} ` +
              `(${result.firstBrokenAt?.reason}).`
        },
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: 'AUDIT_VERIFY_FAILED',
        message: error?.message || 'Audit chain verification could not be completed',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }
  }
);
