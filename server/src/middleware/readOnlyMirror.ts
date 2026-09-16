/**
 * The read-only mirror — the DRM's view from anywhere, without the live system leaving the shop
 * Indian Railways WRS Raipur
 *
 * The DRM sits at division headquarters, not in the shop. The live system
 * must stay on the shop's PC (the bay has no reliable internet, and "the
 * data lives in our building" is the answer that ends the residency
 * conversation). So a second copy of the software runs where the DRM is,
 * holding nothing but a restored copy of the newest encrypted backup, and
 * this middleware makes that copy unable to write anything a person could
 * mistake for the record.
 *
 * WRS_READ_ONLY_MIRROR=true: every request that is not a read is refused
 * with 403 READ_ONLY_MIRROR, except signing in and out — accounts and
 * passwords come with the restored database, so the DRM's own login works.
 * The health endpoint says it is a mirror and when it was restored, and the
 * client shows a banner. scripts/mirror-refresh.mjs keeps it current.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from '../framework/index.ts';
import { currentDatabasePath } from '../db/connection.ts';

export const MIRROR_STATE_FILE = 'mirror-restored.json';

export function isReadOnlyMirror(): boolean {
  return process.env.WRS_READ_ONLY_MIRROR === 'true';
}

export function mirrorState(): { readOnly: boolean; restoredAt: string | null; sourceKey: string | null; sourceBucket: string | null } {
  if (!isReadOnlyMirror()) return { readOnly: false, restoredAt: null, sourceKey: null, sourceBucket: null };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(path.dirname(currentDatabasePath()), MIRROR_STATE_FILE), 'utf8'));
    return { readOnly: true, restoredAt: j.restoredAt ?? null, sourceKey: j.sourceKey ?? null, sourceBucket: j.sourceBucket ?? null };
  } catch {
    return { readOnly: true, restoredAt: null, sourceKey: null, sourceBucket: null };
  }
}

const ALLOWED_WRITES = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/refresh']);

export function readOnlyMirror() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isReadOnlyMirror()) { next(); return; }
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') { next(); return; }
    const url = String(req.url || '').split('?')[0];
    if (ALLOWED_WRITES.has(url)) { next(); return; }
    res.status(403).json({
      success: false,
      error: 'READ_ONLY_MIRROR',
      message: 'This is a read-only mirror of the workshop\'s record, restored from its latest backup. Nothing can be recorded here; the shop\'s own system is where work is done.',
      statusCode: 403,
      timestamp: new Date().toISOString()
    });
  };
}
