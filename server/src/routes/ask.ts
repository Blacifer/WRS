/**
 * Ask the records
 * Indian Railways WRS Raipur
 *
 * POST /api/ask            { question, lang?, id?, params? }  — an answer with its citations, or the list to pick from
 * GET  /api/ask/catalogue  — the questions, for the picker
 * GET  /api/ask/posture    — whether a model is configured, and whether it is on this machine
 *
 * records.ask: supervisor, admin, DRM. Inspector names appear in some
 * answers, which is why it is not a shop-floor capability.
 */

import { Router } from '../framework/index.ts';
import type { Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';
import { ask, catalogueForPeople, modelPosture } from '../ask/askRecords.ts';

export const askRouter = Router();
const now = () => new Date().toISOString();

askRouter.get('/catalogue', authMiddleware, requireCapability('records.ask'), (req: AuthenticatedRequest, res: Response) => {
  const lang = String(req.query?.lang || 'en') === 'hi' ? 'hi' : 'en';
  res.status(200).json({ success: true, data: catalogueForPeople(lang), meta: { timestamp: now() } });
});

askRouter.get('/posture', authMiddleware, requireCapability('records.ask'), (_req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({ success: true, data: modelPosture(), meta: { timestamp: now() } });
});

askRouter.post('/', authMiddleware, requireCapability('records.ask'), async (req: AuthenticatedRequest, res: Response) => {
  const b = req.body || {};
  const question = typeof b.question === 'string' ? b.question.trim().slice(0, 500) : '';
  const lang = b.lang === 'hi' ? 'hi' : 'en';
  const explicit = typeof b.id === 'string' ? { id: b.id, params: (b.params && typeof b.params === 'object') ? b.params : {} } : undefined;
  if (!question && !explicit) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'question (a sentence) or id (a catalogue question) is required.', statusCode: 400, timestamp: now() });
    return;
  }
  try {
    const answer = await ask(getDatabase(), question || explicit!.id, lang, explicit);
    res.status(200).json({ success: true, data: answer, meta: { timestamp: now() } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'ASK_FAILED', message: err?.message || 'Could not answer', statusCode: 500, timestamp: now() });
  }
});
