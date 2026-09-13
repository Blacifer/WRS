/**
 * The camera's memory
 * Indian Railways WRS Raipur
 *
 * Three endpoints and no cleverness. Everything the camera does happens in the
 * browser; this is where what it learns is kept so that it outlives the
 * browser, the bench and the machine.
 *
 * A note on why teaching is a shop-floor capability rather than an
 * administrative one: the people who know what a snubber looks like are the
 * people sorting springs, not the people with admin passwords. Requiring a
 * supervisor to approve each example would mean it never gets taught. Reading
 * the accuracy figures is a different question and sits with analytics.read,
 * because that is a divisional number rather than a bench one.
 */

import { Router } from '../framework/index.ts';
import type { Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import {
  VisionBrainRepository,
  isValidEmbedding,
  isValidThumbnail,
  MAX_THUMBNAIL_CHARS,
  liveAgreement,
  BRAIN_DOMAINS,
  BRAIN_HEADS,
  type BrainDomain,
  type BrainHead
} from '../db/visionBrainRepository.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { AUTO_AGREEMENT_FLOOR, AUTO_AGREEMENT_MIN_SAMPLE } from '../../../shared/vision/autoCommit.ts';
import { config } from '../config/index.ts';
import { requireCapability } from '../middleware/rbac.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { LearningService } from '../learning/learningService.ts';

export const visionRouter = Router();

const repo = () => new VisionBrainRepository(getDatabase());

function bad(res: Response, message: string, code = 'VALIDATION_ERROR', status = 400) {
  res.status(status).json({
    success: false,
    error: code,
    message,
    statusCode: status,
    timestamp: new Date().toISOString()
  });
}

/** Labels are compared as strings, so they are normalised once, here. */
function normaliseLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if (!s || s.length > 64) return null;
  if (!/^[A-Z0-9_\-]+$/.test(s)) return null;
  return s;
}

// ---------------------------------------------------------------------------
// GET /api/vision/brain?domain=SPRING
//
// Everything the camera knows, so the browser can rebuild it on load.
// ---------------------------------------------------------------------------
visionRouter.get('/brain', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const domain = String(req.query?.domain || 'SPRING') as BrainDomain;
    if (!BRAIN_DOMAINS.includes(domain)) {
      return bad(res, `domain must be one of ${BRAIN_DOMAINS.join(', ')}.`);
    }

    const r = repo();
    const examples = r.list(domain);

    res.status(200).json({
      success: true,
      data: {
        domain,
        counts: r.counts(domain),
        examples: examples.map((e) => ({
          id: e.id,
          head: e.head,
          label: e.label,
          embedding: e.embedding,
          thumbnail: e.thumbnail,
          sourceImageId: e.sourceImageId,
          partName: e.partName,
          taughtBy: e.taughtBy,
          createdAt: e.createdAt
        }))
      },
      meta: { total: examples.length, timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'BRAIN_LOAD_FAILED',
      message: err?.message || 'Could not load what the camera has learned',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/vision/brain/teach
//
// One photograph, and what a person called it.
//
// This is also where the learning ledger is written, in the same request, so
// that the two can never disagree. A teaching recorded without its ledger
// entry would inflate the camera's apparent accuracy by hiding a correction.
// ---------------------------------------------------------------------------
visionRouter.post(
  '/brain/teach',
  authMiddleware,
  requireCapability('wagon.inspect'),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const b = req.body || {};
      const domain = b.domain as BrainDomain;
      const head = b.head as BrainHead;
      const label = normaliseLabel(b.label);

      if (!BRAIN_DOMAINS.includes(domain)) {
        return bad(res, `domain must be one of ${BRAIN_DOMAINS.join(', ')}.`);
      }
      if (!BRAIN_HEADS.includes(head)) {
        return bad(res, `head must be one of ${BRAIN_HEADS.join(', ')}.`);
      }
      if (!label) {
        return bad(res, 'label is required: letters, digits, underscore or hyphen, up to 64 characters.');
      }
      /*
       * Refused rather than accepted-and-ignored. A wrong-length embedding
       * would not throw anywhere; it would sit in the list comparing against
       * nothing and make the camera quietly worse for months.
       */
      if (!isValidEmbedding(b.embedding)) {
        return bad(
          res,
          'embedding must be base64 of exactly 1280 float32 values — the output of the vendored MobileNet.'
        );
      }

      /*
       * A thumbnail is optional but not unbounded. Refusing an oversized one
       * outright, rather than storing it, keeps the storage claim that
       * justifies this whole design — embeddings, not photographs — true.
       */
      if (b.thumbnail != null && !isValidThumbnail(b.thumbnail)) {
        return bad(
          res,
          `thumbnail must be a small base64 image data URL, at most ${MAX_THUMBNAIL_CHARS} characters.`
        );
      }

      const proposedLabel = normaliseLabel(b.proposedLabel);
      const stored = repo().teach({
        domain,
        head,
        label,
        embedding: b.embedding,
        thumbnail: isValidThumbnail(b.thumbnail) ? b.thumbnail : null,
        sourceImageId: typeof b.sourceImageId === 'string' ? b.sourceImageId : null,
        partName: typeof b.partName === 'string' ? b.partName : null,
        bogiePosition: typeof b.bogiePosition === 'string' ? b.bogiePosition : null,
        proposedLabel,
        taughtBy: req.user!.id
      });

      /*
       * The ledger entry, and the one subtlety in this file.
       *
       * A teaching with no proposal is not evidence about accuracy — the
       * camera stayed silent, and silence is neither right nor wrong. Writing
       * those as acceptances would let a camera that never answers look
       * perfect. So only proposals reach the ledger, which is the same
       * unanswered-exclusion rule the anomaly subsystem already follows.
       */
      if (proposedLabel) {
        try {
          new LearningService(getDatabase()).recordOutcome({
            subsystem: domain === 'SPRING' ? 'SPRING_VISION' : 'PART_VISION',
            machineOutput: { head, label: proposedLabel },
            machineConfidence:
              typeof b.confidence === 'number' && b.confidence >= 0 && b.confidence <= 1
                ? b.confidence
                : null,
            humanOutput: { head, label },
            wasCorrected: stored.wasCorrection,
            context: { partName: stored.partName, sourceImageId: stored.sourceImageId },
            userId: req.user!.id,
            userRole: req.user!.role ?? null
          });
        } catch {
          // A ledger write must never cost an inspector their tap. The
          // teaching itself is already committed and is the thing that
          // matters on the floor.
        }
      }

      res.status(201).json({
        success: true,
        data: {
          id: stored.id,
          head: stored.head,
          label: stored.label,
          wasCorrection: stored.wasCorrection
        },
        meta: { timestamp: new Date().toISOString() }
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'TEACH_FAILED',
        message: err?.message || 'Could not record what the camera was taught',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/vision/brain/progress?domain=SPRING
//
// Is it actually getting better?
//
// Deliberately NOT the example count, which only ever rises and therefore
// proves nothing. This returns the share of the camera's proposals the
// inspector kept, week by week. If the camera is improving that rises. If it
// is not, this is flat, and a flat line is what should be shown.
// ---------------------------------------------------------------------------
visionRouter.get(
  '/brain/progress',
  authMiddleware,
  requireCapability('analytics.read'),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const domain = String(req.query?.domain || 'SPRING') as BrainDomain;
      if (!BRAIN_DOMAINS.includes(domain)) {
        return bad(res, `domain must be one of ${BRAIN_DOMAINS.join(', ')}.`);
      }
      const head = req.query?.head ? (String(req.query.head) as BrainHead) : undefined;
      if (head && !BRAIN_HEADS.includes(head)) {
        return bad(res, `head must be one of ${BRAIN_HEADS.join(', ')}.`);
      }

      const r = repo();
      const trend = r.correctionTrend(domain, head);
      const scored = trend.filter((w) => w.agreementRate !== null);

      res.status(200).json({
        success: true,
        data: {
          domain,
          head: head ?? null,
          counts: r.counts(domain),
          weeks: trend,
          /*
           * Stated in words so a reader cannot mistake a rising example count
           * for a rising accuracy, which is the easiest mistake to make when
           * looking at a chart like this.
           */
          summary:
            scored.length < 2
              ? 'Not enough weeks yet to say whether it is improving. The example count is not the answer to that question.'
              : (() => {
                  const first = scored[0].agreementRate!;
                  const last = scored[scored.length - 1].agreementRate!;
                  const delta = (last - first) * 100;
                  const pct = (n: number) => `${Math.round(n * 100)}%`;
                  if (delta > 3) {
                    return `The inspector kept ${pct(first)} of its answers in ${scored[0].week} and ${pct(last)} in ${scored[scored.length - 1].week}. It is getting better.`;
                  }
                  if (delta < -3) {
                    return `Agreement has fallen from ${pct(first)} to ${pct(last)}. Something has changed — new spring types, different lighting, or a new inspector labelling differently.`;
                  }
                  return `Agreement is steady at about ${pct(last)}. More examples alone are not improving it; the gap is likely in what it is being shown, not how much.`;
                })()
        },
        meta: { timestamp: new Date().toISOString() }
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'PROGRESS_FAILED',
        message: err?.message || 'Could not read the camera progress',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/vision/auto/status?domain=SPRING
//
// Whether the camera is currently permitted to decide without asking, per
// head, and why not where it is not. This is the third condition of the rule
// in shared/vision/autoCommit.ts, served from the learning ledger; the other
// conditions are judged in the browser, where the measured accuracy lives.
//
// Readable by anyone signed in: an inspector at the bench needs to know why
// the camera has gone back to asking, and "because a supervisor turned it
// off" or "because you have been correcting it" are both answers they are
// owed.
// ---------------------------------------------------------------------------
visionRouter.get('/auto/status', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const domain = String(req.query?.domain || 'SPRING') as BrainDomain;
    if (!BRAIN_DOMAINS.includes(domain)) {
      return bad(res, `domain must be one of ${BRAIN_DOMAINS.join(', ')}.`);
    }

    /*
     * The master switch. Default on, because the rule itself keeps a fresh
     * installation from auto-committing anything — every head is
     * INSUFFICIENT until taught and scored on real parts. The switch exists
     * so a supervisor can stop it on a bad day without redeploying, and so
     * the reason on screen says a person did that rather than the numbers.
     */
    const master = config.visionAutoCommit;
    const agreement = liveAgreement(getDatabase(), domain, 200, AUTO_AGREEMENT_MIN_SAMPLE);

    const heads = BRAIN_HEADS.map((head) => {
      const a = agreement[head];
      const allowed = master && a.rate !== null && a.rate >= AUTO_AGREEMENT_FLOOR;
      return {
        head,
        sampled: a.sampled,
        kept: a.kept,
        rate: a.rate,
        newestAt: a.newestAt,
        allowed,
        reason: !master
          ? 'Switched off in the server configuration (VISION_AUTO_COMMIT=off).'
          : a.rate === null
            ? `Not enough recent proposals to judge (${a.sampled} of ${AUTO_AGREEMENT_MIN_SAMPLE}).`
            : a.rate < AUTO_AGREEMENT_FLOOR
              ? `Inspectors kept ${Math.round(a.rate * 100)}% of recent answers; needs ${Math.round(AUTO_AGREEMENT_FLOOR * 100)}%.`
              : `Inspectors kept ${Math.round(a.rate * 100)}% of the last ${a.sampled}.`
      };
    });

    res.status(200).json({
      success: true,
      data: { domain, master, heads },
      meta: { window: 200, minSample: AUTO_AGREEMENT_MIN_SAMPLE, floor: AUTO_AGREEMENT_FLOOR, timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'AUTO_STATUS_FAILED',
      message: err?.message || 'Could not read the auto-commit status',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/vision/auto/record
//
// The camera decided and nobody confirmed. Logged so the decision is on the
// record with its confidence and neighbours — and logged with auto: true so
// it is EXCLUDED from the live agreement, because the camera agreeing with
// itself is not evidence. It is deliberately not a teaching: a brain that
// remembers its own unconfirmed answers reinforces its own mistakes.
// ---------------------------------------------------------------------------
visionRouter.post(
  '/auto/record',
  authMiddleware,
  requireCapability('wagon.inspect'),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const b = req.body || {};
      const domain = b.domain as BrainDomain;
      if (!BRAIN_DOMAINS.includes(domain)) return bad(res, `domain must be one of ${BRAIN_DOMAINS.join(', ')}.`);
      if (!Array.isArray(b.heads) || b.heads.length === 0) return bad(res, 'heads[] is required.');

      const ls = new LearningService(getDatabase());
      const ids: string[] = [];
      for (const h of b.heads) {
        if (!BRAIN_HEADS.includes(h?.head)) continue;
        const label = normaliseLabel(h.label);
        if (!label) continue;
        const { id } = ls.recordOutcome({
          subsystem: domain === 'SPRING' ? 'SPRING_VISION' : 'PART_VISION',
          machineOutput: { head: h.head, label },
          machineConfidence:
            typeof h.confidence === 'number' && h.confidence >= 0 && h.confidence <= 1 ? h.confidence : null,
          humanOutput: null,
          wasCorrected: false,
          context: {
            auto: true,
            recordId: typeof b.recordId === 'string' ? b.recordId : null,
            wagonNumber: typeof b.wagonNumber === 'string' ? b.wagonNumber : null,
            neighbours: Array.isArray(h.neighbours) ? h.neighbours.slice(0, 5) : null
          },
          userId: req.user!.id,
          userRole: req.user!.role ?? null
        });
        ids.push(id);
      }
      res.status(201).json({ success: true, data: { logged: ids.length }, meta: { timestamp: new Date().toISOString() } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: 'AUTO_RECORD_FAILED', message: err?.message || 'Could not log the camera decision', statusCode: 500, timestamp: new Date().toISOString() });
    }
  }
);
