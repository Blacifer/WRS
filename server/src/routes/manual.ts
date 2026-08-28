/**
 * Maintenance Manual Search API
 * Indian Railways WRS Raipur
 *
 * Deliberately available to INSPECTOR: this exists so the person holding the
 * component can check a limit without walking to an office or asking someone
 * to look it up. Restricting it to supervisors would defeat the point.
 */

import { Router } from '../framework/index.ts';
import type { Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import { searchManual, getManualStats } from '../manual/manualIndex.ts';
import { searchFacts } from '../../../shared/knowledge/facts.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';

export const manualRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/manual/status — is the manual available on this server?
// ---------------------------------------------------------------------------
manualRouter.get('/status', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({
    success: true,
    data: getManualStats(getDatabase()),
    meta: { timestamp: new Date().toISOString() }
  });
});

// ---------------------------------------------------------------------------
// GET /api/manual/search?q=... — find the clause that answers a question
// ---------------------------------------------------------------------------
manualRouter.get('/search', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const q = String(req.query?.q || '').trim();
  const limit = Math.min(Number(req.query?.limit) || 5, 20);

  if (q.length < 2) {
    res.status(400).json({
      success: false,
      error: 'QUERY_TOO_SHORT',
      message: 'Enter at least two characters to search the manual.',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    /*
     * The app's own verified figures are consulted before the manual text.
     *
     * Asked "how much air pressure is needed to stop the brakes", full-text
     * search over the PDF returned a passage about leader nut sleeves — while
     * the app held the answer all along: brake pipe 4.9-5.1 kg/cm2, from
     * §720-C. Searching prose for words finds documents containing those
     * words; it does not find answers, and the best answers here were never in
     * prose at all. They are in the tables this system classifies against.
     *
     * Facts come back separately rather than mixed into the passages, because
     * they are a different kind of thing: a sourced figure the app enforces,
     * not an extract someone still has to read and interpret. When nothing
     * matches confidently this is empty and the passages carry the answer,
     * which is what full-text search is genuinely good for.
     */
    const facts = searchFacts(q, 4);

    const result = searchManual(getDatabase(), q, limit);
    res.status(200).json({
      success: true,
      data: {
        ...result,
        answers: facts.map((h) => ({
          subject: h.fact.subject,
          answer: h.fact.answer,
          source: h.fact.source,
          verified: h.fact.verified
        })),
        // Stated explicitly so nobody mistakes this for a generated answer.
        disclaimer:
          'Passages are reproduced verbatim from the RDSO Wagon Maintenance Manual. ' +
          'Nothing here is paraphrased or generated — always confirm against the cited page.'
      },
      meta: {
        answerCount: facts.length,
        resultCount: result.hits.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err: any) {
    if (err?.name === 'ManualNotIndexed') {
      res.status(503).json({
        success: false,
        error: 'MANUAL_NOT_INDEXED',
        message: err.message,
        statusCode: 503,
        timestamp: new Date().toISOString()
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: 'MANUAL_SEARCH_FAILED',
      message: err?.message || 'Manual search failed',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});
