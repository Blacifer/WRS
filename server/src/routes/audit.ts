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
import { requireRole, requireCapability } from '../middleware/rbac.ts';

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
// GET /api/audit/activity
//
// The ledger, readable.
//
// Everything this system does has been written to inspection_audit_log since
// the beginning — wagon registrations, stage moves, every checklist item
// touched, gate sign-offs, logins, overrides, exports. None of it was ever
// readable from inside the app. "History & Logs" queried the inspections
// table alone, so it could only ever show springs, which is precisely what
// was reported: "history and logs just talks about the springs."
//
// Requires audit.read — supervisors, administrators and the DRM. An inspector
// cannot read the record of who did what, which is the same boundary the
// chain-verification endpoint above draws and for the same reason.
// ---------------------------------------------------------------------------
auditRouter.get(
  '/activity',
  authMiddleware,
  requireCapability('audit.read'),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      const q = req.query || {};

      // Bounded so that a wide date range cannot pull the whole ledger into
      // one response on a shop-floor tablet.
      const limit = Math.min(Math.max(parseInt(String(q.limit || '100'), 10) || 100, 1), 500);
      const offset = Math.max(parseInt(String(q.offset || '0'), 10) || 0, 0);

      const where: string[] = [];
      const params: any[] = [];

      if (q.eventType) {
        where.push('a.event_type = ?');
        params.push(String(q.eventType));
      }
      if (q.actor) {
        where.push('a.user_id = ?');
        params.push(String(q.actor));
      }
      if (q.role) {
        where.push('a.user_role = ?');
        params.push(String(q.role).toUpperCase());
      }
      if (q.since) {
        where.push('a.created_at >= ?');
        params.push(String(q.since));
      }
      if (q.until) {
        where.push('a.created_at <= ?');
        params.push(String(q.until));
      }
      if (q.search) {
        // Across the payload, so searching a wagon number finds every event
        // that touched it regardless of which field the writer put it in.
        where.push('(a.payload_json LIKE ? OR a.user_id LIKE ?)');
        const like = `%${String(q.search)}%`;
        params.push(like, like);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const rows = db.prepare(`
        SELECT
          a.id, a.inspection_id, a.event_type, a.user_id, a.user_role,
          a.ip_address, a.payload_json, a.created_at,
          u.full_name AS actor_name, u.employee_id AS actor_employee_id
        FROM inspection_audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        ${whereSql}
        ORDER BY a.created_at DESC, a.rowid DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as any[];

      const totalRow = db.prepare(`
        SELECT COUNT(*) AS n FROM inspection_audit_log a ${whereSql}
      `).get(...params) as { n: number };

      res.status(200).json({
        success: true,
        data: {
          entries: rows.map(r => ({
            id: r.id,
            eventType: r.event_type,
            inspectionId: r.inspection_id,
            actorId: r.user_id,
            actorName: r.actor_name || r.user_id,
            actorEmployeeId: r.actor_employee_id || null,
            actorRole: r.user_role,
            // Null where the deployment genuinely could not determine one.
            // Shown as "not recorded" rather than filled in with a guess.
            ipAddress: r.ip_address || null,
            occurredAt: r.created_at,
            detail: safeParse(r.payload_json)
          })),
          total: totalRow?.n ?? 0,
          limit,
          offset
        },
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: 'AUDIT_ACTIVITY_FAILED',
        message: error?.message || 'Activity log could not be read',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }
  }
);

function safeParse(json: string): any {
  try {
    return JSON.parse(json || '{}');
  } catch {
    // A payload that will not parse is itself worth seeing, not swallowed.
    return { unparsed: json };
  }
}

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
