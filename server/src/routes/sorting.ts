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
import { judgeSortedSpring, isSortingBogie } from '../../../shared/classification/springJudgement.ts';
import type { SortingBogie } from '../../../shared/classification/springJudgement.ts';
import type { BogieType, SpringCondition, SpringPosition } from '../../../shared/types.ts';
import { allocateNests } from '../../../shared/sorting/nestAllocation.ts';
import { findMeasurementAnomaly } from '../../../shared/analysis/measurementAnomaly.ts';
import { LearningService } from '../learning/learningService.ts';

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
    const bogieType = b.bogieType as SortingBogie;
    const condition = (b.condition || 'USED') as SpringCondition;
    const springPosition = b.springPosition as SpringPosition;
    const measuredFreeHeight = Number(b.measuredFreeHeight);

    if (!b.batchId) return bad(res, 'batchId is required — a sorting session must be identifiable.');
    if (!bogieType || !springPosition || !Number.isFinite(measuredFreeHeight)) {
      return bad(res, 'bogieType, springPosition and measuredFreeHeight are required.');
    }
    /*
     * Refuse a bogie no published rule covers rather than falling through to
     * a band lookup that would throw a 500. LWLH25 and LCCF20 are judged by
     * §309C condemning height instead of a G-95 band, and both are accepted
     * here — that path existed and was reachable by nothing until now.
     */
    if (!isSortingBogie(bogieType)) {
      return bad(
        res,
        `No published classification rule is held for bogie "${bogieType}". ` +
        `Its springs must not be judged by guesswork.`,
        'UNKNOWN_BOGIE'
      );
    }
    if (!req.user?.id) return bad(res, 'Authenticated inspector required.', 'UNAUTHORIZED', 401);

    // Classified server-side rather than trusting the band the client sends.
    // The client computes one for instant feedback; the stored verdict is the
    // server's, so a stale or altered client cannot file a wrong group.
    const verdict = judgeSortedSpring({
      bogieType,
      condition,
      position: springPosition,
      measuredHeight: measuredFreeHeight,
      damageType: b.damageType,
      damageNotes: b.damageNotes
    });

    /*
     * Judged against the readings that came BEFORE it, so a spring cannot
     * help decide whether it is itself unusual. Computed before the insert
     * for that reason, not after.
     *
     * This never gates the insert. The reading is recorded either way and the
     * advisory rides back with it, because the inspector already has the undo
     * path for a wrong tap — a wrong tap being, at 700 springs a shift, a
     * certainty rather than a risk.
     */
    const r = repo();
    let anomaly = null;
    try {
      const population = r.recentHeights(bogieType as BogieType, condition, springPosition);
      const result = findMeasurementAnomaly(measuredFreeHeight, {
        bogieType: bogieType as BogieType,
        springPosition,
        condition,
        heights: population.heights,
        recentInOrder: population.recentInOrder
      });
      if (result.flagged) anomaly = result;
    } catch {
      // An advisory must never be the reason a spring cannot be recorded.
      anomaly = null;
    }

    const { id, alreadyRecorded } = r.record({
      batchId: String(b.batchId),
      bogieType: bogieType as BogieType,
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
      syncId: b.syncId ?? b.sync_id ?? null,
      // Which instrument produced the reading. Absent is recorded as absent,
      // never quietly attributed to whichever gauge happens to be on file.
      gaugeCode: b.gaugeCode ?? b.gauge_code ?? null
    });

    // 200 rather than 201 when this tap has been seen before: the device is
    // replaying a spring recorded offline, and nothing new was created.
    res.status(alreadyRecorded ? 200 : 201).json({
      success: true,
      data: {
        id,
        alreadyRecorded,
        band: verdict.band,
        bandRoman: verdict.bandRoman,
        status: verdict.status,
        tableReference: verdict.tableReference,
        condemnationReason: verdict.condemnationReason ?? null,
        // False for LWLH25 and LCCF20: the published data gives a verdict and
        // no colour. The screen must not draw a band swatch for these.
        bandingAvailable: verdict.bandingAvailable,
        note: verdict.note ?? null,
        /*
         * Null unless the reading looked wrong. The screen shows it beside the
         * band as a question, never as a verdict — the band above it is the
         * RDSO answer and is not affected by anything here.
         */
        anomaly
      },
      timestamp: new Date().toISOString()
    });

    /*
     * Logged after the response so the ledger can never delay a tap. Records
     * the question that was asked; POST /api/sorting/records/:id/anomaly-outcome
     * records what the inspector did about it.
     */
    if (anomaly && !alreadyRecorded) {
      try {
        new LearningService(getDatabase()).recordOutcome({
          subsystem: 'MEASUREMENT_ANOMALY',
          inspectionId: id,
          machineOutput: {
            measuredHeight: measuredFreeHeight,
            kinds: anomaly.findings.map((f) => f.kind),
            suggested: anomaly.findings.find((f) => f.suggested !== undefined)?.suggested ?? null
          },
          // Unanswered until the inspector responds; assume nothing meanwhile.
          wasCorrected: false,
          context: {
            bogieType,
            springPosition,
            condition,
            populationSize: anomaly.populationSize,
            answered: false
          },
          userId: req.user?.id ?? null,
          userRole: req.user?.role ?? null
        });
      } catch {
        // A ledger failure must not surface as a failed sorting tap.
      }
    }
  } catch (err: any) {
    bad(res, err?.message || 'Could not record sorted spring', 'SORTING_FAILED', 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/sorting/batches/:batchId/close — one audit entry for the session
// ---------------------------------------------------------------------------
// POST /api/sorting/batches/:batchId/undo
//
// Corrects the last spring recorded in a batch.
//
// Sorting is one tap per spring, ~700 a shift, so a wrong tap is a certainty.
// Nothing is deleted: the records are append-only at the database engine, and
// this appends a superseding record instead. Both survive, so the correction
// is itself part of the trail.
// ---------------------------------------------------------------------------
sortingRouter.post('/batches/:batchId/undo', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const batchId = req.params?.batchId;
  const actorId = req.user?.id;

  if (!batchId) {
    res.status(400).json({
      success: false, error: 'MISSING_BATCH', message: 'batchId is required',
      statusCode: 400, timestamp: new Date().toISOString()
    });
    return;
  }
  if (!actorId) {
    res.status(401).json({
      success: false, error: 'UNAUTHORIZED',
      message: 'A correction must name the person who made it.',
      statusCode: 401, timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    const result = repo().correctLast(batchId, req.body?.replacement ?? null, actorId);
    if (!result) {
      // Nothing to undo. Not an error — the caller is a button someone may
      // tap twice, or tap before recording anything.
      res.status(200).json({
        success: true,
        data: { corrected: false, message: 'There is nothing to undo in this session yet.' },
        timestamp: new Date().toISOString()
      });
      return;
    }
    res.status(200).json({
      success: true,
      data: { corrected: true, ...result, summary: repo().batchSummary(batchId) },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(400).json({
      success: false, error: 'UNDO_FAILED',
      message: err?.message || 'That spring could not be corrected.',
      statusCode: 400, timestamp: new Date().toISOString()
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sorting/records/:id/anomaly-outcome
//
// What the inspector did about a flagged reading.
//
// This is the half that makes the flag worth having. Recording that a question
// was asked tells you nothing; recording the answer tells you whether asking
// was justified, and that is the only thing that can honestly tune the
// threshold later.
//
// Two answers, and they mean opposite things about the machine:
//
//   RE_MEASURED  the inspector gauged it again and the value changed. The
//                flag caught a real transcription error.
//   CONFIRMED    gauged again, the reading stands. The flag was a false
//                alarm, and enough of these is the argument for widening the
//                threshold — an argument this ledger will be able to make
//                with evidence instead of impressions.
//
// Nothing here alters the recorded spring. Correcting a reading is what the
// undo path is for, and it stays the only way to change a record.
// ---------------------------------------------------------------------------
sortingRouter.post('/records/:id/anomaly-outcome', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params?.id;
    const action = String(req.body?.action || '').toUpperCase();

    if (!id) return bad(res, 'A record id is required.');
    if (action !== 'RE_MEASURED' && action !== 'CONFIRMED') {
      return bad(res, 'action must be RE_MEASURED (the reading changed) or CONFIRMED (it stands).');
    }
    if (!req.user?.id) return bad(res, 'Authenticated inspector required.', 'UNAUTHORIZED', 401);

    const originalHeight = Number(req.body?.originalHeight);
    const correctedHeight = Number(req.body?.correctedHeight);
    const bothKnown = Number.isFinite(originalHeight) && Number.isFinite(correctedHeight);

    new LearningService(getDatabase()).recordOutcome({
      subsystem: 'MEASUREMENT_ANOMALY',
      inspectionId: id,
      machineOutput: { flagged: true, originalHeight: Number.isFinite(originalHeight) ? originalHeight : null },
      humanOutput: { action, correctedHeight: Number.isFinite(correctedHeight) ? correctedHeight : null },
      // True when the flag changed the recorded outcome — the flag was right.
      wasCorrected: action === 'RE_MEASURED',
      correctionMagnitude: bothKnown ? Math.abs(correctedHeight - originalHeight) : null,
      context: { answered: true },
      userId: req.user.id,
      userRole: req.user.role ?? null
    });

    res.status(200).json({
      success: true,
      data: {
        recorded: true,
        action,
        message:
          action === 'RE_MEASURED'
            ? 'Recorded — the check caught a reading that needed correcting.'
            : 'Recorded — the reading stands and the check was a false alarm.'
      },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    bad(res, err?.message || 'Could not record the outcome', 'SORTING_FAILED', 500);
  }
});

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
// POST /api/sorting/records/:id/image — a photograph, labelled by a person
//
// The verdict the inspector gave is the label. Nothing is ever inferred FROM
// the image: a photograph of a spring on its own carries no scale, and the
// G-95 bands are 2-3mm wide on a 260mm spring, so no band could be honestly
// derived from one. What this builds is the labelled set from this shop that
// any future model would have to be SCORED against before it was trusted —
// and, before that day, evidence attached to a condemnation.
// ---------------------------------------------------------------------------
sortingRouter.post('/records/:id/image', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const b = req.body || {};
    const sortingRecordId = req.params?.id;
    if (!req.user?.id) return bad(res, 'Authenticated inspector required.', 'UNAUTHORIZED', 401);
    if (!b.imageData) return bad(res, 'imageData is required.');
    if (!b.batchId) return bad(res, 'batchId is required.');

    const result = repo().attachImage({
      sortingRecordId: sortingRecordId === 'unlinked' ? null : sortingRecordId,
      batchId: String(b.batchId),
      bogieType: String(b.bogieType || ''),
      condition: (b.condition || 'USED') as SpringCondition,
      springPosition: b.springPosition as SpringPosition,
      labelledBand: b.band ?? null,
      labelledStatus: b.status === 'CONDEMNED' ? 'CONDEMNED' : 'PASS',
      measuredHeight: Number.isFinite(Number(b.measuredFreeHeight)) ? Number(b.measuredFreeHeight) : null,
      imageData: String(b.imageData),
      mimeType: b.mimeType || 'image/jpeg',
      width: b.width ?? null,
      height: b.height ?? null,
      inspectorId: req.user.id
    });

    // No image is not an error. Losing the spring because its photograph
    // failed would be a bad trade, so the sorting record stands either way.
    res.status(result ? 201 : 200).json({
      success: true,
      data: { stored: !!result, id: result?.id ?? null },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    bad(res, err?.message || 'Could not store spring evidence', 'IMAGE_FAILED', 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/sorting/dataset — how much labelled evidence exists, per band
//
// Deliberately counts rather than images. The question it answers is "is
// there enough of this to build or test anything yet", and the thin bands are
// the answer — an overall total would hide them.
// ---------------------------------------------------------------------------
sortingRouter.get('/dataset', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    res.status(200).json({
      success: true,
      data: repo().imageDatasetSummary(),
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    bad(res, err?.message || 'Could not read the evidence summary', 'SORTING_FAILED', 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/sorting/images — the photographs themselves, newest first
//
// There was no way to retrieve one. Frames were captured, stored and counted,
// and every screen could show was the total — so nobody could check the
// photographs were landing, and nobody could look at the evidence behind a
// condemnation. Images nobody can open are storage, not evidence.
// ---------------------------------------------------------------------------
sortingRouter.get('/images', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = (req.query || {}) as Record<string, string>;
    res.status(200).json({
      success: true,
      data: repo().recentImages({
        limit: q.limit ? Number(q.limit) : undefined,
        batchId: q.batchId,
        condemnedOnly: q.condemnedOnly === 'true'
      }),
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    bad(res, err?.message || 'Could not read spring evidence', 'SORTING_FAILED', 500);
  }
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
// GET /api/sorting/allocation?bogieType=&condition=&forWagon=
//
// What the sorted stock can actually build, and what is stranded.
//
// /stock already reports complete groups per band. This answers the question
// the shop floor has instead: how many whole bogies, and which position is
// holding that number down. A supervisor reading twenty complete outer groups
// beside two snubber groups cannot see at a glance that the answer is two.
// ---------------------------------------------------------------------------
sortingRouter.get('/allocation', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = (req.query || {}) as Record<string, string>;
    const bogieType = q.bogieType as BogieType;
    const condition = (q.condition || 'USED') as SpringCondition;

    if (!bogieType) return bad(res, 'bogieType is required');
    if (!q.forWagon) {
      return bad(res, 'forWagon is required — the spring counts a bogie needs come from its designation.');
    }

    const config = getWagonSpringConfig(q.forWagon);
    if (!config) {
      return bad(res, `Unknown wagon designation "${q.forWagon}". It must not be guessed.`, 'UNKNOWN_WAGON_TYPE');
    }

    const holdings = repo().stockByBand(bogieType, condition, {
      fromDate: q.fromDate,
      toDate: q.toDate
    });

    const allocation = allocateNests(holdings, config.counts);

    res.status(200).json({
      success: true,
      data: {
        bogieType,
        condition,
        wagon: {
          designation: config.designation,
          counts: config.counts,
          tableRef: config.tableRef
        },
        allocation
      },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    bad(res, err?.message || 'Could not compute nest allocation', 'SORTING_FAILED', 500);
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
