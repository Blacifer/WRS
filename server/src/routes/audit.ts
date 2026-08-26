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
import {
  certificatePublicKeyPem,
  certificateKeyFingerprint,
  SIGNATURE_ALGORITHM
} from '../reports/certificateSigning.ts';
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

// ---------------------------------------------------------------------------
// GET /api/audit/certificate-key
//
// The public half of the certificate signing key.
//
// Deliberately unauthenticated. A signature nobody outside this server can
// check is not much of a signature, and the whole reason for signing release
// certificates with an asymmetric scheme is so that a reviewer, an auditor or
// a railway receiving a wagon can verify one without being given the ability
// to issue one. Requiring a login to fetch a public key would put the gate
// back exactly where it does no good.
//
// Publishing this key allows verification and nothing else. It cannot sign.
// ---------------------------------------------------------------------------
auditRouter.get('/certificate-key', (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        algorithm: SIGNATURE_ALGORITHM,
        publicKeyPem: certificatePublicKeyPem(),
        fingerprint: certificateKeyFingerprint(),
        howToVerify:
          'Signatures are over the certificate\'s canonical summary JSON, base64-encoded ' +
          'after the algorithm prefix. Verify with any Ed25519 implementation using the key above.'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'CERT_KEY_UNAVAILABLE',
      message: error?.message || 'The certificate signing key could not be read',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});
