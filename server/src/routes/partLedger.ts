/**
 * The parts ledger — what came off, what went back
 * Indian Railways WRS Raipur
 *
 * Three endpoints. Recording is shop-floor work and sits with wagon.inspect;
 * reading is available to anyone signed in, because the reconciliation is what
 * a supervisor consults at the gate and what a DRM asks to see afterwards.
 *
 * The suggestions returned by the reconciliation are assembled here from real
 * records — the stores level and the checklist's own cited standard — rather
 * than inside the repository, so the balance arithmetic stays testable on its
 * own and no quantity in a suggestion can come from anywhere but a table.
 */

import { Router } from '../framework/index.ts';
import type { Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import {
  PartLedgerRepository,
  PART_EVENTS,
  EVENTS_NEEDING_REASON,
  type PartEvent
} from '../db/partLedgerRepository.ts';
import { WagonRepository } from '../db/wagonRepository.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';

export const partLedgerRouter = Router();

function bad(res: Response, message: string, code = 'VALIDATION_ERROR', status = 400) {
  res.status(status).json({
    success: false,
    error: code,
    message,
    statusCode: status,
    timestamp: new Date().toISOString()
  });
}

/**
 * How many of this part the stores hold, and where.
 *
 * Matched on name rather than a part code because the ledger records what the
 * fitter called the part, and the two vocabularies do not always agree. A miss
 * simply means the suggestion says less — it never guesses a quantity.
 */
function storesLookup(partName: string): { available: number; binLocation: string | null } | null {
  try {
    const row = getDatabase()
      .prepare(
        `SELECT stock_quantity, reserved_quantity, bin_location
         FROM stores_inventory
         WHERE UPPER(TRIM(part_name)) = UPPER(TRIM(?))
         LIMIT 1`
      )
      .get(partName) as any;
    if (!row) return null;
    return {
      // What can actually be issued, not what is on the shelf. Suggesting a
      // part that is already reserved for another wagon sends a fitter to an
      // empty bin.
      available: Math.max(0, Number(row.stock_quantity || 0) - Number(row.reserved_quantity || 0)),
      binLocation: row.bin_location || null
    };
  } catch {
    return null;
  }
}

/** The clause the shop's own checklist cites for this part, if it cites one. */
function standardLookupFor(wagonType: string): (partKey: string) => string | null {
  let rows: any[] = [];
  try {
    rows = getDatabase()
      .prepare(
        `SELECT category, part_name, bogie_position, standard_reference
         FROM checklist_config
         WHERE wagon_type IN (?, 'DEFAULT') AND standard_reference IS NOT NULL`
      )
      .all(wagonType) as any[];
  } catch {
    return () => null;
  }

  const norm = (v: string) =>
    String(v || '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_\-.]/g, '');
  const byKey = new Map<string, string>();
  for (const r of rows) {
    const key = [norm(r.category), norm(r.part_name), norm(r.bogie_position || 'NONE')].join('|');
    if (!byKey.has(key)) byKey.set(key, `${r.standard_reference} covers this part.`);
  }
  return (partKey: string) => byKey.get(partKey) ?? null;
}

// ---------------------------------------------------------------------------
// POST /api/wagons/:wagonNumber/parts — one thing that happened
// ---------------------------------------------------------------------------
partLedgerRouter.post(
  '/:wagonNumber/parts',
  authMiddleware,
  requireCapability('wagon.inspect'),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const wagonNumber = req.params?.wagonNumber;
      const b = req.body || {};
      if (!wagonNumber) return bad(res, 'wagonNumber is required.', 'MISSING_PARAM');

      const wagon = new WagonRepository(getDatabase()).getWagonByNumber(wagonNumber);
      if (!wagon) return bad(res, `No wagon ${wagonNumber} is registered.`, 'NOT_FOUND', 404);

      const event = b.event as PartEvent;
      if (!PART_EVENTS.includes(event)) {
        return bad(res, `event must be one of ${PART_EVENTS.join(', ')}.`);
      }
      if (!b.category || !b.partName) {
        return bad(res, 'category and partName are required — a ledger entry has to name a part.');
      }
      /*
       * A part that is not going back needs a decision recorded against it.
       * Without this the only way to balance a wagon is to write something
       * untrue, and a ledger people must lie in is worse than no ledger.
       */
      if (EVENTS_NEEDING_REASON.includes(event) && !String(b.reason || '').trim()) {
        return bad(
          res,
          `A part recorded as ${event} needs a reason. Say why it is not going back on, so the ` +
            'gate and the certificate can show a decision rather than an absence.'
        );
      }

      const quantity = b.quantity === undefined ? 1 : Number(b.quantity);
      if (!Number.isFinite(quantity) || quantity < 1) {
        return bad(res, 'quantity must be a whole number of one or more.');
      }

      const entry = new PartLedgerRepository(getDatabase()).record({
        wagonId: wagon.id,
        wagonNumber,
        category: String(b.category),
        partName: String(b.partName),
        bogiePosition: b.bogiePosition ? String(b.bogiePosition) : null,
        event,
        quantity,
        reason: b.reason ? String(b.reason) : null,
        photoId: b.photoId ? String(b.photoId) : null,
        storesItemId: b.storesItemId ? String(b.storesItemId) : null,
        componentSerial: b.componentSerial ? String(b.componentSerial) : null,
        // The stage the wagon is actually in, not one the client asserts —
        // otherwise a removal could be recorded as having happened at a stage
        // the wagon had already left.
        stage: wagon.currentStage,
        inspectorId: req.user!.id,
        inspectorName: req.user!.name ?? req.user!.id
      });

      res.status(201).json({ success: true, data: entry, meta: { timestamp: new Date().toISOString() } });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'LEDGER_WRITE_FAILED',
        message: err?.message || 'Could not record the part event',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/wagons/:wagonNumber/parts — every event, oldest first
// ---------------------------------------------------------------------------
partLedgerRouter.get('/:wagonNumber/parts', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const wagonNumber = req.params?.wagonNumber;
    if (!wagonNumber) return bad(res, 'wagonNumber is required.', 'MISSING_PARAM');
    const entries = new PartLedgerRepository(getDatabase()).entries(wagonNumber);
    res.status(200).json({
      success: true,
      data: { wagonNumber, entries },
      meta: { total: entries.length, timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'LEDGER_READ_FAILED',
      message: err?.message || 'Could not read the parts ledger',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/wagons/:wagonNumber/parts/reconciliation — does it balance?
// ---------------------------------------------------------------------------
partLedgerRouter.get(
  '/:wagonNumber/parts/reconciliation',
  authMiddleware,
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const wagonNumber = req.params?.wagonNumber;
      if (!wagonNumber) return bad(res, 'wagonNumber is required.', 'MISSING_PARAM');

      const wagon = new WagonRepository(getDatabase()).getWagonByNumber(wagonNumber);
      const result = new PartLedgerRepository(getDatabase()).reconcile(
        wagonNumber,
        storesLookup,
        standardLookupFor(wagon?.wagonType || 'DEFAULT')
      );

      res.status(200).json({
        success: true,
        data: result,
        meta: { timestamp: new Date().toISOString() }
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'RECONCILIATION_FAILED',
        message: err?.message || 'Could not reconcile the parts ledger',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }
  }
);
