/**
 * Wagon Lifecycle, Checklist & Exit Gate API Router
 * Indian Railways WRS Raipur (Phase 2)
 */

import crypto from 'node:crypto';
import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';
import { can } from '../../../shared/auth/permissions.ts';
import { getDatabase } from '../db/connection.ts';
import { logAuditEvent } from '../db/auditLog.ts';
import { WagonRepository } from '../db/wagonRepository.ts';
import { WheelRepository } from '../db/wheelRepository.ts';
import { InspectionRepository } from '../db/repository.ts';
import { LifecycleEngine } from '../lifecycle/engine.ts';
import { ExitGateValidator } from '../gate/validator.ts';
import { parseClaimedSource } from '../../../shared/vision/autoCommit.ts';
import { labelForPart } from '../../../shared/vision/knn.ts';
import { judgeAutoCommit, recordAutoDecision, type GateResult } from '../vision/serverBrain.ts';
import { CertificateGenerator } from '../reports/certificate.ts';
import { buildPassport, verifyPassport } from '../reports/wagonPassport.ts';
import { otpService } from '../auth/otpService.ts';
import { TotpService } from '../auth/totpService.ts';
import { verifySecondFactor } from '../auth/secondFactor.ts';
import type { LifecycleStage } from '../../../shared/types.ts';

export const wagonsRouter = Router();

function getRepos() {
  const db = getDatabase();
  const wagonRepo = new WagonRepository(db);
  const inspectionRepo = new InspectionRepository(db);
  return { wagonRepo, inspectionRepo };
}

// -------------------------------------------------------------------------
// 1. Wagon Intake & Registration (Stage 1)
// -------------------------------------------------------------------------

/*
 * Reading this system requires an account.
 *
 * These routes were mounted on optionalAuthMiddleware, which takes a token
 * when one is offered and proceeds perfectly happily when none is. The effect
 * was that everything readable here was readable by anyone who could reach
 * the server: the wagon list, every checklist, every spring measurement with
 * the inspector's name against it, the component ledger, the stores, and — the
 * worst of them — /api/inspections/export, which handed over the entire
 * inspection record as a CSV to a caller with no account.
 *
 * That last one also shows why "optional" auth is the wrong shape for a read
 * gate. The export's protections (no inspectors, and a second factor for
 * anyone enrolled) were all written inside `if (req.user)`, so sending no
 * credentials at all skipped every one of them. A check that only runs for
 * people who identified themselves is not a check.
 */

/** A date, or null for absent, or false for something that is not a date. */
function parseTargetDate(raw: unknown): string | null | false {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  // A bare date is taken as the end of that working day, Indian time, so a
  // wagon due "on the 20th" is not counted late at one minute past midnight.
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T17:00:00+05:30`).toISOString() : new Date(t).toISOString();
}

// ---------------------------------------------------------------------------
// PUT /:wagonNumber/target-release-date
//
// Set or change when a wagon is due out. A supervisor's call, not an
// inspector's; on the audit trail, because moving a date is how a late wagon
// stops looking late.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// POST /api/wagons/:wagonNumber/void — registered in error.
//
// Nothing is deleted. A supervisor, under a one-time code, with a reason,
// marks a wagon that is still at entry with nothing recorded against it.
// The pipeline stops showing it; the row and the audit entry remain. Filed
// as a supervisor override because that is what it is.
// ---------------------------------------------------------------------------
wagonsRouter.post('/:wagonNumber/void', authMiddleware, requireCapability('wagon.override'), (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = decodeURIComponent(String(req.params.wagonNumber || '')).trim().toUpperCase();
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const user = (req as AuthenticatedRequest).user!;
  if (reason.length < 5) { res.status(400).json({ success: false, error: 'REASON_REQUIRED', message: 'Say why this wagon was registered in error (at least five characters).', statusCode: 400, timestamp: new Date().toISOString() }); return; }
  const token = req.body?.otpToken || req.body?.otp;
  if (!token || !otpService.consumeActionToken(String(token), 'OVERRIDE', user.id)) {
    res.status(401).json({ success: false, error: 'INVALID_OTP_TOKEN', message: 'Marking a wagon as registered in error needs the supervisor\'s one-time code.', statusCode: 401, timestamp: new Date().toISOString() });
    return;
  }
  const r = wagonRepo.voidWagon(wagonNumber, { id: user.id, name: user.name || user.username || user.id }, reason.slice(0, 500));
  if (!r.ok) { res.status(409).json({ success: false, error: 'CANNOT_VOID', message: r.reason, statusCode: 409, timestamp: new Date().toISOString() }); return; }
  logAuditEvent(getDatabase(), {
    eventType: 'SUPERVISOR_OVERRIDE_RECORDED',
    userId: user.id,
    userRole: user.role ?? undefined,
    payload: { kind: 'WAGON_REGISTERED_IN_ERROR', wagonNumber, reason: reason.slice(0, 500) }
  });
  res.status(200).json({ success: true, data: wagonRepo.getWagonByNumber(wagonNumber), meta: { timestamp: new Date().toISOString() } });
});

wagonsRouter.put('/:wagonNumber/target-release-date', authMiddleware, requireCapability('wagon.release'), async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = String(req.params?.wagonNumber || '').trim().toUpperCase();
  const target = parseTargetDate(req.body?.targetReleaseDate);
  if (target === false) {
    res.status(400).json({ success: false, error: 'INVALID_TARGET_DATE', message: 'targetReleaseDate must be a date, or null to clear it.', statusCode: 400, timestamp: new Date().toISOString() });
    return;
  }
  const wagon = wagonRepo.getWagonByNumber(wagonNumber);
  if (!wagon) {
    res.status(404).json({ success: false, error: 'WAGON_NOT_FOUND', message: `Wagon ${wagonNumber} was not found.`, statusCode: 404, timestamp: new Date().toISOString() });
    return;
  }
  const before = wagon.targetReleaseDate ?? null;
  getDatabase().prepare('UPDATE wagons SET target_release_date = ?, updated_at = ? WHERE id = ?').run(target, new Date().toISOString(), wagon.id);
  /*
   * Filed as a supervisor override, with the kind in the payload. The audit
   * table's event vocabulary is a CHECK constraint on an append-only,
   * hash-chained table; widening it means rebuilding that table, which is
   * not a thing to do for a date field. A supervisor moving a wagon's due
   * date is, in substance, a supervisory decision overriding the plan the
   * wagon was registered with — and it is on the chain either way.
   */
  logAuditEvent(getDatabase(), {
    eventType: 'SUPERVISOR_OVERRIDE_RECORDED',
    userId: (req as AuthenticatedRequest).user!.id,
    userRole: (req as AuthenticatedRequest).user?.role ?? undefined,
    payload: { kind: 'TARGET_RELEASE_DATE', wagonNumber, before, after: target, reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null }
  });
  res.status(200).json({ success: true, data: wagonRepo.getWagonByNumber(wagonNumber), meta: { timestamp: new Date().toISOString() } });
});

// ---------------------------------------------------------------------------
// The wagon passport. See server/src/reports/wagonPassport.ts.
//
// GET  /:wagonNumber/passport         — the sealed file, for the wagon to carry
// POST /passports/import              — a file from another shop, verified and kept
// GET  /:wagonNumber/passports        — what previous shops sealed for this wagon
// ---------------------------------------------------------------------------
wagonsRouter.get('/:wagonNumber/passport', authMiddleware, requireCapability('certificate.export'), async (req: Request, res: Response) => {
  const wagonNumber = String(req.params?.wagonNumber || '').trim().toUpperCase();
  const user = (req as AuthenticatedRequest).user!;
  try {
    const jsonl = buildPassport(getDatabase(), wagonNumber, { id: user.id, name: user.name || user.username || user.id, role: user.role || '' });
    logAuditEvent(getDatabase(), {
      eventType: 'BATCH_EXPORTED',
      userId: user.id,
      userRole: user.role ?? undefined,
      payload: { kind: 'WAGON_PASSPORT', wagonNumber, lines: jsonl.split('\n').filter(Boolean).length }
    });
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${wagonNumber.replace(/[^A-Za-z0-9]+/g, '_')}.passport.jsonl"`);
    res.status(200).send(jsonl);
  } catch (err: any) {
    res.status(err?.message?.includes('not found') ? 404 : 500).json({ success: false, error: 'PASSPORT_FAILED', message: err?.message || 'Could not build the passport', statusCode: 500, timestamp: new Date().toISOString() });
  }
});

wagonsRouter.post('/passports/import', authMiddleware, requireCapability('wagon.release'), async (req: Request, res: Response) => {
  const text = typeof req.body?.passport === 'string' ? req.body.passport : '';
  if (!text.trim()) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'passport (the JSON Lines text of the file) is required.', statusCode: 400, timestamp: new Date().toISOString() });
    return;
  }
  const v = verifyPassport(text);
  if (!v.ok || !v.header || !v.seal) {
    // Refused, and every reason named. A file that does not verify is not a
    // passport; keeping it would be keeping a claim nobody vouched for.
    res.status(422).json({ success: false, error: 'PASSPORT_NOT_VERIFIED', message: `The passport did not verify: ${v.reasons.join(' ')}`, data: { reasons: v.reasons, header: v.header ? { wagonNumber: v.header.wagonNumber, issuer: { name: v.header.issuer?.name, keyFingerprint: v.header.issuer?.keyFingerprint } } : null }, statusCode: 422, timestamp: new Date().toISOString() });
    return;
  }
  const user = (req as AuthenticatedRequest).user!;
  const id = `wpp_${crypto.randomUUID()}`;
  try {
    getDatabase().prepare(`
      INSERT INTO wagon_passports (id, wagon_number, issuer_name, issuer_fingerprint, issued_by_this_server, exported_at, events, terminal_hash, passport_jsonl, imported_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, v.header.wagonNumber, v.header.issuer.name, v.header.issuer.keyFingerprint, v.issuedByThisServer ? 1 : 0, v.header.exportedAt, v.events.length, v.seal.terminalHash, text, user.id);
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE')) {
      res.status(200).json({ success: true, data: { alreadyImported: true, wagonNumber: v.header.wagonNumber, events: v.events.length, issuer: v.header.issuer.name, keyFingerprint: v.header.issuer.keyFingerprint, issuedByThisServer: v.issuedByThisServer }, meta: { timestamp: new Date().toISOString() } });
      return;
    }
    throw err;
  }
  logAuditEvent(getDatabase(), {
    eventType: 'INSPECTION_SYNCED',
    userId: user.id,
    userRole: user.role ?? undefined,
    payload: { kind: 'WAGON_PASSPORT_IMPORTED', id, wagonNumber: v.header.wagonNumber, issuer: v.header.issuer.name, keyFingerprint: v.header.issuer.keyFingerprint, issuedByThisServer: v.issuedByThisServer, events: v.events.length, terminalHash: v.seal.terminalHash }
  });
  res.status(201).json({ success: true, data: { id, alreadyImported: false, wagonNumber: v.header.wagonNumber, events: v.events.length, issuer: v.header.issuer.name, keyFingerprint: v.header.issuer.keyFingerprint, issuedByThisServer: v.issuedByThisServer, exportedAt: v.header.exportedAt }, meta: { timestamp: new Date().toISOString() } });
});

wagonsRouter.get('/:wagonNumber/passports', authMiddleware, requireCapability('wagon.view'), async (req: Request, res: Response) => {
  const wagonNumber = String(req.params?.wagonNumber || '').trim().toUpperCase();
  const rows = getDatabase().prepare(`
    SELECT p.*, u.full_name AS imported_by_name FROM wagon_passports p LEFT JOIN users u ON u.id = p.imported_by
    WHERE p.wagon_number = ? ORDER BY p.exported_at ASC
  `).all(wagonNumber) as any[];
  res.status(200).json({
    success: true,
    data: rows.map((r) => {
      // Re-verified on every read, so a row is never trusted on the strength of the flag it was stored with.
      const v = verifyPassport(r.passport_jsonl);
      return {
        id: r.id, wagonNumber: r.wagon_number, issuer: r.issuer_name, keyFingerprint: r.issuer_fingerprint, issuedByThisServer: r.issued_by_this_server === 1,
        exportedAt: r.exported_at, exportedBy: v.header?.exportedBy ?? null, events: v.events.map((e) => ({ seq: e.seq, kind: e.kind, at: e.at, payload: e.payload })),
        verifiesNow: v.ok, reasons: v.reasons, importedAt: r.created_at, importedBy: r.imported_by_name ?? r.imported_by
      };
    }),
    meta: { timestamp: new Date().toISOString() }
  });
});

/**
 * What a wagon number looks like: the shop's own form RAILWAY/TYPE/NUMBER
 * (SECR/BOXNHL/10492 — the type and number segments may carry letters and
 * hyphens), or the eleven-digit number painted on the wagon. The DRM's first
 * walk registered a wagon called ADSFADS and it was accepted; a record that
 * can never be matched to a wagon is worse than no record.
 */
export const WAGON_NUMBER_SHAPE = /^(?:[A-Z]{2,6}\/[A-Z0-9]{2,10}\/[A-Z0-9-]{1,12}|\d{11})$/;
export function normaliseWagonNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().toUpperCase().replace(/\s+/g, '').replace(/[\\]+/g, '/');
  return WAGON_NUMBER_SHAPE.test(n) ? n : null;
}

wagonsRouter.post('/register', authMiddleware, requireCapability('wagon.register'), async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const { wagonNumber, wagonType, owningRailway, entryNotes, conditionNotes, entryDate } = req.body;

  /*
   * The date the wagon is due out. The column has been in the schema since
   * the first migration and the repository has always stored it; this route
   * never read it from the body, so it was NULL on every wagon ever
   * registered, and "which wagon will miss its date" had nothing to work
   * from. Optional — the shop may not know at the gate — and refused rather
   * than guessed at if it is not a date.
   */
  const targetReleaseDate = parseTargetDate(req.body?.targetReleaseDate);
  if (targetReleaseDate === false) {
    res.status(400).json({
      success: false,
      error: 'INVALID_TARGET_DATE',
      message: 'targetReleaseDate must be a date (YYYY-MM-DD or ISO 8601), or omitted.',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (!wagonNumber || typeof wagonNumber !== 'string' || wagonNumber.trim() === '') {
    res.status(400).json({
      success: false,
      error: 'INVALID_WAGON_NUMBER',
      message: 'Wagon number is required and cannot be empty (e.g. NR/BOXNHL/12345).',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }
  if (!normaliseWagonNumber(wagonNumber)) {
    res.status(400).json({
      success: false,
      error: 'INVALID_WAGON_NUMBER',
      message: `"${String(wagonNumber).trim()}" is not a wagon number. Use RAILWAY/TYPE/NUMBER as painted on the wagon, e.g. SECR/BOXNHL/10492, or the 11-digit number.`,
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const existing = wagonRepo.getWagonByNumber(wagonNumber);
  if (existing) {
    res.status(409).json({
      success: false,
      error: 'WAGON_ALREADY_EXISTS',
      message: `Wagon ${wagonNumber} is already registered in the system.`,
      statusCode: 409,
      data: existing,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    // No demo-user fallback: a wagon registered by nobody in particular is a
    // record that cannot be defended later.
    if (!req.user?.id) {
      res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Wagon registration must be attributable to an authenticated user.',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
      return;
    }
    const createdBy = req.user.id;
    const wagon = wagonRepo.registerWagon({
      wagonNumber,
      wagonType: wagonType || 'BOXNHL',
      owningRailway: owningRailway || 'SECR',
      entryNotes,
      conditionNotes,
      entryDate,
      targetReleaseDate,
      createdBy
    });

    res.status(201).json({
      success: true,
      message: `Wagon ${wagon.wagonNumber} registered successfully in Stage 1 (ENTRY_REGISTRATION).`,
      data: wagon,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'REGISTRATION_FAILED',
      message: err.message || 'Failed to register wagon',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 2. Query Wagons List
// -------------------------------------------------------------------------

wagonsRouter.get('/', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const query = req.query || {};

  const page = parseInt(query.page || '1', 10);
  const limit = parseInt(query.limit || '50', 10);
  const stage = query.stage || query.currentStage;
  const wagonType = query.wagonType || query.wagon_type;
  const owningRailway = query.owningRailway || query.owning_railway;
  const status = query.status;
  const search = query.search || query.q;
  const sortBy = query.sortBy || query.sort_by;
  const sortOrder = query.sortOrder || query.sort_order;

  const result = wagonRepo.queryWagons({
    stage,
    wagonType,
    owningRailway,
    status,
    search,
    page,
    limit,
    sortBy,
    sortOrder
  });

  res.status(200).json({
    success: true,
    data: result.records,
    pagination: {
      page: result.page,
      limit: result.limit,
      totalCount: result.totalCount,
      totalPages: result.totalPages,
      hasNext: result.page < result.totalPages,
      hasPrev: result.page > 1
    },
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 3. Wagon Timeline & Duration History
// -------------------------------------------------------------------------

wagonsRouter.get('/:wagonNumber/timeline', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'Wagon number is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const timeline = wagonRepo.getWagonTimeline(wagonNumber);

  res.status(200).json({
    success: true,
    data: timeline,
    meta: {
      wagonNumber,
      totalTransitions: timeline.length,
      timestamp: new Date().toISOString()
    }
  });
});

// -------------------------------------------------------------------------
// 4. CASNUB Bogie Parts Checklist for Wagon
// -------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/wagons/:wagonNumber/checklist/history
//
// What each component was found as, before anybody worked on it.
//
// checklist_items is updated in place, so its `status` column ends up holding
// the OUTCOME — a part found cracked and then repaired reads REPAIRED, with
// no trace in that row of what it was found as. Any report built from the
// table alone therefore prints the same value under "found" and under "work
// done", which is not a before-and-after at all.
//
// The arrival state is in the audit log, which records previousStatus and
// newStatus on every checklist write. This reads it back per item, oldest
// first, so a caller can take the first recorded transition as the finding.
//
// Guarded by authMiddleware alone, like the checklist and wagon-detail routes
// beside it: this is the same information the checklist already shows, with
// its history attached. It is deliberately NOT behind audit.read — that
// capability gates the record of who did what across the whole workshop, and
// an inspector being unable to see what a part was found as would leave the
// report printing "not recorded" for the one role most likely to be standing
// at the wagon.
// ---------------------------------------------------------------------------
wagonsRouter.get('/:wagonNumber/checklist/history', authMiddleware, (req: Request, res: Response) => {
  const wagonNumber = (req.params?.wagonNumber || '').trim().toUpperCase();

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'wagonNumber parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    const db = getDatabase();

    /*
     * Filtered by SQLite, not by JavaScript.
     *
     * The wagon number lives inside payload_json rather than in a column, and
     * this first pulled EVERY checklist event ever written and picked out the
     * wagon's own here. On a year of records — 199,500 events — that took 3.6
     * seconds to find 35 rows, on a screen somebody opens while standing at a
     * wagon. json_extract in the WHERE clause, against the partial index on
     * the same expression, answers the same question in 0.3 ms.
     *
     * The comparison is on the normalised upper-case number because that is
     * what the payload stores; a wagon written any other way would not match
     * the index either.
     */
    const rows = db.prepare(`
      SELECT payload_json, created_at, user_id
      FROM inspection_audit_log
      WHERE event_type = 'CHECKLIST_ITEM_INSPECTED'
        AND json_extract(payload_json, '$.wagonNumber') = ?
      ORDER BY created_at ASC
    `).all(wagonNumber) as any[];

    const events: any[] = [];
    for (const r of rows) {
      // Still parsed defensively: one malformed payload must not cost the
      // whole history.
      let p: any;
      try { p = JSON.parse(r.payload_json); } catch { continue; }
      if (!p) continue;
      events.push({
        itemId: p.itemId,
        partName: p.partName,
        category: p.category,
        previousStatus: p.previousStatus ?? null,
        newStatus: p.newStatus ?? null,
        repairAction: p.repairAction ?? null,
        reinspectedStatus: p.reinspectedStatus ?? null,
        conditionNotes: p.conditionNotes ?? null,
        at: r.created_at,
        byUserId: r.user_id
      });
    }

    res.status(200).json({
      success: true,
      data: { wagonNumber, events },
      meta: { timestamp: new Date().toISOString(), count: events.length }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'HISTORY_FAILED',
      message: err.message || 'Failed to read checklist history',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

wagonsRouter.get('/:wagonNumber/checklist', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'Wagon number is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const checklistData = wagonRepo.getChecklistItems(wagonNumber);

  res.status(200).json({
    success: true,
    data: checklistData,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 5. Zero-Defect Exit Gate Status & Blocker Diagnostics
// -------------------------------------------------------------------------

wagonsRouter.get('/:wagonNumber/gate/status', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'wagonNumber parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const gateResult = ExitGateValidator.evaluate(wagonNumber, wagonRepo);

  res.status(200).json({
    success: true,
    data: gateResult,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 6. Printable / Exportable Official RDSO Release Certificate
// NOTE ON ORDERING: these must be registered before the bare
// `GET /:wagonNumber` route below. Wagon numbers contain slashes
// (SECR/BOXNHL/40101), so that param matches across path segments and will
// swallow `/:wagonNumber/swt` if it is registered first — which is exactly
// what happened, and why /checklist above works while this did not.
// -------------------------------------------------------------------------
// Single Wagon Test (air brake) — WMM 2.0 §720
// -------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wheels — the chalk on the wheel disc, kept and judged
//
// POST /:wagonNumber/wheels        one wheel's readings; judged at write time
// GET  /:wagonNumber/wheels        latest per wheel, the set-level variation
//                                  check, and the limits they were held to
//
// The wheel family — and so the limit table — comes from the wagon's
// designation. The caller sends readings, never limits. See
// shared/classification/wheelLimits.ts for the figures and their source.
// ---------------------------------------------------------------------------
wagonsRouter.get('/:wagonNumber/wheels', authMiddleware, async (req: Request, res: Response) => {
  const wagonNumber = req.params?.wagonNumber;
  if (!wagonNumber) { res.status(400).json({ success: false, error: 'MISSING_PARAM', message: 'wagonNumber is required', statusCode: 400, timestamp: new Date().toISOString() }); return; }
  try {
    const repo = new WheelRepository(getDatabase());
    res.status(200).json({ success: true, data: { ...repo.summary(wagonNumber), history: repo.history(wagonNumber) }, meta: { timestamp: new Date().toISOString() } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'WHEELS_READ_FAILED', message: err?.message || 'Could not read the wheel readings', statusCode: 500, timestamp: new Date().toISOString() });
  }
});

wagonsRouter.post('/:wagonNumber/wheels', authMiddleware, requireCapability('wagon.inspect'), async (req: Request, res: Response) => {
  const wagonNumber = req.params?.wagonNumber;
  const b = req.body || {};
  const user = (req as any).user;
  if (!wagonNumber) { res.status(400).json({ success: false, error: 'MISSING_PARAM', message: 'wagonNumber is required', statusCode: 400, timestamp: new Date().toISOString() }); return; }
  const axle = Number(b.axle);
  const side = String(b.side || '').toUpperCase();
  const tread = Number(b.treadDiameterMm);
  if (![1, 2, 3, 4].includes(axle) || !['L', 'R'].includes(side)) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'axle must be 1–4 and side L or R.', statusCode: 400, timestamp: new Date().toISOString() }); return;
  }
  if (!Number.isFinite(tread) || tread < 700 || tread > 1100) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'treadDiameterMm must be a number between 700 and 1100 — a wagon wheel, measured 66.5 mm from the rim face.', statusCode: 400, timestamp: new Date().toISOString() }); return;
  }
  // Limits are the registry's, not the caller's. Any attempt to send one is refused, not ignored.
  for (const k of ['condemnMm', 'lastShopIssueMm', 'limit', 'limits', 'verdict']) {
    if (k in b) { res.status(400).json({ success: false, error: 'LIMIT_NOT_ACCEPTED', message: `${k} is not accepted: the limits come from the wagon's wheel family, never from the reading.`, statusCode: 400, timestamp: new Date().toISOString() }); return; }
  }
  const opt = (k: string, lo: number, hi: number): number | null | 'bad' => {
    if (b[k] === undefined || b[k] === null || b[k] === '') return null;
    const n = Number(b[k]); return Number.isFinite(n) && n >= lo && n <= hi ? n : 'bad';
  };
  const reading = { treadDiameterMm: tread, flangeThicknessMm: opt('flangeThicknessMm', 5, 40), flangeHeightMm: opt('flangeHeightMm', 15, 45), rootRadiusMm: opt('rootRadiusMm', 5, 20), flatMm: opt('flatMm', 0, 200), hollowMm: opt('hollowMm', 0, 20) };
  const bad = Object.entries(reading).find(([, v]) => v === 'bad');
  if (bad) { res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: `${bad[0]} is outside a plausible range.`, statusCode: 400, timestamp: new Date().toISOString() }); return; }
  try {
    const result = new WheelRepository(getDatabase()).record({
      wagonNumber, axle, side, reading: reading as any, instrument: b.instrument ? String(b.instrument).slice(0, 40) : null, inspectorId: user.id, inspectorName: user.name
    });
    logAuditEvent(getDatabase(), {
      eventType: 'INSPECTION_CREATED', userId: user.id, userRole: user.role,
      payload: { action: 'WHEEL_READING', wagonNumber: wagonNumber.toUpperCase(), axle, side, treadDiameterMm: tread, verdict: result.judgement.verdict, readingId: result.row.id }
    });
    res.status(201).json({ success: true, data: result, meta: { timestamp: new Date().toISOString() } });
  } catch (err: any) {
    const status = err?.code === 'WAGON_NOT_FOUND' ? 404 : err?.code === 'UNKNOWN_ACTOR' ? 401 : 500;
    res.status(status).json({ success: false, error: err?.code || 'WHEEL_READING_FAILED', message: err?.message || 'Could not record the wheel reading', statusCode: status, timestamp: new Date().toISOString() });
  }
});

wagonsRouter.post('/:wagonNumber/swt', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;
  const b = req.body || {};
  const user = (req as any).user;

  if (!wagonNumber) {
    res.status(400).json({ success: false, error: 'MISSING_PARAM', message: 'wagonNumber is required', statusCode: 400, timestamp: new Date().toISOString() });
    return;
  }
  if (!user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'A single wagon test must name the person who carried it out.', statusCode: 401, timestamp: new Date().toISOString() });
    return;
  }
  if (!Array.isArray(b.readings)) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'readings[] is required — every proforma row must be answered.', statusCode: 400, timestamp: new Date().toISOString() });
    return;
  }

  try {
    const wagon = wagonRepo.getWagonByNumber(wagonNumber);
    const result = wagonRepo.recordSwt({
      wagonNumber,
      wagonType: b.wagonType || wagon?.wagonType || 'UNKNOWN',
      pipeType: b.pipeType === 'TWIN' ? 'TWIN' : 'SINGLE',
      loadCondition: b.loadCondition === 'LOADED' ? 'LOADED' : 'EMPTY',
      readings: b.readings,
      testedBy: user.id,
      testerName: user.name ?? null,
      notes: b.notes ?? null
    });
    res.status(201).json({ success: true, data: result, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(400).json({ success: false, error: 'SWT_FAILED', message: err?.message || 'Could not record the single wagon test', statusCode: 400, timestamp: new Date().toISOString() });
  }
});

wagonsRouter.get('/:wagonNumber/swt', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;
  if (!wagonNumber) {
    res.status(400).json({ success: false, error: 'MISSING_PARAM', message: 'wagonNumber is required', statusCode: 400, timestamp: new Date().toISOString() });
    return;
  }
  res.status(200).json({
    success: true,
    data: { latest: wagonRepo.getLatestSwt(wagonNumber), history: wagonRepo.getSwtHistory(wagonNumber) },
    timestamp: new Date().toISOString()
  });
});

// -------------------------------------------------------------------------

// A release certificate is a formal safety attestation, so this route requires
// a real authenticated user (was optionalAuthMiddleware — i.e. world-readable),
// refuses to issue for un-signed-off wagons unless a provisional preview is
// explicitly requested, and records every issuance in the audit chain.
wagonsRouter.get('/:wagonNumber/certificate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { wagonRepo, inspectionRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;
  const format = (req.query?.format || 'html').toLowerCase() === 'json' ? 'json' : 'html';
  const provisional = String(req.query?.provisional || '').toLowerCase() === 'true';

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'wagonNumber parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    // The QR on the printed certificate links back to this server's verify page.
    const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '');
    const proto = String(req.headers?.['x-forwarded-proto'] || (process.env.TLS_KEY_PATH ? 'https' : 'http'));
    const cert = CertificateGenerator.generate(
      wagonNumber, wagonRepo, inspectionRepo, undefined, format, { provisional, verifyBaseUrl: host ? `${proto}://${host}` : undefined }
    );

    // Uses the existing CERTIFICATE_GENERATED event type rather than adding new
    // ones: altering the audit table's CHECK constraint would mean rebuilding a
    // table that is append-only by trigger and carries the hash chain — not a
    // migration worth running on a live pilot database for a labelling nicety.
    // The issued/preview distinction is carried in the payload instead.
    logAuditEvent(getDatabase(), {
      id: `audit_cert_${crypto.randomUUID()}`,
      inspectionId: null,
      eventType: 'CERTIFICATE_GENERATED',
      userId: req.user?.id,
      userRole: req.user?.role,
      payload: {
        wagonNumber: wagonNumber.trim().toUpperCase(),
        format,
        provisional,
        documentType: provisional ? 'PROVISIONAL_PREVIEW' : 'RELEASE_CERTIFICATE'
      }
    });

    if (format === 'json') {
      res.status(200).json({
        success: true,
        data: cert.json,
        meta: { timestamp: new Date().toISOString() }
      });
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(cert.html);
    }
  } catch (err: any) {
    // A wagon that exists but has not been signed off is a 409, not a 404 —
    // the distinction matters because the client should offer a provisional
    // preview rather than reporting the wagon as missing.
    if (err?.name === 'CertificateNotAuthorized') {
      res.status(409).json({
        success: false,
        error: 'CERTIFICATE_NOT_AUTHORIZED',
        message: err.message,
        hint: 'Append ?provisional=true to view the current inspection state as a clearly-marked non-release document.',
        statusCode: 409,
        timestamp: new Date().toISOString()
      });
      return;
    }
    res.status(404).json({
      success: false,
      error: 'CERTIFICATE_NOT_FOUND',
      message: err.message || 'Certificate not available for this wagon',
      statusCode: 404,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 7. Wagon Master Detail with Timeline & Checklist
// -------------------------------------------------------------------------

wagonsRouter.get('/:wagonNumber', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo, inspectionRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'Wagon number parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const wagon = wagonRepo.getWagonByNumber(wagonNumber);
  if (!wagon) {
    res.status(404).json({
      success: false,
      error: 'WAGON_NOT_FOUND',
      message: `Wagon ${wagonNumber} was not found in the workshop system.`,
      statusCode: 404,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const timeline = wagonRepo.getWagonTimeline(wagonNumber);
  const checklistData = wagonRepo.getChecklistItems(wagonNumber);
  const gateEvaluation = wagonRepo.evaluateExitGate(wagonNumber);
  const photos = wagonRepo.getPhotosByWagon(wagonNumber);
  const springs = inspectionRepo.queryInspections({ wagonNumber, limit: 50 });

  res.status(200).json({
    success: true,
    data: {
      ...wagon,
      timeline,
      checklistSummary: {
        totalItems: checklistData.allItems.length,
        passedItems: checklistData.allItems.filter((i: any) => i.status === 'PASS').length,
        failedItems: checklistData.allItems.filter((i: any) => i.status === 'FAIL').length,
        condemnedItems: checklistData.allItems.filter((i: any) => i.status === 'CONDEMNED').length,
        pendingItems: checklistData.allItems.filter((i: any) => i.status === 'PENDING').length,
        categories: checklistData.categories
      },
      springs: springs.records,
      photos,
      gateStatus: gateEvaluation
    },
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 8. Lifecycle Stage Transition State Machine
// -------------------------------------------------------------------------

wagonsRouter.post('/:wagonNumber/transition', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;
  const { targetStage, notes, supervisorOverride, overrideJustification, otp, otpToken } = req.body;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'Wagon number is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const wagon = wagonRepo.getWagonByNumber(wagonNumber);
  if (!wagon) {
    res.status(404).json({
      success: false,
      error: 'WAGON_NOT_FOUND',
      message: `Wagon ${wagonNumber} not found`,
      statusCode: 404,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const currentStage: LifecycleStage = wagon.currentStage;
  const userRole = req.user?.role || 'INSPECTOR';
  const userId = req.user?.id || 'usr_insp_001';
  const userName = req.user?.name || 'Inspector';

  // State Machine Validation
  /*
   * A supervisor override moves a wagon past the rules, so it is guarded by
   * the same factor as releasing one. It was not: this route accepted the
   * inline confirmation code even from a supervisor with an authenticator
   * enrolled, because the TOTP-if-enrolled rule lived only in the signoff
   * handler. Overriding a stage and certifying a wagon are the same order of
   * consequence and should not have different doors.
   */
  if (supervisorOverride) {
    const factor = verifySecondFactor(getDatabase(), {
      userId: req.user?.id,
      action: 'OVERRIDE',
      totpCode: (req.body as any)?.totpCode,
      otpToken: otpToken || otp,
      describeAction: 'a supervisor stage override'
    });
    if (!factor.ok) {
      res.status(factor.statusCode || 401).json({
        success: false,
        error: factor.error,
        message: factor.message,
        statusCode: factor.statusCode || 401,
        timestamp: new Date().toISOString()
      });
      return;
    }
  }

  const validation = LifecycleEngine.validateTransition({
    currentStage,
    targetStage: targetStage as LifecycleStage,
    userRole,
    isOverride: Boolean(supervisorOverride),
    overrideJustification,
    otpToken: otpToken || otp
  });

  if (!validation.valid) {
    res.status(validation.statusCode || 400).json({
      success: false,
      error: 'TRANSITION_NOT_PERMITTED',
      message: validation.error || 'State transition rejected by lifecycle engine',
      statusCode: validation.statusCode || 400,
      currentStage,
      targetStage,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // If override requires OTP, verify token
  const tokenToVerify = otpToken || otp;
  let otpRef: string | null = null;
  if (validation.transitionType === 'OVERRIDE_SKIP' || validation.transitionType === 'OVERRIDE_BACKWARD' || validation.transitionType === 'REOPEN') {
    if (tokenToVerify) {
      /*
       * No test escape hatch here.
       *
       * This used to read `if (!consumed && !tokenToVerify.startsWith('test_'))`,
       * which meant any string beginning with those five characters was
       * accepted as a valid supervisor override token. It was not gated on
       * NODE_ENV, so it was live in production.
       *
       * Verified exploitable before removal: a backward stage transition with
       * otpToken "test_fabricated_no_otp_was_issued" succeeded, while the
       * identical request without the prefix was correctly refused. The OTP
       * requirement on overrides exists so that rewriting a wagon's lifecycle
       * is deliberate and confirmed by a second factor; a prefix anyone can
       * type defeats that entirely.
       *
       * The worst part was downstream: otpRef was then written to the audit
       * log, so the record showed an OTP reference for a code that had never
       * been issued. The override would read as properly authorised forever
       * afterwards.
       *
       * Tests that need to exercise this path mint a real action token, which
       * is what the rest of the suite already does.
       */
      const consumed = otpService.consumeActionToken(tokenToVerify, 'OVERRIDE', req.user?.id);
      if (!consumed) {
        res.status(401).json({
          success: false,
          error: 'INVALID_OTP_TOKEN',
          message: 'Supervisor override requires a valid, active OTP action token.',
          statusCode: 401,
          timestamp: new Date().toISOString()
        });
        return;
      }
      otpRef = tokenToVerify;
    }
  }

  try {
    const transition = wagonRepo.recordTransition({
      wagonNumber,
      fromStage: currentStage,
      toStage: targetStage as LifecycleStage,
      transitionType: validation.transitionType,
      performedBy: userId,
      performerName: userName,
      performerRole: userRole,
      isOverride: Boolean(supervisorOverride),
      overrideReason: overrideJustification || null,
      supervisorId: Boolean(supervisorOverride) ? userId : null,
      supervisorName: Boolean(supervisorOverride) ? userName : null,
      otpTokenRef: otpRef,
      notes: notes || null
    });

    const updatedWagon = wagonRepo.getWagonByNumber(wagonNumber);

    res.status(200).json({
      success: true,
      message: `Wagon ${wagonNumber} successfully transitioned from ${currentStage} to ${targetStage}.`,
      data: {
        wagon: updatedWagon,
        transition
      },
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'TRANSITION_FAILED',
      message: err.message || 'Failed to execute stage transition',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 9. Update Checklist Item (Repair / Re-inspection)
// -------------------------------------------------------------------------

wagonsRouter.put('/:wagonNumber/checklist/items/:itemId', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const itemId = req.params?.itemId;
  const { status, repairAction, repairNotes, reinspectedStatus, conditionNotes, photoId } = req.body;

  // See the sorting route: a camera decision must say so on the row.
  const verdictSource = parseClaimedSource(req.body?.verdictSource);
  if (verdictSource === null) {
    res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'verdictSource must be MANUAL, CAMERA_ASSISTED or CAMERA_AUTO.',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (!itemId) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'itemId parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  /*
   * See the sorting route. A camera decision on a wagon part is re-judged
   * here from the server's own examples before anything is written — and
   * it may only ever be a PASS. A FAIL or CONDEMN is a person's decision
   * with a reason, whatever the source claims.
   */
  let gate: Extract<GateResult, { ok: true }> | null = null;
  if (verdictSource === 'CAMERA_AUTO') {
    if (status !== 'PASS' || (reinspectedStatus !== undefined && reinspectedStatus !== 'PASS')) {
      res.status(422).json({
        success: false,
        error: 'AUTO_COMMIT_REFUSED',
        message: 'The camera may record a PASS without a tap. It may never record a fault: a FAIL or CONDEMN needs a person and a reason.',
        statusCode: 422,
        timestamp: new Date().toISOString()
      });
      return;
    }
    const existing = wagonRepo.getChecklistItemById(itemId);
    if (!existing) {
      res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: `Checklist item ${itemId} not found`,
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
      return;
    }
    const g = judgeAutoCommit(getDatabase(), {
      domain: 'WAGON_PART',
      evidence: req.body?.autoEvidence,
      measurementPassed: null,
      expected: { PART_ID: labelForPart(existing.partName) }
    });
    if (!g.ok) {
      res.status(g.status).json({
        success: false,
        error: g.code,
        message: g.message,
        data: g.decision ? { decision: g.decision } : undefined,
        statusCode: g.status,
        timestamp: new Date().toISOString()
      });
      return;
    }
    gate = g;
  }

  try {
    const item = wagonRepo.updateChecklistItem(
      itemId,
      {
        status,
        repairAction,
        repairNotes,
        reinspectedStatus,
        conditionNotes,
        photoId
      },
      // Optional — when the client sends the version it read, a concurrent
      // edit by another inspector is reported instead of silently lost.
      {
        expectedUpdatedAt: req.body?.expectedUpdatedAt,
        userId: (req as any).user?.id,
        userRole: (req as any).user?.role,
        verdictSource
      }
    );

    if (gate) {
      recordAutoDecision(getDatabase(), 'WAGON_PART', gate, {
        recordId: item.id,
        wagonNumber: item.wagonNumber ?? req.params?.wagonNumber ?? null,
        userId: (req as any).user?.id,
        userRole: (req as any).user?.role ?? null
      });
    }

    res.status(200).json({
      success: true,
      message: `Checklist item ${item.partName} updated successfully.`,
      data: item,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    if (err?.name === 'ConflictError') {
      res.status(409).json({
        success: false,
        error: 'CONCURRENT_MODIFICATION',
        message: err.message,
        data: err.currentItem,
        statusCode: 409,
        timestamp: new Date().toISOString()
      });
      return;
    }
    res.status(404).json({
      success: false,
      error: 'ITEM_NOT_FOUND',
      message: err.message || 'Checklist item not found',
      statusCode: 404,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 10b. Withdraw a row somebody added to this wagon
//
// The way out that the Mark-50 episode did not have. Fourteen MANDATORY
// coupler checks were added in August from a photograph of a gauge board;
// every one of them was permanently incompletable, so every wagon's exit gate
// stayed shut, and the only remedy was to edit the source and redeploy.
//
// Template rows are refused here. They are the standard for the wagon type,
// and one person deciding a standard does not apply to one vehicle is the
// failure this whole gate exists to prevent. Changing the standard is what
// Checklist Rules is for.
// -------------------------------------------------------------------------
/*
 * POST rather than DELETE, for a reason the browser found and the tests could
 * not: express.json() in this framework skips body parsing for DELETE, so the
 * required reason never arrived and every real withdrawal returned 400. The
 * server tests passed throughout, because dispatch() hands the body straight
 * to the route and never goes through the parser.
 *
 * It also reads better. This is an audited act that must carry a
 * justification, which is what every other consequential POST here does —
 * gate sign-off, override, condemnation — rather than a bare deletion.
 */
wagonsRouter.post('/:wagonNumber/checklist/items/:itemId/withdraw', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const { itemId } = req.params;
  const reason = req.body?.reason;

  try {
    const existing = wagonRepo.getChecklistItemById(itemId);
    if (!existing) {
      res.status(404).json({
        success: false, error: 'NOT_FOUND', message: 'No such checklist item.',
        statusCode: 404, timestamp: new Date().toISOString()
      });
      return;
    }

    /*
     * Withdrawing a MANDATORY row changes what the gate enforces, in the
     * direction that lets a wagon out. That is the heavier direction, so it
     * needs the heavier authority — the same one it took to make it mandatory.
     * An advisory row gates nothing, and the person who added it can take it
     * back.
     */
    const needed = existing.isMandatory ? 'checklist.configure' : 'wagon.inspect';
    if (!can(req.user?.role, needed as any)) {
      res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: existing.isMandatory
          ? 'Withdrawing a MANDATORY item changes what the exit gate enforces, which needs checklist.configure.'
          : 'Withdrawing a checklist item needs wagon.inspect.',
        statusCode: 403,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 4) {
      res.status(400).json({
        success: false,
        error: 'MISSING_REASON',
        message: 'A reason is required — say why this item no longer applies to this wagon.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const result = wagonRepo.withdrawShopAddedItem(itemId);

    /*
     * Recorded before anything else can happen to the wagon. A row that once
     * held a wagon and no longer exists is precisely the history somebody will
     * want when they ask why this vehicle passed.
     */
    logAuditEvent(getDatabase(), {
      eventType: 'CHECKLIST_ITEM_UPDATED',
      userId: req.user!.id,
      userRole: req.user?.role || 'INSPECTOR',
      payload: {
        action: 'WITHDRAWN_FROM_WAGON',
        wagonNumber: existing.wagonNumber,
        itemId,
        category: existing.category,
        partName: existing.partName,
        wasMandatory: existing.isMandatory,
        gateAffecting: existing.isMandatory,
        addedReason: existing.addedReason ?? null,
        withdrawnReason: reason.trim().slice(0, 500)
      }
    });

    res.status(200).json({
      success: true,
      message: `"${existing.partName}" withdrawn from ${existing.wagonNumber}.`,
      data: { withdrawn: result.withdrawn, itemId },
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    const isRule = err?.name === 'ValidationError';
    res.status(isRule ? 409 : 500).json({
      success: false,
      error: isRule ? 'TEMPLATE_ITEM' : 'WITHDRAW_FAILED',
      message: err?.message || 'Failed to withdraw the checklist item',
      statusCode: isRule ? 409 : 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 10. Log Part Inspection Record in Checklist
// -------------------------------------------------------------------------

wagonsRouter.post('/:wagonNumber/checklist/items', authMiddleware, async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;
  const { category, partName, bogiePosition, status, conditionNotes, isMandatory, photoId, addedReason } = req.body;

  if (!wagonNumber || !category || !partName) {
    res.status(400).json({
      success: false,
      error: 'MISSING_REQUIRED_FIELDS',
      message: 'wagonNumber, category, and partName are required fields',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  /*
   * A row added to a wagon has to say why it is there.
   *
   * The same rule the checklist template editor enforces, for the same
   * reason. In August fourteen coupler checks were added from a photograph of
   * a gauge board and nobody afterwards could say what they were for. A reason
   * recorded at the time is what makes a row reviewable later — and this row
   * may be enforcing the exit gate.
   */
  if (!addedReason || typeof addedReason !== 'string' || addedReason.trim().length < 4) {
    res.status(400).json({
      success: false,
      error: 'MISSING_REASON',
      message: 'addedReason is required — say why this part is being added to this wagon.',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  /*
   * Making it MANDATORY is a different act from noting it.
   *
   * A mandatory row left PENDING is a CRITICAL_BLOCKER, so this is precisely
   * "change what the exit gate enforces" — the words checklist.configure is
   * defined by. An inspector may record a part they found; deciding the wagon
   * cannot leave without it belongs with the authority that already governs
   * the gate.
   */
  /*
   * Checked per case rather than as a blanket requirement on the route.
   *
   * A first attempt required wagon.inspect for the whole endpoint, which
   * locked out the only role permitted to make a row mandatory: an
   * administrator holds checklist.configure and deliberately holds no
   * shop-floor capabilities at all — they may create the account that
   * certifies a wagon and may not certify one themselves.
   *
   * The two acts are genuinely different and want different authority.
   * Noting a part found on this wagon is inspection. Deciding the wagon may
   * not leave without it is the gate.
   */
  const wantsMandatory = isMandatory === true;
  const needed = wantsMandatory ? 'checklist.configure' : 'wagon.inspect';
  if (!can(req.user?.role, needed as any)) {
    res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: wantsMandatory
        ? 'Adding a MANDATORY item changes what the exit gate enforces for this wagon, which needs ' +
          'checklist.configure. Add it as an advisory item, or ask an administrator.'
        : 'Recording a checklist item needs wagon.inspect.',
      statusCode: 403,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // From the token. The previous fallback filed an unattributed addition
  // against a real seeded inspector who had not made it.
  const inspectorId = req.user?.id;
  const inspectorName = req.user?.name || req.user?.username || 'Inspector';
  if (!inspectorId) {
    res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Sign in first.',
      statusCode: 401,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    const existing = wagonRepo
      .getChecklistItems(wagonNumber)
      .find?.((it: any) => it.category === category && it.partName === partName);

    const item = wagonRepo.upsertChecklistItem({
      wagonNumber,
      category,
      partName,
      bogiePosition: bogiePosition || 'NONE',
      status: status || 'PENDING',
      isMandatory: wantsMandatory,
      conditionNotes,
      inspectorId,
      inspectorName,
      photoId: photoId || null,
      shopAdded: true,
      addedReason: String(addedReason).trim().slice(0, 500)
    });

    /*
     * Audited, because it can change whether a wagon may leave.
     *
     * Only on creation. An update through this path is an ordinary inspection
     * verdict and is already recorded as one; logging it here as a gate change
     * would put a second, differently-shaped event in the chain for the same
     * act.
     */
    if (!existing) {
      /*
       * CHECKLIST_ITEM_UPDATED with an explicit action, rather than a new
       * event type. inspection_audit_log constrains event_type with a CHECK,
       * and widening it in SQLite means rebuilding the table — which is the
       * append-only, hash-chained one. Rebuilding that to add an enum value
       * would be a large risk for a small tidiness, so the distinction lives
       * in the payload where it is just as searchable.
       */
      logAuditEvent(getDatabase(), {
        eventType: 'CHECKLIST_ITEM_UPDATED',
        userId: inspectorId,
        userRole: req.user?.role || 'INSPECTOR',
        payload: {
          action: 'ADDED_TO_WAGON',
          wagonNumber: String(wagonNumber).trim().toUpperCase(),
          itemId: item.id,
          category,
          partName,
          bogiePosition: bogiePosition || 'NONE',
          isMandatory: wantsMandatory,
          gateAffecting: wantsMandatory,
          addedReason: String(addedReason).trim().slice(0, 500)
        }
      });
    }

    res.status(200).json({
      success: true,
      message: `Checklist item ${partName} (${category}) recorded with status ${item.status}.`,
      data: item,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'CHECKLIST_UPDATE_FAILED',
      message: err.message || 'Failed to update checklist item',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});


// -------------------------------------------------------------------------
// 11. Supervisor Digital Sign-off & Release Certification
// -------------------------------------------------------------------------

/*
 * Certifying a wagon is guarded by the ACT, not by rank.
 *
 * This read requireRole('SUPERVISOR'), and because access was a seniority
 * ladder an ADMIN cleared it too — so whoever administers the system could
 * sign a wagon fit to leave the workshop. Releasing a wagon is a
 * professional act with a name attached; administering accounts is not a
 * qualification to perform it, and the DRM signs nothing at all.
 */
wagonsRouter.post('/:wagonNumber/gate/signoff', authMiddleware, requireCapability('wagon.release'), async (req: Request, res: Response) => {
  const { wagonRepo } = getRepos();
  const wagonNumber = req.params?.wagonNumber;
  // supervisorId and digitalSignature are deliberately NOT read from the body.
  // Identity comes from the authenticated token; the signature is computed
  // server-side. Accepting either from the caller would let them choose whose
  // name goes on the certificate.
  const { otp, otpToken, totpCode, notes, signoffNotes, acknowledgedAdvisoryIds } = req.body;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'wagonNumber is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Pre-validate exit gate
  const gateEvaluation = ExitGateValidator.evaluate(wagonNumber, wagonRepo);
  if (!gateEvaluation.canRelease) {
    res.status(422).json({
      success: false,
      error: 'RELEASE_GATE_BLOCKED',
      message: 'Cannot sign off wagon release. Zero-defect gate validation detected active blockers.',
      blockers: gateEvaluation.blockers,
      blockerDetails: gateEvaluation.blockerDetails,
      summary: gateEvaluation.summary,
      statusCode: 422,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // -----------------------------------------------------------------------
  // OTP is required, not optional.
  //
  // This block used to run only `if (tokenToVerify)`, so omitting the field
  // skipped verification entirely — the OTP gate could be walked past by
  // simply not mentioning it. A release certificate is the most consequential
  // record the system produces; it does not get a silent path.
  // -----------------------------------------------------------------------
  //
  // Which factor is required depends on whether this supervisor has an
  // authenticator enrolled, so the "did you send one at all" check cannot be
  // made before that is known. It used to sit here and demand an inline OTP
  // unconditionally, which meant an enrolled supervisor sending only their
  // authenticator code was turned away with OTP_REQUIRED — the stronger
  // factor rejected for not being the weaker one.
  //
  const tokenToVerify = otpToken || otp;

  /*
   * Which second factor this sign-off is allowed to use.
   *
   * The inline one-time code is an audited two-step confirmation, not a
   * second factor: whoever asks for it receives it in the same response, so
   * possession of the session is possession of the code. That is defensible
   * for a LAN pilot on a supervisor's own tablet, and it is what most
   * supervisors will still be using on day one.
   *
   * An authenticator changes that — the code comes from a device the server
   * never sees. So enrolment UPGRADES a supervisor: the moment they enrol,
   * their authenticator becomes the required factor for release sign-off and
   * the inline code stops being accepted for them. Otherwise anyone who
   * enrolled could quietly fall back to the weaker path, which would make the
   * stronger one decorative.
   *
   * Supervisors who have not enrolled keep the existing flow, so nobody is
   * locked out of releasing a wagon mid-pilot by a security improvement.
   */
  const totpService = new TotpService(getDatabase());
  const signerId = req.user?.id;
  const signerIsEnrolled = signerId ? totpService.isEnrolled(signerId) : false;
  let factorUsed: 'TOTP' | 'INLINE_OTP';

  if (signerIsEnrolled) {
    if (!totpCode) {
      res.status(401).json({
        success: false,
        error: 'TOTP_REQUIRED',
        message:
          'You have an authenticator enrolled, so release sign-off requires the six-digit code from it. ' +
          'The emailed or on-screen one-time code is not accepted once an authenticator is set up.',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const totpResult = totpService.verify(signerId!, String(totpCode));
    if (!totpResult.ok) {
      res.status(401).json({
        success: false,
        error: 'INVALID_TOTP',
        message: totpResult.reason || 'That authenticator code was not accepted.',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
      return;
    }
    factorUsed = 'TOTP';
  } else {
    if (!tokenToVerify) {
      res.status(401).json({
        success: false,
        error: 'OTP_REQUIRED',
        message: 'Release sign-off requires a supervisor OTP action token.',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!otpService.consumeActionToken(tokenToVerify, 'OVERRIDE', req.user?.id)) {
      res.status(401).json({
        success: false,
        error: 'INVALID_OTP_TOKEN',
        message: 'Release sign-off requires a valid supervisor OTP action token.',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
      return;
    }
    factorUsed = 'INLINE_OTP';
  }

  // -----------------------------------------------------------------------
  // Who signed is taken from the authenticated token and nowhere else.
  //
  // This previously read `req.user?.id || supervisorId || 'usr_sup_001'`,
  // falling back first to a client-supplied body field and then to a
  // hardcoded demo supervisor — so a certificate could be attributed to
  // someone who did not sign it. The name and employee ID fell back to
  // 'S. K. Verma' / 'WRS-SUP-2019' the same way, and since the JWT carries no
  // employeeId at all, *every* certificate issued to date bore the demo ID
  // regardless of who signed. A signature naming the wrong person is worse
  // than no signature.
  // -----------------------------------------------------------------------
  if (!req.user?.id) {
    res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Release sign-off requires an authenticated supervisor.',
      statusCode: 401,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const effectiveSupervisorId = req.user.id;
  const effectiveSupervisorName = req.user.name;
  const employeeId = wagonRepo.getUserEmployeeId(effectiveSupervisorId);

  if (!employeeId) {
    res.status(403).json({
      success: false,
      error: 'SUPERVISOR_NOT_REGISTERED',
      message:
        'The signing supervisor has no employee record. A release certificate cannot be ' +
        'issued without an identifiable signatory.',
      statusCode: 403,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    const signoff = wagonRepo.recordGateSignoff({
      wagonNumber,
      supervisorId: effectiveSupervisorId,
      supervisorName: effectiveSupervisorName,
      supervisorEmployeeId: employeeId,
      // Deliberately not client-supplied: the repository computes a keyed
      // signature over the certificate's canonical contents.
      /*
       * Record WHICH factor authorised this release, not just that something
       * did. Six months from now the difference between a code from the
       * supervisor's own authenticator and a code the server handed to
       * whoever asked is the whole question, and it cannot be reconstructed
       * afterwards if it was never written down.
       *
       * A TOTP code is deliberately not stored — it is a valid credential for
       * another thirty seconds, and the audit log is readable by supervisors.
       * The reference records the factor and the moment, which is what an
       * investigation needs.
       */
      otpTokenRef:
        factorUsed === 'TOTP'
          ? `totp:${signerId}:${new Date().toISOString()}`
          : tokenToVerify || `otp_auto_${crypto.randomBytes(6).toString('hex')}`,
      signoffNotes: notes || signoffNotes || 'Quality audit cleared with zero defects.',
      acknowledgedAdvisoryIds: Array.isArray(acknowledgedAdvisoryIds) ? acknowledgedAdvisoryIds : [],
      checksSummary: gateEvaluation.summary
    });

    res.status(200).json({
      success: true,
      message: `Wagon ${wagonNumber} certified and released successfully with Certificate ${signoff.certificateNumber}.`,
      data: signoff,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'SIGNOFF_FAILED',
      message: err.message || 'Failed to complete digital sign-off',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});
