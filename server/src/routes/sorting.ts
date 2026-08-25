/**
 * Spring Sorting API
 * Indian Railways WRS Raipur
 *
 * Bulk sorting of dismantled springs against the strip — the ~900/day work.
 * No wagon number is involved: these springs are stock until an assembly draws
 * on them.
 */

import { Router } from '../framework/index.ts';
import type { Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import { SortingRepository } from '../db/sortingRepository.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { getWagonSpringConfig } from '../../../shared/classification/wagonTypes.ts';
import { classifySpring } from '../../../shared/classification/engine.ts';
import type { BogieType, SpringCondition, SpringPosition } from '../../../shared/types.ts';

export const sortingRouter = Router();

const repo = () => new SortingRepository(getDatabase());

function bad(res: Response, message: string, code = 'VALIDATION_ERROR', status = 400) {
  res.status(status).json({
    success: false,
    error: code,
    message,
    statusCode: status,
    timestamp: new Date().toISOString()
  });
}

// ---------------------------------------------------------------------------
// POST /api/sorting/record — one sorted spring
// ---------------------------------------------------------------------------
sortingRouter.post('/record', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const b = req.body || {};
    const bogieType = b.bogieType as BogieType;
    const condition = (b.condition || 'USED') as SpringCondition;
    const springPosition = b.springPosition as SpringPosition;
    const measuredFreeHeight = Number(b.measuredFreeHeight);

    if (!b.batchId) return bad(res, 'batchId is required — a sorting session must be identifiable.');
    if (!bogieType || !springPosition || !Number.isFinite(measuredFreeHeight)) {
      return bad(res, 'bogieType, springPosition and measuredFreeHeight are required.');
    }
    if (!req.user?.id) return bad(res, 'Authenticated inspector required.', 'UNAUTHORIZED', 401);

    // Classified server-side rather than trusting the band the client sends.
    // The client computes one for instant feedback; the stored verdict is the
    // server's, so a stale or altered client cannot file a wrong group.
    const verdict = classifySpring({
      bogieType,
      condition,
      position: springPosition as any,
      measuredHeight: measuredFreeHeight,
      damageType: b.damageType,
      damageNotes: b.damageNotes
    });

    const { id } = repo().record({
      batchId: String(b.batchId),
      bogieType,
      condition,
      springPosition,
      measuredFreeHeight,
      heightIsApproximate: !!(b.heightIsApproximate ?? b.height_is_approximate),
      classifiedBand: verdict.band,
      bandRoman: verdict.bandRoman,
      status: verdict.status,
      damageType: b.damageType ?? null,
      condemnationReason: verdict.condemnationReason ?? null,
      tableReference: verdict.tableReference ?? null,
      inspectorId: req.user.id,
      inspectorName: req.user.name ?? null,
      syncId: b.syncId ?? b.sync_id ?? null
    });

    res.status(201).json({
      success: true,
      data: {
        id,
        band: verdict.band,
        bandRoman: verdict.bandRoman,
        status: verdict.status,
        tableReference: verdict.tableReference,
        condemnationReason: verdict.condemnationReason ?? null
      },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    bad(res, err?.message || 'Could not record sorted spring', 'SORTING_FAILED', 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/sorting/batches/:batchId/close — one audit entry for the session
// ---------------------------------------------------------------------------
sortingRouter.post('/batches/:batchId/close', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const batchId = req.params?.batchId;
    if (!batchId) return bad(res, 'batchId is required');
    if (!req.user?.id) return bad(res, 'Authenticated inspector required.', 'UNAUTHORIZED', 401);

    const r = repo();
    r.closeBatch(batchId, req.user.id, req.user.role || 'INSPECTOR');
    res.status(200).json({ success: true, data: r.batchSummary(batchId), timestamp: new Date().toISOString() });
  } catch (err: any) {
    bad(res, err?.message || 'Could not close batch', 'SORTING_FAILED', 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/sorting/batches/:batchId — running totals for the session
// ---------------------------------------------------------------------------
sortingRouter.get('/batches/:batchId', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const batchId = req.params?.batchId;
  if (!batchId) return bad(res, 'batchId is required');
  res.status(200).json({ success: true, data: repo().batchSummary(batchId), timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// GET /api/sorting/stock — what is on hand, grouped as the strip groups it
//
// ?forWagon=BOSTHS M2 additionally answers the question the tally cannot:
// how many complete nests this stock can actually supply for that wagon.
// ---------------------------------------------------------------------------
sortingRouter.get('/stock', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = (req.query || {}) as Record<string, string>;
    const bogieType = q.bogieType as BogieType;
    const condition = (q.condition || 'USED') as SpringCondition;

    if (!bogieType) return bad(res, 'bogieType is required');

    const r = repo();
    const stock = r.stockByBand(bogieType, condition, { fromDate: q.fromDate, toDate: q.toDate });

    let capacity = null;
    let wagon = null;
    if (q.forWagon) {
      const config = getWagonSpringConfig(q.forWagon);
      if (!config) {
        return bad(res, `Unknown wagon designation "${q.forWagon}". It must not be guessed.`, 'UNKNOWN_WAGON_TYPE');
      }
      wagon = {
        designation: config.designation,
        counts: config.counts,
        tableRef: config.tableRef,
        canClassifySprings: config.bogieType !== null
      };
      capacity = r.nestCapacity(bogieType, condition, config.counts);
    }

    res.status(200).json({
      success: true,
      data: { bogieType, condition, stock, wagon, capacity },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    bad(res, err?.message || 'Could not read sorting stock', 'SORTING_FAILED', 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/sorting/throughput?date=YYYY-MM-DD
// ---------------------------------------------------------------------------
sortingRouter.get('/throughput', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const q = (req.query || {}) as Record<string, string>;
  const date = q.date || new Date().toISOString().slice(0, 10);
  res.status(200).json({ success: true, data: repo().dailyThroughput(date), timestamp: new Date().toISOString() });
});
