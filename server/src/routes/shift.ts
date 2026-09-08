/**
 * The shift, written down
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The handover between shifts is a conversation at a bench, and what it
 * carries depends on who is tired. The records of the shift already exist in
 * this database — every spring, every verdict, every override — and nobody
 * reads them at six in the morning.
 *
 * This turns them into a few plain sentences. A model writes the draft when
 * one is reachable; a fixed template writes it when one is not, so the note
 * exists on a LAN with no route out. Either way a supervisor reads it, edits
 * it, and records it under their own name. The draft itself is never stored:
 * only what a person approved.
 *
 * THE RULE THE MODEL WORKS UNDER
 * ------------------------------
 * It may use only the numbers it was given. A draft that says "twelve springs
 * condemned" against records that say nine is not a stylistic slip, it is a
 * false statement in a document somebody will act on — so every figure in the
 * draft is checked against the facts, and a draft with a figure the facts do
 * not contain is thrown away and the template used instead. The screen is
 * told this happened.
 */

import crypto from 'node:crypto';
import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';
import { getDatabase } from '../db/connection.ts';
import { logAuditEvent } from '../db/auditLog.ts';
import {
  draftShiftHandover,
  templateShiftHandover,
  isZapheitConfigured,
  type ShiftFacts
} from '../ai/zapheit.ts';

export const shiftRouter = Router();

function isoDate(input: unknown): string {
  const s = String(input || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

/** What the records say happened on one date. Counts only — never text. */
export function gatherShiftFacts(shiftDate: string): ShiftFacts {
  const db = getDatabase();
  const like = `${shiftDate}%`;
  const one = (sql: string, ...args: unknown[]) =>
    Number((db.prepare(sql).get(...(args as any[])) as any)?.c ?? 0);

  return {
    shiftDate,
    springsSorted: one(
      `SELECT COUNT(*) AS c FROM spring_sorting_records WHERE created_at LIKE ? AND (voided IS NULL OR voided = 0)`, like),
    springsCondemned: one(
      `SELECT COUNT(*) AS c FROM spring_sorting_records WHERE created_at LIKE ? AND status = 'CONDEMNED' AND (voided IS NULL OR voided = 0)`, like),
    sortingInspectors: one(
      `SELECT COUNT(DISTINCT inspector_id) AS c FROM spring_sorting_records WHERE created_at LIKE ? AND (voided IS NULL OR voided = 0)`, like),
    checklistVerdicts: one(
      `SELECT COUNT(*) AS c FROM checklist_items WHERE status != 'PENDING' AND COALESCE(manual_verdict_at, updated_at) LIKE ?`, like),
    wagonsTouched: one(
      `SELECT COUNT(DISTINCT wagon_number) AS c FROM checklist_items WHERE status != 'PENDING' AND COALESCE(manual_verdict_at, updated_at) LIKE ?`, like),
    defectsFound: one(
      `SELECT COUNT(*) AS c FROM checklist_items WHERE status IN ('FAIL', 'CONDEMNED') AND COALESCE(manual_verdict_at, updated_at) LIKE ?`, like),
    supervisorOverrides: one(
      `SELECT COUNT(*) AS c FROM inspections WHERE supervisor_override = 1 AND created_at LIKE ?`, like),
    acousticDefects: one(
      `SELECT COUNT(*) AS c FROM acoustic_diagnostics WHERE anomaly_type != 'NONE' AND created_at LIKE ?`, like),
    wagonsReleased: one(
      `SELECT COUNT(*) AS c FROM wagons WHERE actual_release_date LIKE ?`, like),
    gateSignoffs: one(
      `SELECT COUNT(*) AS c FROM inspection_audit_log WHERE event_type = 'GATE_SIGNOFF_COMPLETED' AND created_at LIKE ?`, like)
  };
}

// GET /api/shift/handover/draft?date=YYYY-MM-DD — a draft, never stored
shiftRouter.get(
  '/handover/draft',
  authMiddleware,
  requireCapability('wagon.release'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const shiftDate = isoDate(req.query?.date);
      const facts = gatherShiftFacts(shiftDate);

      let text = templateShiftHandover(facts);
      let source: 'MODEL' | 'TEMPLATE' = 'TEMPLATE';
      let rejectedNumbers: string[] = [];

      if (isZapheitConfigured()) {
        const drafted = await draftShiftHandover(facts);
        if (drafted && 'text' in drafted) {
          text = drafted.text;
          source = 'MODEL';
        } else if (drafted && 'rejected' in drafted) {
          // The model used a figure the records do not contain. Said, not hidden.
          rejectedNumbers = drafted.rejected;
        }
      }

      res.status(200).json({
        success: true,
        data: { shiftDate, facts, draft: text, source, rejectedNumbers },
        meta: { timestamp: new Date().toISOString() }
      });
    } catch (err: any) {
      res.status(500).json({
        success: false, error: 'DRAFT_FAILED', message: err?.message || 'Could not draft the handover',
        statusCode: 500, timestamp: new Date().toISOString()
      });
    }
  }
);

// POST /api/shift/handover — record the note a supervisor approved
shiftRouter.post(
  '/handover',
  authMiddleware,
  requireCapability('wagon.release'),
  (req: AuthenticatedRequest, res: Response): void => {
    try {
      const { shiftDate: rawDate, body, draftSource, edited } = req.body || {};
      const shiftDate = isoDate(rawDate);
      const text = String(body || '').trim();
      if (text.length < 20) {
        res.status(400).json({
          success: false, error: 'VALIDATION_ERROR',
          message: 'A handover note needs at least a sentence.',
          statusCode: 400, timestamp: new Date().toISOString()
        });
        return;
      }
      const source = draftSource === 'MODEL' ? 'MODEL' : 'TEMPLATE';
      const db = getDatabase();
      const facts = gatherShiftFacts(shiftDate);
      const id = `sh_${crypto.randomUUID()}`;
      const actor = req.user!;

      db.prepare(`
        INSERT INTO shift_handovers (id, shift_date, body, facts_json, draft_source, edited, recorded_by, recorded_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, shiftDate, text, JSON.stringify(facts), source, edited ? 1 : 0, actor.id, actor.name || actor.username || 'Supervisor');

      /*
       * BATCH_EXPORTED with an explicit action, for the same reason the
       * checklist routes reuse CHECKLIST_ITEM_UPDATED: event_type is CHECK-
       * constrained on the hash-chained table, and a handover note is, quite
       * literally, a batch of the shift's records exported into a document.
       */
      logAuditEvent(db, {
        eventType: 'BATCH_EXPORTED',
        userId: actor.id,
        userRole: actor.role || 'SUPERVISOR',
        payload: { action: 'SHIFT_HANDOVER_RECORDED', handoverId: id, shiftDate, draftSource: source, edited: Boolean(edited), facts }
      });

      res.status(201).json({ success: true, data: { id, shiftDate }, meta: { timestamp: new Date().toISOString() } });
    } catch (err: any) {
      res.status(500).json({
        success: false, error: 'HANDOVER_FAILED', message: err?.message || 'Could not record the handover',
        statusCode: 500, timestamp: new Date().toISOString()
      });
    }
  }
);

// GET /api/shift/handover?limit=10 — the notes already recorded, newest first
shiftRouter.get(
  '/handover',
  authMiddleware,
  requireCapability('wagon.view'),
  (req: Request, res: Response): void => {
    const limit = Math.min(Number(req.query?.limit) || 10, 50);
    const rows = getDatabase().prepare(`
      SELECT id, shift_date, body, draft_source, edited, recorded_by_name, created_at
      FROM shift_handovers ORDER BY shift_date DESC, rowid DESC LIMIT ?
    `).all(limit) as any[];
    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r.id, shiftDate: r.shift_date, body: r.body, draftSource: r.draft_source,
        edited: r.edited === 1, recordedByName: r.recorded_by_name, createdAt: r.created_at
      })),
      meta: { timestamp: new Date().toISOString() }
    });
  }
);
