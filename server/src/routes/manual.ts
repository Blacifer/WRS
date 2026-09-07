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
import { suggestManualQuery } from '../ai/zapheit.ts';
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
manualRouter.get('/search', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
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

    let result = searchManual(getDatabase(), q, limit);

    /*
     * Only when the shop's own words did not match the manual's.
     *
     * The index matches words. An inspector asks for the "throw-out size on a
     * brake block"; the manual says "condemning limit" and "brake block
     * thickness". That gap is vocabulary, which is the one thing a language
     * model is unambiguously good at — and it is a search problem, not an
     * answering one.
     *
     * Deliberately a fallback rather than a first step. When the plain search
     * finds the clause, nothing is sent anywhere and the behaviour is
     * identical to before: no latency, no dependency, no call. The model is
     * asked only when the alternative is telling somebody holding a component
     * that the manual has nothing for them.
     *
     * What comes back is search terms, never an answer. The passages are still
     * the manual's own words with their page cited, and `reinterpretedAs` says
     * plainly which terms were used, so nobody has to wonder why they got
     * these passages for that question.
     */
    let reinterpretedAs: string | null = null;
    if (result.hits.length === 0 && facts.length === 0) {
      const terms = await suggestManualQuery(q);
      if (terms && terms.toLowerCase() !== q.toLowerCase()) {
        const retry = searchManual(getDatabase(), terms, limit);
        if (retry.hits.length > 0) {
          result = retry;
          reinterpretedAs = terms;
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...result,
        /*
         * Null whenever the plain search answered, which is the ordinary case.
         * When it is set, the screen should show it: the inspector asked one
         * thing and is being shown passages found under different words.
         */
        reinterpretedAs,
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
        reinterpreted: Boolean(reinterpretedAs),
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
